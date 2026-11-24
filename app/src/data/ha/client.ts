import { Capacitor } from '@capacitor/core';
import { NetworkError, request } from '../../platform/network.ts';
import { secureGet, secureSet } from '../../platform/secure.ts';
import { HA_KEY } from './schema.ts';
import type { Entity, HAConfig, Token } from './schema.ts';

export function isLocalHAHost(host: string) {
  const parts = host.split('.').map(Number);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = parts;
    return a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254;
  }
  return host === 'localhost' || host === '[::1]' || /^\[(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/.test(host) || /\.(?:local|home\.arpa)\.?$/.test(host);
}

export function normalizeAddress(value: string) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('请输入完整的 HTTP 或 HTTPS 服务器地址。');
  }
  if (url.protocol === 'http:' && !isLocalHAHost(url.hostname)) throw new Error('局域网地址可用 HTTP，其他地址请使用 HTTPS。');
  return url.href.replace(/\/+$/, '');
}

function endpoint(server: string, path: string) {
  server = normalizeAddress(server);
  const proxied = import.meta.env?.VITE_HA_DEV_PROXY_ORIGIN;
  return !Capacitor.isNativePlatform() && server === proxied ? '/__ha' + path : server + path;
}

interface TokenResponse { access_token: string; expires_in: number; refresh_token?: string }
export async function exchange(server: string, body: URLSearchParams, existing?: Token): Promise<Token> {
  const reply = await request<TokenResponse>(endpoint(server, '/auth/token'), { method: 'POST', body });
  if (!reply.access_token || !Number.isFinite(reply.expires_in) || reply.expires_in <= 0) throw new NetworkError(502);
  return {
    access: reply.access_token, refresh: reply.refresh_token ?? existing?.refresh,
    expiresAt: Date.now() + reply.expires_in * 1000, client: body.get('client_id') ?? existing?.client,
  };
}

const refreshes = new Map<string, Promise<Token>>();
let generation = 0;

export function invalidateHAWork() { generation++; }

async function renew(server: string, original: Token, activeGeneration: number): Promise<Token> {
  if (!original.refresh || !original.client) throw new NetworkError(401);
  if (activeGeneration !== generation) throw new NetworkError(401);
  const key = server + ':' + activeGeneration;
  const existing = refreshes.get(key);
  if (existing) return existing;
  const refresh = exchange(server, new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: original.refresh, client_id: original.client,
  }), original).then(async renewed => {
    if (activeGeneration !== generation || (await secureGet<Token>(HA_KEY))?.access !== original.access) {
      throw new NetworkError(401);
    }
    await secureSet(HA_KEY, renewed);
    return renewed;
  }).catch(error => {
    if (error instanceof NetworkError && error.status === 400) throw new NetworkError(401);
    throw error;
  }).finally(() => refreshes.delete(key));
  refreshes.set(key, refresh);
  return refresh;
}

async function read<T>(config: HAConfig, path: string, signal?: AbortSignal) {
  const activeGeneration = generation;
  const stored = await secureGet<Token>(HA_KEY);
  if (!stored) throw new NetworkError(401);
  const current = stored.expiresAt && stored.expiresAt < Date.now() + 20_000
    ? await renew(config.url, stored, activeGeneration) : stored;
  const get = (token: Token) => request<T>(endpoint(config.url, path), { token: token.access, signal });
  try { return await get(current); }
  catch (error) {
    if (!(error instanceof NetworkError) || error.status !== 401 || !current.refresh || signal?.aborted) throw error;
    const newer = await secureGet<Token>(HA_KEY);
    if (activeGeneration !== generation) throw new NetworkError(401);
    return get(newer && newer.access !== current.access ? newer : await renew(config.url, current, activeGeneration));
  }
}

function validEntities(value: unknown): Entity[] {
  if (!Array.isArray(value)) throw new NetworkError(502);
  return value.filter((entity): entity is Entity => entity && typeof entity.entity_id === 'string' && typeof entity.state === 'string');
}
export async function testConnection(url: string, token: Token) {
  return validEntities(await request(endpoint(url, '/api/states'), { token: token.access }));
}
export async function currentEntities(config: HAConfig, signal?: AbortSignal) {
  return validEntities(await read(config, '/api/states', signal));
}
export async function entityHistory(config: HAConfig, entities: string[], start: number, end: number, signal?: AbortSignal) {
  if (!entities.length) return [];
  const query = new URLSearchParams({ end_time: new Date(end).toISOString(), filter_entity_id: entities.join(',') });
  const groups = await read<unknown>(config, '/api/history/period/' + encodeURIComponent(new Date(start).toISOString()) + '?' + query, signal);
  if (!Array.isArray(groups) || !groups.every(Array.isArray)) throw new NetworkError(502);
  return validEntities(groups.flat());
}

export async function withHAToken<T>(config: HAConfig, action: (access: string) => Promise<T>) {
  const activeGeneration = generation;
  const stored = await secureGet<Token>(HA_KEY);
  if (!stored) throw new NetworkError(401);
  const current = stored.expiresAt && stored.expiresAt < Date.now() + 20_000
    ? await renew(config.url, stored, activeGeneration) : stored;
  try { return await action(current.access); }
  catch (error) {
    if (!(error instanceof NetworkError) || error.status !== 401 || !current.refresh) throw error;
    const newer = await secureGet<Token>(HA_KEY);
    if (activeGeneration !== generation) throw new NetworkError(401);
    return action(newer && newer.access !== current.access ? newer.access : (await renew(config.url, current, activeGeneration)).access);
  }
}
