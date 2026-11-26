import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { harmonyRequest } from '../../platform/network';

export { vehicleServiceOrigin } from './vehicleOrigin';

function decodeBase64(data: string): ArrayBuffer {
  const bytes = atob(data);
  return Uint8Array.from(bytes, code => code.charCodeAt(0)).buffer;
}

function parseBody(data: unknown, status: number): Record<string, unknown> {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return parsed && typeof parsed === 'object' ? { ...parsed, _status: status } : { _raw: true, _status: status };
    } catch { return { _raw: true, _status: status }; }
  }
  return data && typeof data === 'object' ? { ...data, _status: status } : { _raw: true, _status: status };
}

export async function requestJson(method: string, url: string, init: {
  headers?: Record<string, string>;
  body?: string;
  probe?: boolean;
  timeoutMs?: number;
} = {}): Promise<Record<string, unknown>> {
  if (Capacitor.getPlatform() === 'openharmony') {
    const reply = await harmonyRequest({ url, method, headers: init.headers ?? {}, body: init.body, probe: init.probe, timeoutMs: init.timeoutMs });
    return parseBody(reply.data, reply.status);
  }
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url, method, headers: init.headers, data: init.body,
      connectTimeout: init.timeoutMs ?? 20000,
      readTimeout: init.timeoutMs ?? 20000,
      responseType: init.probe ? 'text' : 'json', disableRedirects: true,
    });
    return parseBody(res.data, res.status);
  }
  const res = await fetch(url, { method, headers: init.headers, body: init.body, credentials: init.probe ? 'omit' : 'same-origin', redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
  return parseBody(await res.text(), res.status);
}

export async function requestBinary(url: string, init: { headers?: Record<string, string>; timeoutMs?: number; onStatus?: (status: number) => void } = {}): Promise<ArrayBuffer> {
  if (Capacitor.getPlatform() === 'openharmony') {
    const reply = await harmonyRequest({ url, method: 'GET', headers: init.headers ?? {}, binary: true, timeoutMs: init.timeoutMs ?? 120_000 });
    init.onStatus?.(reply.status);
    if (reply.status !== 200 || !reply.data) throw new Error('无法下载车模资源');
    return decodeBase64(reply.data);
  }
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url, method: 'GET', headers: init.headers,
      connectTimeout: init.timeoutMs ?? 30000, readTimeout: init.timeoutMs ?? 120000,
      responseType: 'arraybuffer',
    });
    init.onStatus?.(res.status);
    if (res.status !== 200) throw new Error('无法下载车模资源');
    const data = res.data as unknown;
    if (data instanceof ArrayBuffer) return data;
    if (data instanceof Uint8Array) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    if (Array.isArray(data)) return new Uint8Array(data as number[]).buffer;
    if (typeof data === 'string') return decodeBase64(data);
    throw new Error('二进制响应类型不支持');
  }
  const res = await fetch(url, { headers: init.headers });
  init.onStatus?.(res.status);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.arrayBuffer();
}
