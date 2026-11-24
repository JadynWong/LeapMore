import type { ChargeSession, ChargeType, Tariff } from './types';

export interface ChargeEstimateInput {
  type: ChargeType;
  batteryKwh: number;
  durationMin: number;
  startHHMM: string;
}
export interface ChargeEstimate {
  type: 'ac' | 'dc';
  gridKwh: number;
  averagePrice: number;
  cost: number;
}

function toMinutes(hhmm: string): number {
  const parts = hhmm.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}
function inRange(minute: number, start: string, end: string): boolean {
  const s = toMinutes(start); const e = toMinutes(end);
  if (s === e) return false;
  return s < e ? minute >= s && minute < e : minute >= s || minute < e;
}
export function priceAt(type: 'ac' | 'dc', minute: number, tariff: Tariff): number {
  if (type === 'ac') return inRange(minute, tariff.ac.valleyStart, tariff.ac.valleyEnd) ? tariff.ac.valley : tariff.ac.peak;
  const period = tariff.dc.periods.find((p) => inRange(minute, p.start, p.end));
  return period ? period.price : 0;
}

export function estimateCharge(input: ChargeEstimateInput, tariff: Tariff): ChargeEstimate {
  const type = input.type === 'dc' ? 'dc' : 'ac';
  const efficiency = type === 'ac' ? tariff.ac.efficiency : tariff.dc.efficiency;
  const gridKwh = input.batteryKwh / Math.max(0.01, efficiency / 100);
  const minutes = Math.max(1, input.durationMin);
  const dayMinutes = 24 * 60;
  const days = Math.floor(minutes / dayMinutes), remainder = minutes % dayMinutes;
  const start = toMinutes(input.startHHMM);
  let total = 0;
  for (let i = 0; i < (days ? dayMinutes : Math.ceil(remainder)); i += 1) {
    const weight = days + Math.max(0, Math.min(1, remainder - i));
    total += weight * priceAt(type, (start + i) % dayMinutes, tariff);
  }
  const averagePrice = total / minutes;
  return { type, gridKwh, averagePrice, cost: gridKwh * averagePrice };
}

export function estimateChargeRecord(charge: ChargeSession, tariff: Tariff) {
  if (charge.kwh === null || charge.endedAt === null || charge.endedAt <= charge.startedAt ||
      (charge.type !== 'ac' && charge.type !== 'dc') || charge.partial) return null;
  const start = new Date(charge.startedAt);
  return estimateCharge({ type: charge.type, batteryKwh: charge.kwh,
    durationMin: (charge.endedAt - charge.startedAt) / 60_000, startHHMM: `${start.getHours()}:${start.getMinutes()}` }, tariff);
}

export function chargeCostTotals(charges: ChargeSession[], tariff: Tariff) {
  const result = { total: null as number | null, ac: null as number | null, dc: null as number | null, count: 0 };
  for (const charge of charges) {
    const estimate = estimateChargeRecord(charge, tariff);
    if (!estimate) continue;
    result[estimate.type] = (result[estimate.type] ?? 0) + estimate.cost;
    result.total = (result.total ?? 0) + estimate.cost;
    result.count++;
  }
  return result;
}

export function chargeWindowStart(days: number, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return start.getTime();
}
