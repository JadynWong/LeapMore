import { NetworkError } from '../../platform/network.ts';
import { readDataset, saveDataset } from '../localDatabase.ts';
import { normalizeAddress, withHAToken } from './client.ts';
import type { RawObservation, RawRecord, SyncChange } from './archiveTypes.ts';
import type { RegisteredEntity, RegisteredVehicle } from './discovery.ts';
import type { HAConfig } from './schema.ts';

interface Scope { source_id: string; dataset_id: string; vehicle_id: string }
interface Info extends Omit<Scope, 'vehicle_id'> { protocol_version: number; ready: boolean; membership_contract_version?: number; }
export interface ArchiveVehicle { vehicle_id: string; name?: string; vin?: string; entry_id?: string; migration_status?: string }
interface Membership {
  coverage: 'complete' | 'partial' | 'unavailable';
  membership_revision: number;
  observation_ids: string[];
}
type ArchiveRecord = RawRecord & { membership_revision?: number; membership_coverage?: string };
interface Capture { event_id: string; vehicle_id: string; event?: string; occurred_at_ms?: number }
export interface Archive {
  cursor: string;
  observations: Record<string, RawObservation>;
  records: Record<string, ArchiveRecord>;
  events: Record<string, Capture>;
  membership: Record<string, Membership>;
}
class ArchiveError extends Error {
  constructor(readonly code: string) {
    super(code === 'unauthorized' ? '零跑档案需要 HA 管理员授权。' :
      code === 'unknown_command' ? '服务器未提供零跑原始档案接口。' : '零跑档案暂不可用或返回的档案范围不一致。');
  }
}

class Socket {
  private id = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  constructor(private ws: WebSocket) {}

  static async connect(config: HAConfig, access: string, signal?: AbortSignal) {
    const proxy = import.meta.env?.VITE_HA_DEV_PROXY_ORIGIN;
    const server = normalizeAddress(config.url);
    const url = new URL(server === proxy && typeof location !== 'undefined'
      ? location.origin + '/__ha/api/websocket' : server + '/api/websocket');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    const socket = new Socket(ws);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new NetworkError(0)); ws.close(); }, 15_000);
      const fail = (error: Error) => { clearTimeout(timer); reject(error); socket.rejectAll(error); };
      ws.onerror = () => fail(new NetworkError(0));
      ws.onclose = () => fail(new NetworkError(0));
      signal?.addEventListener('abort', () => { fail(new NetworkError(0)); socket.close(); }, { once: true });
      ws.onmessage = ({ data }) => {
        let value;
        try { value = JSON.parse(data); } catch { return; }
        if (value.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: access }));
        if (value.type === 'auth_invalid') { fail(new NetworkError(401)); socket.close(); }
        if (value.type === 'auth_ok') { clearTimeout(timer); resolve(); }
        const reply = socket.pending.get(value.id);
        if (!reply) return;
        socket.pending.delete(value.id);
        if (value.success) reply.resolve(value.result);
        else reply.reject(new ArchiveError(String(value.error?.code ?? 'invalid_response')));
      };
    });
    return socket;
  }

  command<T>(type: string, data: Record<string, unknown> = {}): Promise<T> {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new NetworkError(0));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new NetworkError(0)); }, 25_000);
      this.pending.set(id, {
        resolve: result => { clearTimeout(timeout); resolve(result as T); },
        reject: error => { clearTimeout(timeout); reject(error); },
      });
      const command = /^v[12]\//.test(type) ? 'leapmotor/sync/' + type : type;
      this.ws.send(JSON.stringify({ id, type: command, ...data }));
    });
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  close() { this.rejectAll(new NetworkError(0)); this.ws.close(); }
}

async function usingSocket<T>(config: HAConfig, fn: (socket: Socket) => Promise<T>, signal?: AbortSignal) {
  return withHAToken(config, async access => {
    signal?.throwIfAborted();
    const socket = await Socket.connect(config, access, signal);
    try { return await fn(socket); } finally { socket.close(); }
  });
}

async function requireInfo(socket: Socket) {
  const info = await socket.command<Info>('v1/info');
  if (info.protocol_version !== 1 || !info.source_id || !info.dataset_id || !info.ready) throw new ArchiveError('archive_unavailable');
  return info;
}

export async function archiveVehicles(config: HAConfig, signal?: AbortSignal) {
  return usingSocket(config, async socket => {
    const info = await requireInfo(socket);
    const list = await socket.command<{ vehicles: ArchiveVehicle[]; source_id: string; dataset_id: string }>('v1/vehicles');
    if (list.source_id !== info.source_id || list.dataset_id !== info.dataset_id || !Array.isArray(list.vehicles)) throw new ArchiveError('scope');
    return list.vehicles;
  }, signal);
}

