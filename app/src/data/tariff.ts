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

export function displayedChargeFee(charge: ChargeSession, tariff: Tariff, manual?: number) {
  const estimate = estimateChargeRecord(charge, tariff);
  const gridKwh = estimate?.gridKwh ?? charge.gridKwh;
  const unitPrice = manual === undefined ? estimate?.averagePrice : gridKwh != null && gridKwh > 0 ? manual / gridKwh : null;
  return { estimate, gridKwh, unitPrice, amount: manual ?? estimate?.cost ?? null };
}

export function chargeCostTotals(charges: ChargeSession[], tariff: Tariff, getManualFee: (charge: ChargeSession) => number | undefined) {
  const result = { total: null as number | null, ac: null as number | null, dc: null as number | null, count: 0, manualCount: 0 };
  for (const charge of charges) {
    const manual = getManualFee(charge);
    const amount = manual ?? estimateChargeRecord(charge, tariff)?.cost;
    if (amount === undefined) continue;
    if (manual !== undefined) result.manualCount++;
    if (charge.type === 'ac' || charge.type === 'dc') result[charge.type] = (result[charge.type] ?? 0) + amount;
    result.total = (result.total ?? 0) + amount;
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
