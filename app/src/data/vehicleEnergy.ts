import type { Tariff } from './types.ts';
import type { BatteryPack } from './batteryPacks.ts';

export interface VehicleEnergySettings {
  capacityKwh: number | null;
  capacityBasis?: BatteryPack['basis'];
  acEfficiency: number;
  dcEfficiency: number;
}

export const defaultChargeEfficiency = 90;
export const capacityLimits = { min: 10, max: 150 };
export const formatBatteryCapacity = (kwh: number) => kwh.toFixed(2).replace(/0$/, '');

export function validChargeEfficiency(value: number) { return value >= 50 && value <= 100; }

export function defaultVehicleEnergy(preset: BatteryPack | undefined, tariff: Tariff): VehicleEnergySettings {
  const legacy = (value: number, previousDefault: number) =>
    validChargeEfficiency(value) && value !== previousDefault ? value : defaultChargeEfficiency;
  return { capacityKwh: preset?.kwh ?? null, capacityBasis: preset?.basis,
    acEfficiency: legacy(tariff.ac.efficiency, 90), dcEfficiency: legacy(tariff.dc.efficiency, 92) };
}

export function socPercent(value: number | string | null | undefined) {
  if (value == null || typeof value === 'string' && !value.trim()) return null;
  const percent = Number(value);
  return percent >= 0 && percent <= 100 ? percent : null;
}

export function estimateSocEnergy(low: number | null, high: number | null, capacity: number | null) {
  return capacity !== null && low !== null && high !== null && high > low ? (high - low) * capacity / 100 : null;
}
