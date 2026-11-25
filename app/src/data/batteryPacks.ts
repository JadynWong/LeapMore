import type { Powertrain, Vehicle } from './types.ts';
import { namedPowertrain } from './powertrain.ts';

export interface BatteryPack {
  label: string;
  kwh: number;
  basis: 'usable' | 'published';
  ranges?: readonly number[];
  years?: readonly number[];
  variant?: RegExp;
}

const published = (label: string, kwh: number, ranges?: readonly number[], years?: readonly number[]): BatteryPack =>
  ({ label, kwh, basis: 'published', ranges, years });
const usable = (label: string, kwh: number, ranges?: readonly number[], years?: readonly number[]): BatteryPack =>
  ({ label, kwh, basis: 'usable', ranges, years });
const fourWheelDrive = /AWD|4WD|四驱|双电机/;

// Sources and capacity definitions are listed in app/README.md.
const packs: Record<string, Partial<Record<Powertrain, readonly BatteryPack[]>>> = {
  T03: { bev: [
    published('200 km', 21.6, [200]),
    published('310 km', 31.9, [310]),
    published('403 km · 2023款起', 41.3, [403], [2023, 2024, 2025, 2026]),
    published('403 km · 2020款', 36.5, [403], [2020]),
    published('403 km · 2021款 38 kWh 电池', 38, [403], [2021]),
    published('403 km · 2021款 41 kWh 电池', 41, [403], [2021]),
  ] },
  A05: { bev: [published('405 km', 39.8, [405]), published('510 km', 53, [510])] },
  A10: { bev: [published('403 km', 39.8, [403]), published('505 km', 53, [505])] },
  B01: { bev: [
    published('430 km', 43.9, [430]),
    published('550 km', 56.2, [550]),
    published('650 km', 67.1, [650]),
    published('590 km · 2027款', 60.8, [590], [2027]),
    published('670 km · 2027款', 69.7, [670], [2027]),
  ] },
  B10: { bev: [
    published('510 km · 2025款', 56.2, [510], [2025]),
    published('600 km · 2025款', 67.1, [600], [2025]),
    published('540 km · 2027款', 60.8, [540], [2027]),
    published('610 km · 2027款', 69.7, [610], [2027]),
  ] },
  LAFA5: { bev: [
    published('515 km · 2026款', 56.2, [515], [2026]),
    published('605 km · 2026款', 67.1, [605], [2026]),
    published('640 km · 2027款预售', 69.7, [640], [2027]),
  ] },
  C10: {
    bev: [
      published('410 km · 2024款', 52.9, [410], [2024]),
      usable('530 km 后驱', 67, [530], [2024, 2026]),
      published('605 km · 2026款', 74.9, [605], [2026]),
      published('660 km · 2027款', 81.9, [660], [2027]),
    ],
    reev: [published('210 km · 2024/2026款', 28.4, [210], [2024, 2026]), published('290 km · 2027款', 38.7, [290], [2027])],
  },
  C11: {
    bev: [
      published('515 km · 2024款', 69.2, [515], [2024]),
      { ...published('580 km 后驱 · 2024款', 78.5, [580], [2024]), variant: /RWD|后驱|两驱/ },
      { ...published('580 km 四驱', 89.97, [580], [2023, 2024]), variant: fourWheelDrive },
      published('640 km · 2026/2027款', 81.9, [640], [2026, 2027]),
    ],
    reev: [
      published('180/200 km · 2023/2024款', 30.1, [180, 200], [2023, 2024]),
      published('285/300 km · 2023/2024款', 43.74, [285, 300], [2023, 2024]),
      published('300 km · 2026/2027款', 41.7, [300], [2026, 2027]),
    ],
  },
  C16: {
    bev: [
      published('520 km · 2024款', 67.7, [520], [2024]),
      published('580 km · 2024/2026款', 74.9, [580], [2024, 2026]),
      published('630 km · 2026/2027款', 81.9, [630], [2026, 2027]),
    ],
    reev: [
      published('200 km · 2024/2026款', 28.4, [200], [2024, 2026]),
      published('280 km · 2026款', 38.7, [280], [2026]),
      published('280 km · 2027款', 38.9, [280], [2027]),
    ],
  },
  D19: {
    bev: [published('620 km', 99.6, [620]), published('680/720 km', 115, [680, 720])],
    reev: [published('400 km', 63.7, [400]), published('500 km', 80.3, [500])],
  },
  D99: {
    bev: [published('700 km', 115, [700])],
    reev: [published('480 km', 80.3, [480])],
  },
  C01: {
    bev: [
      published('525 km', 62.8, [525]),
      published('625 km · 2024款', 78.5, [625], [2024]),
      published('2022/2023款长续航', 78.54),
      published('超长续航／四驱', 90),
    ],
    reev: [published('216 km', 30.1, [216]), published('316 km', 43.7, [316])],
  },
  S01: { bev: [published('380 版', 35.6, [380]), published('460 版', 48, [460])] },
};

type BatteryVehicle = Pick<Vehicle, 'model' | 'carType'> & Partial<Pick<Vehicle, 'year'>>;
const unique = (matches: readonly BatteryPack[]) =>
  matches.length && matches.every(pack => pack.kwh === matches[0].kwh && pack.basis === matches[0].basis) ? matches[0] : undefined;

export function vehicleBatteryPacks(vehicle: BatteryVehicle | undefined, reportedPowertrain?: Powertrain) {
  const name = [vehicle?.model, vehicle?.carType].filter(Boolean).join(' ').toUpperCase().replace(/[_-]/g, ' ');
  const family = /LAFA\s*5|A05|A10|B01|B05|B10|C01|C10|C11|C16|D19|D99|S01|T03/.exec(name)?.[0];
  if (!family) return { choices: [], preset: undefined };
  const key = family.replace(/\s/g, '');
  const model = packs[key === 'B05' ? 'LAFA5' : key];
  const powertrain = reportedPowertrain ?? namedPowertrain(name);
  const choices = (['bev', 'reev'] as const).flatMap(type => !powertrain || type === powertrain ?
    (model[type] ?? []).map(pack => ({
      ...pack,
      label: model.bev && model.reev ? (type === 'bev' ? '纯电 ' : '增程 ') + pack.label : pack.label,
    })) : []);
  const yearInName = /(?:^|\D)(20\d{2})\s*款/.exec(name)?.[1];
  const year = Number(yearInName ?? vehicle?.year ?? 0);
  const numbers = (name.match(/\d+/g) ?? []).map(Number);
  const matchesYear = (pack: BatteryPack) => !year || !pack.years || pack.years.includes(year);
  const sameYear = choices.filter(matchesYear);
  const ranges = choices.filter(pack => pack.ranges?.some(range => numbers.includes(range)));
  const rangesForYear = ranges.filter(matchesYear);
  const byRange = rangesForYear.length ? rangesForYear : ranges;
  const byVariant = byRange.filter(pack => pack.variant?.test(name));
  const preset = unique(byVariant) ?? unique(byRange.length ? byRange : sameYear);
  return { choices, preset };
}