export async function entityRegistry(config: HAConfig, signal?: AbortSignal) {
  return usingSocket(config, async socket => {
    const optional = (error: unknown) => {
      if (error instanceof ArchiveError) return null;
      throw error;
    };
    const [entries, catalog] = await Promise.all([
      socket.command<RegisteredEntity[]>('config/entity_registry/list').catch(optional),
      socket.command<{ vehicles: RegisteredVehicle[] }>('leapmotor/vehicles/list').catch(optional),
    ]);
    return { entries: Array.isArray(entries) ? entries : [], catalog: Array.isArray(catalog?.vehicles) ? catalog.vehicles : [],
      registryReadable: Array.isArray(entries) };
  }, signal);
}

export async function vehicleLedger<T extends { vin?: string }>(config: HAConfig, vin: string,
  command: 'trips/list' | 'trips/track' | 'charging/history' | 'energy/daily',
  parameters: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return usingSocket(config, async socket => {
    const data = await socket.command<T>('leapmotor/' + command, { ...parameters, vin });
    if (typeof data?.vin !== 'string' || data.vin.trim().toUpperCase() !== vin) throw new ArchiveError('scope');
    return data;
  }, signal);
}

interface ChargeIndexPage extends Scope {
  vin: string;
  protocol_version: number;
  contract_version: number;
  snapshot_id: string;
  coverage: 'complete' | 'partial' | 'unavailable';
  requested_range: { from_ms: number; to_ms: number };
  rows: Record<string, unknown>[];
  has_more: boolean;
  next_page_token?: string | null;
}

