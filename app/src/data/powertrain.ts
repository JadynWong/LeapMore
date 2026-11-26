import { numberOf } from './ha/measurements.ts';
import type { Powertrain } from './types.ts';

export type PowertrainPreference = 'auto' | Powertrain;

export function namedPowertrain(name: string): Powertrain | undefined {
  const electric = /纯电|BEV|\bEV\b/i.test(name);
  const extended = /增程|REEV|EREV|HYBRID/i.test(name);
  if (electric !== extended) return electric ? 'bev' : 'reev';
}

export function powertrainRanges(raw: Record<string, unknown>) {
  const km = (key: string) => {
    const value = numberOf(raw[key]);
    return value !== null && value >= 0 ? value : null;
  };
  const cltc = { fuel: km('3256'), ev: km('3257'), total: km('3258') };
  const wltc = { fuel: km('3259'), ev: km('3260'), total: km('3261') };
  const mode = numberOf(raw['3262']) === 0 ? 'CLTC' : 'WLTC';
  const [primary, fallback] = mode === 'CLTC' ? [cltc, wltc] : [wltc, cltc];
  const fuel = primary.fuel ?? fallback.fuel;
  // Compare a complete pair from one cycle. CLTC and WLTC can differ even on a BEV.
  const cycle = primary.fuel !== null || (primary.ev !== null && primary.total !== null) ? primary : fallback;
  const extraRange = cycle.total !== null && cycle.ev !== null ? cycle.total > cycle.ev : null;
  // Contradictory fuel and total readings must not set a permanent vehicle attribute.
  const evidence = cycle.fuel !== null
    ? (cycle.fuel > 0 && extraRange !== false ? 'fuel-range' : null)
    : (extraRange ? 'combined-range' : null);
  const ev = primary.ev ?? fallback.ev;
  const live = km('2188');
  const sum = (r: typeof cltc) => r.ev !== null && r.fuel !== null ? r.ev + r.fuel : null;
  const combined = sum(primary) ?? sum(fallback) ?? (ev === null && live !== null && fuel !== null ? live + fuel : null);
  return { live, ev, total: primary.total ?? fallback.total, fuel, combined, evidence, mode } as const;
}

export type RangeReadings = ReturnType<typeof powertrainRanges>;

export function displayedRange(type: Powertrain, ranges?: RangeReadings) {
  const order = type === 'bev' ? ['live', 'ev', 'total'] as const : ['total', 'combined', 'ev', 'live'] as const;
  for (const source of order) {
    const km = ranges?.[source];
    if (km != null) return { km, source };
  }
  return { km: null, source: 'missing' } as const;
}

export function resolvePowertrain(preference: PowertrainPreference, named: Powertrain | undefined,
  evidence: ReturnType<typeof powertrainRanges>['evidence'], knownReev: boolean) {
  if (preference !== 'auto') return { type: preference, reason: 'manual' } as const;
  if (named) return { type: named, reason: 'model' } as const;
  if (evidence) return { type: 'reev', reason: evidence } as const;
  if (knownReev) return { type: 'reev', reason: 'remembered' } as const;
  return { type: 'bev', reason: 'no-fuel-range-evidence' } as const;
}
