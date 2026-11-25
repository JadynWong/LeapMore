import { localDay } from './ha/measurements';
import type { Charge, Point, Trip } from './ha/measurements';
import type { EnergyDay, Vehicle } from './types';

export const demoVehicles: Vehicle[] = [
  { id: 'demo-c10', vin: 'DEMO••8821', nickname: '我的 C10', model: 'C10', year: 2026, declaredPowertrain: 'bev', source: 'fixture' },
  { id: 'demo-b10', vin: 'DEMO••3106', nickname: '家里的 B10', model: 'B10', year: 2025, declaredPowertrain: 'bev', source: 'fixture' },
];
export const haVehicle: Vehicle = { id: 'ha-local', vin: '', model: 'C10', nickname: '我的车辆', year: 0, declaredPowertrain: 'bev', source: 'ha' };
export const demoLocation: Point = { at: Date.now() - 120_000, lat: 31.2218, lon: 121.5443, coordinate: 'gcj02' };
export const demoTires = [240, 240, 230, 230];

export function demoEnergy(days: number): EnergyDay[] {
  const sample = [24.5, 16.4, 42.2, 11.4, 33.1, 57.3, 26.8];
  return Array.from({ length: days }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - days + i + 1);
    const km = sample[(7 * days + i - days + 7) % 7];
    const efficiency = 12.1 + (i % 6) * .63;
    return { day: localDay(+date), km, kwh: km * efficiency / 100, efficiency };
  });
}

const at = (days: number, hour: number, min: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.setHours(hour, min, 0, 0);
};

export function demoRecords() {
  const trips: Trip[] = [[0, 18, 32, 12.6, 34], [0, 8, 12, 18.3, 42], [1, 20, 14, 23.4, 55],
    [9, 8, 40, 16.7, 28], [42, 12, 15, 62.6, 78], [370, 14, 10, 38.1, 51]].map(([days, hour, min, distanceKm, durationMin], i) => {
    const startedAt = at(days, hour, min);
    const route = Array.from({ length: 20 }, (_, p) => ({ ...demoLocation, at: startedAt + p * 6000,
      lat: demoLocation.lat - (20 - p) * .0006, lon: demoLocation.lon - (20 - p) * .001 + Math.sin(p / 2) * .002 }));
    return { id: 'demo-trip-' + i, startedAt, endedAt: startedAt + durationMin * 60_000, durationMin, distanceKm,
      energyKwh: distanceKm * .142, efficiency: 14.2, avgSpeedKmh: distanceKm / durationMin * 60, pointCount: route.length,
      source: 'phone', complete: true, gap: false, route,
      speeds: Array.from({ length: 80 }, (_, p) => ({ at: startedAt + p * 6000, value: Math.abs(Math.sin(p * .14) * 47) + (p * 13 % 14) })),
    };
  });
  const charges: Charge[] = [[0, 19, 24, 34.8, 55], [2, 1, 5, 21.4, 240],
    [12, 22, 15, 23.2, 255], [54, 21, 6, 19.7, 201], [372, 23, 17, 26.1, 262]].map(([days, hour, min, kwh, duration], i) => {
    const startedAt = at(days, hour, min);
    return { id: 'demo-charge-' + i, startedAt, endedAt: startedAt + duration * 60_000, source: 'phone', type: i ? 'ac' : 'dc',
      kwh, gridKwh: null, socStart: 32, socEnd: 85, cost: null, partial: false, minRecordedBatteryTempC: i ? 17 : 21,
      powers: Array.from({ length: 20 }, (_, p) => ({ at: startedAt + p * duration * 3000, value: i ? 6.3 - p * .06 : 55 - p * 1.4 })),
    };
  });
  return { trips, charges };
}
