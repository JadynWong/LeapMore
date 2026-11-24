import md5 from 'blueimp-md5';
import type { CarState } from '../types';
import type { PreheatEdit } from './preheat';

export type WindowTarget = 'closed' | 'vent' | 'half' | 'full';
export type ClimateMode = 'cool' | 'heat' | 'vent' | 'def';
export type CabinHeater = 'steeringHeat' | 'mirrorHeat';
export type ChargePlanPatch = { limit?: number; enabled?: boolean; start?: string; end?: string; days?: number[] };
export type Destination = { name: string; address: string; lat: number; lon: number; poiId?: string };
export type RemoteCommand =
  | { kind: 'lock'; locked: boolean }
  | { kind: 'trunk' | 'shade'; open: boolean }
  | { kind: 'window'; position: WindowTarget }
  | { kind: 'find' }
  | { kind: 'climate'; on: boolean; mode: ClimateMode; temp: number; fan: number; preset?: boolean }
  | { kind: 'seat'; feature: 'seat' | 'vent'; level: number }
  | { kind: 'cabinHeat'; feature: CabinHeater; on: boolean }
  | { kind: 'charge'; plan: ChargePlanPatch }
  | { kind: 'charge'; health: boolean }
  | { kind: 'preheat'; edit: PreheatEdit }
  | { kind: 'navigation'; destination: Destination };

export class RemoteCommandError extends Error {}
export class OperationPinRejected extends RemoteCommandError {}

const windowValues = { closed: '0', vent: '2', half: '5', full: '10' };
const climateModes = { cool: 'cold', heat: 'hot', vent: 'nohotcold', def: 'nohotcold' };
export const weekdays = [0, 1, 2, 3, 4, 5, 6];

export function chargeRepeatDays(circulation: number | null, cycles: unknown): number[] | null {
  if (circulation === 0) return [];
  if (circulation !== 1 || typeof cycles !== 'string') return null;
  const parts = cycles.split(',').map(value => value.trim());
  if (parts.length === 7 && parts.every(value => value === '0' || value === '1')) return weekdays.filter(day => parts[day] === '1');
  // Older plans can use weekday numbers 1–7, with Sunday at 7.
  if (parts.every(value => /^[1-7]$/.test(value)) && new Set(parts).size === parts.length) return weekdays.filter(day => parts.includes(String(day || 7)));
  return null;
}

export async function encryptOperationPin(pin: string, carToken: string) {
  if (!/^\d{4,6}$/.test(pin) || carToken.length < 64) throw new RemoteCommandError('操作密码或车辆会话不可用。');
  const utf8 = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', utf8.encode(md5(carToken.slice(0, 32)).slice(8, 24)), 'AES-CBC', false, ['encrypt']);
  const iv = utf8.encode(md5(carToken.slice(32, 64)).slice(8, 24));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, utf8.encode(pin));
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

export function chargePlanState(patch: ChargePlanPatch, current: Record<string, unknown>) {
  const configured = (value: unknown) => value !== null && value !== undefined && value !== '';
  const days = patch.days;
  if (days && (days.some(day => !weekdays.includes(day)) || new Set(days).size !== days.length)) {
    throw new RemoteCommandError('请选择有效的重复日期。');
  }
  const state = {
    chargeEnable: patch.enabled === undefined ? Number(current.isEnable) : Number(patch.enabled),
    chargesoc: patch.limit ?? Number(current.percent),
    circulation: days ? Number(days.length > 0) : Number(current.circulation),
    cycles: days ? weekdays.map(day => days.includes(day) ? '1' : '0').join(',') : String(current.cycles ?? ''),
    endtime: patch.end ?? String(current.endTime ?? '').slice(0, 5),
    recharge: Number(current.recharge),
    starttime: patch.start ?? String(current.beginTime ?? '').slice(0, 5),
  };
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (['isEnable', 'percent', 'circulation', 'recharge'].some(key => !configured(current[key]))
    || ![state.chargeEnable, state.circulation, state.recharge].every(value => value === 0 || value === 1)
    || !Number.isInteger(state.chargesoc) || state.chargesoc < 50 || state.chargesoc > 100
    || !state.cycles || !time.test(state.starttime) || !time.test(state.endtime)) {
    throw new RemoteCommandError('充电计划数据不完整，请刷新后重试。');
  }
  return state;
}