export async function vehicleChargeIndex(config: HAConfig, vin: string, from: number, to: number, signal: AbortSignal) {
  return usingSocket(config, async socket => {
    const rows: Record<string, unknown>[] = [], seen = new Set<string>();
    let pageToken: string | null = null, first: ChargeIndexPage | undefined;
    do {
      const page: ChargeIndexPage = await socket.command('leapmotor/charging/records/v1', {
        vin, from_ms: from, to_ms: to, limit: 200, ...(pageToken ? { page_token: pageToken } : {}),
      });
      signal.throwIfAborted();
      if (page?.protocol_version !== 1 || page.contract_version !== 1 || page.vin?.toUpperCase() !== vin ||
          !page.source_id || !page.dataset_id || !page.vehicle_id || !page.snapshot_id || !Array.isArray(page.rows) ||
          page.requested_range?.from_ms !== from || page.requested_range?.to_ms !== to) throw new ArchiveError('scope');
      if (first) {
        checked(page, first);
        if (page.snapshot_id !== first.snapshot_id) throw new ArchiveError('scope');
      } else first = page;
      rows.push(...page.rows);
      pageToken = page.has_more ? page.next_page_token ?? '' : null;
      if (page.has_more && (!pageToken || seen.has(pageToken))) throw new ArchiveError('pagination');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return { rows, coverage: first.coverage };
  }, signal);
}

const checked = (page: Scope, scope: Scope) => {
  if (page.source_id !== scope.source_id || page.dataset_id !== scope.dataset_id || page.vehicle_id !== scope.vehicle_id) {
    throw new ArchiveError('scope');
  }
};
const keyOf = (kind: string, id: string) => kind + ':' + id;
function apply(data: Archive, kind: string, id: string, payload: unknown, vehicle: string) {
  if (!id || ['__proto__', 'constructor', 'prototype'].includes(id)) return;
  if (kind.endsWith('.delete')) {
    if (kind === 'observation.delete') delete data.observations[id];
    if (kind === 'record.delete') {
      const key = (payload as { kind?: string } | null)?.kind;
      if (!key) throw new ArchiveError('invalid_record_tombstone');
      delete data.records[keyOf(key, id)];
      delete data.membership[keyOf(key, id)];
    }
    return;
  }
  if (!payload) throw new ArchiveError('scope');
  const payloadVehicle = (payload as Scope).vehicle_id;
  if (kind.startsWith('record')) {
    const record = payload as ArchiveRecord;
    if (record.kind !== 'trip' && record.kind !== 'charge') throw new ArchiveError('invalid_record');
    // Older LeapToHA records omit the vehicle ID. Both callers verify the enclosing page's scope first.
    if ((payloadVehicle != null && payloadVehicle !== '' && payloadVehicle !== vehicle) || record.record_id !== id) throw new ArchiveError('scope');
    data.records[keyOf(record.kind, id)] = { ...record, vehicle_id: vehicle };
    return;
  }
  if (payloadVehicle !== vehicle) throw new ArchiveError('scope');
  if (kind.startsWith('observation')) data.observations[id] = payload as RawObservation;
  if (kind.startsWith('capture_event')) data.events[id] = payload as Capture;
}
const blank = (): Archive => ({ cursor: '', observations: {}, records: {}, events: {}, membership: {} });

async function bootstrap(socket: Socket, scope: Scope, signal: AbortSignal) {
  const data = blank();
  let next: string | null = null;
  do {
    signal.throwIfAborted();
    const page: Scope & { items: { entity_type: string; data: RawObservation | RawRecord | Capture }[]; next_page_token?: string; has_more: boolean; cursor?: string } =
      await socket.command('v1/bootstrap', { vehicle_id: scope.vehicle_id, limit: 150, ...(next ? { page_token: next } : {}) });
    checked(page, scope);
    for (const item of page.items) {
      const itemData = item.data;
      const id = 'observation_id' in itemData ? itemData.observation_id : 'record_id' in itemData ? itemData.record_id : itemData.event_id;
      apply(data, item.entity_type, id, itemData, scope.vehicle_id);
    }
    if (page.has_more && (!page.next_page_token || page.next_page_token === next)) throw new ArchiveError('pagination');
    next = page.has_more ? page.next_page_token! : null;
    if (!next) data.cursor = page.cursor ?? '';
  } while (next);
  if (!data.cursor) throw new ArchiveError('pagination');
  return data;
}

async function syncMembership(socket: Socket, scope: Scope, data: Archive, signal: AbortSignal) {
  for (const [key, record] of Object.entries(data.records)) {
    if (!record.membership_revision || record.membership_coverage === 'unavailable' ||
      data.membership[key]?.membership_revision === record.membership_revision) continue;
    const ids = new Set<string>();
    let next: string | undefined, coverage: Membership['coverage'] = 'unavailable';
    do {
      signal.throwIfAborted();
      const page: Scope & Membership & { record_id: string; kind: string; next_page_token?: string; has_more: boolean } =
        await socket.command('v2/membership', {
          vehicle_id: scope.vehicle_id, record_id: record.record_id, kind: record.kind, limit: 150,
          membership_revision: record.membership_revision, ...(next ? { page_token: next } : {}),
        });
      checked(page, scope);
      if (page.record_id !== record.record_id || page.kind !== record.kind || page.membership_revision !== record.membership_revision) throw new ArchiveError('scope');
      for (const id of page.observation_ids) ids.add(id);
      coverage = page.coverage;
      if (page.has_more && (!page.next_page_token || page.next_page_token === next)) throw new ArchiveError('pagination');
      next = page.has_more ? page.next_page_token : undefined;
    } while (next);
    data.membership[key] = { membership_revision: record.membership_revision, observation_ids: [...ids], coverage };
  }
}

export const archivePointer = (config: HAConfig, vehicle: string) => 'archive-link:' + JSON.stringify([config.url, vehicle]);

export async function syncArchive(config: HAConfig, vehicle: string, signal: AbortSignal) {
  return usingSocket(config, async socket => {
    const info = await requireInfo(socket);
    const scope = { ...info, vehicle_id: vehicle };
    const key = 'archive:' + JSON.stringify([scope.source_id, scope.dataset_id, vehicle]);
    const pointer = archivePointer(config, vehicle);
    let data = await readDataset<Archive>(key);
    async function commit() {
      signal.throwIfAborted();
      await saveDataset(key, data);
      await saveDataset(pointer, key);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!data?.cursor) {
          data = await bootstrap(socket, scope, signal);
          await commit();
        } else {
          let more = true;
          while (more) {
            signal.throwIfAborted();
            const page: Scope & { changes: SyncChange[]; next_cursor: string; has_more: boolean } =
              await socket.command('v1/pull', { vehicle_id: vehicle, cursor: data.cursor, limit: 150 });
            checked(page, scope);
            if (!page.next_cursor || (page.has_more && page.next_cursor === data.cursor)) throw new ArchiveError('pagination');
            for (const change of page.changes) apply(data, change.op, change.entity_id, change.data, vehicle);
            data.cursor = page.next_cursor;
            more = page.has_more;
            await commit();
          }
        }
        if (info.membership_contract_version === 1) {
          await syncMembership(socket, scope, data, signal);
          await commit();
        }
        return data;
      } catch (error) {
        if (attempt !== 0 || !(error instanceof ArchiveError) || !['snapshot_expired', 'reset_required'].includes(error.code)) throw error;
        data = undefined;
      }
    }
    throw new ArchiveError('archive_unavailable');
  }, signal);
}
