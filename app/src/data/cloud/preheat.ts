import type { Vehicle } from '../types';
import { RemoteCommandError } from './remote.ts';

export const preheatCommandId = 161;
export type PreheatSettings = { enabled: boolean; start: string; days: number[] };
export type PreheatSchedule = PreheatSettings & { id: string };
export type PreheatEdit = PreheatSettings & { previous?: PreheatSchedule };
type Entry = { plan: PreheatSchedule; raw: Record<string, unknown> };

export const preheatSchedulesKey = (scope: string) => ['cloud', 'preheat-schedules', scope] as const;
export const allowsPreheat = (vehicle: Vehicle) => !vehicle.commandRights?.length || vehicle.commandRights.includes(String(preheatCommandId));
export const validPreheatTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

function weekdays(days: unknown) {
  if (!Array.isArray(days)) return null;
  const values = days.map(day => typeof day === 'string' && /^[0-6]$/.test(day) ? Number(day) : day);
  if (values.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(values).size !== values.length) return null;
  return (values as number[]).sort((a, b) => a - b);
}

export function readPreheatEntries(data: unknown): Entry[] {
  const invalid = () => new RemoteCommandError('预热预约格式无法识别，已有预约保留。');
  if (data === null || data === '') return [];
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw invalid(); }
  }
  if (!data || typeof data !== 'object' || !('controls' in data) || !Array.isArray(data.controls)) throw invalid();
  const ids = new Set<string>();
  return data.controls.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid();
    const { set_id: id, on, start_time, days } = row;
    const time = typeof start_time === 'string' && /^\d{4}-\d{2}-\d{2}[ T]/.test(start_time) ? start_time.slice(11, 16) : '';
    const repeat = weekdays(days);
    if (typeof id !== 'string' || !id.trim() || ids.has(id) || !['0', '1', 0, 1].includes(on) || !validPreheatTime(time) || !repeat) throw invalid();
    ids.add(id);
    return { plan: { id, enabled: on === '1' || on === 1, start: time, days: repeat }, raw: row };
  });
}

export function samePreheatPlan(a: PreheatSettings, b: PreheatSettings) {
  return a.enabled === b.enabled && a.start === b.start && a.days.join(',') === b.days.join(',');
}

export function preparePreheatEdit(entries: Entry[], edit: PreheatEdit, vin: string, now = Date.now()) {
  const days = weekdays(edit.days);
  if (!validPreheatTime(edit.start) || !days || typeof edit.enabled !== 'boolean') throw new RemoteCommandError('请选择有效的预热时间和重复日期。');
  const previous = edit.previous;
  const existing = entries.find(row => row.plan.id === previous?.id);
  if (previous ? !existing || !samePreheatPlan(previous, existing.plan) : entries.length > 0) {
    throw new RemoteCommandError('预热预约已变更，请重新读取后再保存。');
  }
  const id = existing?.plan.id ?? `Android_${vin}_${now}`;
  // 零跑国内车辆使用中国标准时间。换算后用 UTC 访问该时区的日期和星期。
  const localNow = now + 8 * 3_600_000;
  const start = new Date(localNow);
  const [hours, minutes] = edit.start.split(':').map(Number);
  start.setUTCHours(hours, minutes, 0, 0);
  if (+start <= localNow) start.setUTCDate(start.getUTCDate() + 1);
  while (days.length && !days.includes(start.getUTCDay())) start.setUTCDate(start.getUTCDate() + 1);
  const plan = { id, enabled: edit.enabled, start: edit.start, days };
  const entry = { ...existing?.raw, set_id: id, on: edit.enabled ? '1' : '0',
    start_time: start.toISOString().slice(0, 19).replace('T', ' '), update_time: String(now), days };
  const controls = existing ? entries.map(row => row === existing ? entry : row.raw) : [entry];
  return { plan, controls };
}