export function encodeRemote(command: Exclude<RemoteCommand, { kind: 'preheat' }>, plan: Record<string, unknown> = {}) {
  switch (command.kind) {
    case 'lock': return { id: 110, state: { value: command.locked ? 'lock' : 'unlock' } };
    case 'find': return { id: 120, state: { value: 'true' } };
    case 'trunk': return { id: 130, state: { value: String(command.open) } };
    case 'window': return { id: 230, state: { value: windowValues[command.position] } };
    case 'shade': return { id: 240, state: { value: command.open ? '10' : '0' } };
    case 'climate': {
      const { on, mode, fan, temp, preset } = command;
      return { id: 170, state: {
        operate: !on ? 'off' : mode === 'def' ? 'auto' : 'manual',
        mode: on ? climateModes[mode] : 'nohotcold',
        circle: on && (mode === 'def' || preset && (mode === 'cool' || mode === 'heat')) ? 'in' : 'out',
        position: 'all', temperature: String(temp), windlevel: fan,
        wshld: on && mode === 'def' ? '2' : !on || preset ? '1' : '0',
      } };
    }
    case 'seat': return { id: command.feature === 'seat' ? 301 : 370, state: { position: 'driver', level: String(command.level) } };
    case 'cabinHeat': {
      const setting = command.on ? '2' : '1';
      return command.feature === 'steeringHeat' ? { id: 320, state: { level: setting } } : { id: 440, state: { value: setting } };
    }
    case 'charge': return 'health' in command
      ? { id: null, state: command.health ? '1' : '0' }
      : { id: 190, state: chargePlanState(command.plan, plan) };
    case 'navigation': {
      const { name, address, lat, lon, poiId } = command.destination;
      return { id: 180, state: { addresskey: poiId ?? '', address, addressname: name, latitude: String(lat), longitude: String(lon), linenum: '0' } };
    }
  }
}

export function reportedWindowPosition(percent: CarState['windowPercent']): WindowTarget | null {
  if (!percent || percent.length !== 4 || percent.some(value => value === null)) return null;
  if (percent.every(value => value === 0)) return 'closed';
  if (percent.every(value => value !== null && value >= 95)) return 'full';
  if (percent.every(value => value !== null && value >= 45 && value <= 55)) return 'half';
  if (percent.every(value => value !== null && value >= 15 && value <= 25)) return 'vent';
  return null;
}

export function matchesRemoteState(command: RemoteCommand, state: CarState): boolean {
  switch (command.kind) {
    case 'lock': return state.locked === command.locked;
    case 'trunk': return state.trunkOpen === command.open;
    case 'shade': return state.sunshadePercent === (command.open ? 100 : 0);
    case 'window': return command.position === 'closed'
      ? state.windowOpen === false
      : state.windowOpen === true && reportedWindowPosition(state.windowPercent) === command.position;
    case 'climate': return state.climateOn === command.on && (!command.on || state.climateTempC === command.temp && state.climateFan === command.fan);
    case 'seat': return (command.feature === 'seat' ? state.seatHeat : state.seatVent) === command.level;
    case 'cabinHeat': return state[command.feature] === command.on;
    case 'charge': return 'health' in command && state.healthCharging === command.health;
    default: return false;
  }
}

export type ConfirmedControl = { command: RemoteCommand; sentAt: number; confirmedAt: number };
export const controlEchoWindow = 25_000;

export function awaitingControlEcho(state: CarState | undefined, confirmation: ConfirmedControl, now: number) {
  const reportedAt = state?.reportedAt ?? state?.updatedAt ?? 0;
  return now < confirmation.confirmedAt + controlEchoWindow && reportedAt < confirmation.confirmedAt + 5_000 &&
    (!state || reportedAt < confirmation.sentAt || !matchesRemoteState(confirmation.command, state));
}

export function confirmedStatePatch(command: RemoteCommand): Partial<CarState> | null {
  switch (command.kind) {
    case 'lock': return { locked: command.locked };
    case 'trunk': return { trunkOpen: command.open };
    case 'shade': return { sunshadeOpen: command.open, sunshadePercent: command.open ? 100 : 0 };
    case 'window': return { windowOpen: command.position !== 'closed', windowPercent: Array<number>(4).fill(Number(windowValues[command.position]) * 10) };
    case 'climate': return command.on ? { climateOn: true, climateTempC: command.temp, climateFan: command.fan } : { climateOn: false };
    case 'seat': return command.feature === 'seat' ? { seatHeat: command.level } : { seatVent: command.level };
    case 'cabinHeat': return { [command.feature]: command.on };
    case 'charge': return 'health' in command ? { healthCharging: command.health } : null;
    default: return null;
  }
}

export function applyConfirmedControls(state: CarState | undefined, confirmations: ConfirmedControl[], now: number) {
  if (!state) return state;
  return confirmations.reduce((current, confirmation) => awaitingControlEcho(state, confirmation, now)
    ? { ...current, ...confirmedStatePatch(confirmation.command) } : current, state);
}
