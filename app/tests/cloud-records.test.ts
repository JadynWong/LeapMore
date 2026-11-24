import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendCloudFrame, cloudDay, cloudFrame, dayStart, energyParts, officialCharge } from '../src/data/cloud/records.ts';
import { CloudRateLimited, VehiclePolling, vehicleRateLimited } from '../src/data/cloud/polling.ts';
import { deriveTrips, framesOf } from '../src/data/ha/measurements.ts';
import type { Frame, Reading } from '../src/data/ha/measurements.ts';
import type { CarState } from '../src/data/types.ts';
import { reconcileCharges, sampledCharges } from '../src/data/cloud/charges.ts';
import { defaultVehicleEnergy } from '../src/data/vehicleEnergy.ts';
import { vehicleBatteryPacks } from '../src/data/batteryPacks.ts';
import { estimateChargeRecord } from '../src/data/tariff.ts';
import type { Tariff } from '../src/data/types.ts';

const start = Date.UTC(2026, 10, 22, 16);
const frame = (second: number, data: Reading): Frame => ({ at: start + second * 1000, data, changed: ['power', 'speed', 'odometer'] });

test('Vehicle reports drive the HA polling tiers and rate-limit cooldown', () => {
  const policy = new VehiclePolling();
  const parked = { isDriving: false, parked: true, locked: true, charging: 'unplugged' } as const;
  policy.observe({ ...parked, reportedAt: start }, start);
  assert.equal(policy.delay(start), 60_000);
  policy.observe({ ...parked, locked: false, reportedAt: start + 1000 }, start + 1000);
  assert.equal(policy.delay(start + 1000), 6000);
  policy.observe({ ...parked, locked: false, reportedAt: start + 600_000 }, start + 600_000);
  assert.equal(policy.delay(start + 601_001), 60_000);
  policy.observe({ ...parked, isDriving: true, parked: false, reportedAt: start + 602_000 }, start + 602_000);
  assert.equal(policy.delay(start + 602_000), 6000);
  policy.observe({ ...parked, reportedAt: start + 608_000 }, start + 608_000);
  assert.equal(policy.delay(start + 608_000), 6000);
  policy.observe({ ...parked, charging: 'charging', reportedAt: start + 614_000 }, start + 614_000);
  assert.equal(policy.delay(start + 614_000), 60_000);

  assert.ok(vehicleRateLimited({ _status: 429, code: 0 }));
  assert.ok(vehicleRateLimited({ code: 1023 }));
  assert.ok(vehicleRateLimited({ message: '操作过于频繁' }));
  assert.ok(!vehicleRateLimited({ code: 0, message: '请求成功' }));
  policy.rateLimit(start + 620_000);
  assert.equal(policy.delay(start + 620_000), 120_000);
  assert.throws(() => policy.beforeRequest(start + 621_000), CloudRateLimited);
  policy.beforeRequest(start + 740_000);
  assert.throws(() => policy.beforeRequest(start + 741_000), CloudRateLimited);
  assert.equal(policy.delay(start + 1_520_000), 60_000);
});

test('Duplicate and stale reports cannot keep driving or activate launch boost', () => {
  const policy = new VehiclePolling();
  const report = { isDriving: true, locked: true, charging: 'unplugged', reportedAt: start } as const;
  policy.observe(report, start);
  policy.observe({ ...report, isDriving: false, locked: false }, start + 60_000);
  policy.observe({ ...report, isDriving: false, locked: false, reportedAt: start + 1000 }, start + 100_000);
  assert.equal(policy.delay(start + 100_000), 60_000);
});

test('Vehicle location is optional for cloud journey sampling', () => {
  const state = { reportedAt: start, isDriving: true, speedKmh: 50, odometer: 101,
    latitude: 31.2, longitude: 121.5 } as CarState;
  assert.deepEqual(cloudFrame(state, true, start)?.data.position, { at: start, lat: 31.2, lon: 121.5, coordinate: 'gcj02' });
  assert.equal(cloudFrame(state, false, start)?.data.position, null);
  assert.equal(cloudFrame(state, false, start)?.data.odometer, 101);
});

test('Phone trip energy uses a valid positive SOC drop and the selected battery capacity', () => {
  const frames = [
    frame(0, { motion: 'parked', soc: 60, odometer: 100 }),
    frame(6, { motion: 'driving', soc: 60, odometer: 100 }),
    frame(12, { motion: 'driving', soc: 58, odometer: 103 }),
    frame(18, { motion: 'parked', odometer: 105 }),
  ];
  const trip = deriveTrips(frames, 'live', 67)[0];
  assert.equal(trip.socStart, 60);
  assert.equal(trip.socEnd, 58);
  assert.equal(trip.energyKwh, 1.34);
  assert.equal(trip.efficiency, 26.8);
  assert.equal(deriveTrips(frames, 'live', 55)[0].energyKwh, 1.1);
  assert.equal(deriveTrips(frames, 'live')[0].energyKwh, null);
  assert.equal(deriveTrips([frames[0], frame(6, { motion: 'driving', soc: 101 }), ...frames.slice(2)], 'live', 67)[0].energyKwh, null);
  assert.equal(deriveTrips([...frames.slice(0, 3), frame(18, { motion: 'parked', soc: 61, odometer: 105 })], 'live', 67)[0].energyKwh, null);
});

const chargeFrame = (second: number, charge: string, soc: number | null, power?: number): Frame => ({
  at: start + second * 1000, data: { motion: 'parked', charge, chargeType: 'ac', soc, power }, changed: ['charge', 'soc', 'power'],
});
const tariff: Tariff = {
  ac: { peak: 1, valley: 1, valleyStart: '23:00', valleyEnd: '07:00', efficiency: 90 },
  dc: { periods: [{ start: '00:00', end: '23:59', price: 1 }], efficiency: 92 },
};
const parts = { capacityKwh: 50, acEfficiency: 80, dcEfficiency: 95 };

test('Charge sampling retains charge curves, uses SOC, and combines official energy without counting twice', () => {
  const frames = [
    chargeFrame(0, 'unplugged', 40), chargeFrame(60, 'charging', 40, 6.2),
    chargeFrame(180, 'charging', 41), chargeFrame(360, 'charging', 42, 6.4),
    chargeFrame(420, 'plugged', 42), chargeFrame(480, 'plugged', 42), chargeFrame(540, 'unplugged', 42),
  ].reduce(appendCloudFrame, [] as Frame[]);
  const [sample] = sampledCharges(frames, parts.capacityKwh, start + 550_000);
  assert.ok(sample);
  assert.deepEqual(sample.powerTimeline?.map(entry => [entry.value, entry.soc]), [[6.2, 40], [null, 41], [6.4, 42]]);
  assert.equal(sample.kwh, 1);
  assert.equal(sample.partial, false);
  assert.equal(sample.energyBasis, 'soc');
  assert.equal(reconcileCharges([], [sample], parts)[0].gridKwh, 1.25);
  const known = officialCharge({ chargeGunStartTs: start + 50_000, chargeGunEndTs: start + 400_000,
    chargeInEnergy: 1.2, chargeType: 'SLOW' })!;
  const rows = reconcileCharges([known], [sample], parts);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, known.id);
  assert.equal(rows[0].sampledId, sample.id);
  assert.equal(rows[0].energyBasis, 'official');
  assert.equal(rows[0].kwh, 1.2);
  assert.equal(rows[0].gridKwh, 1.5);
  assert.equal(rows[0].socEnd, 42);
  assert.ok(Math.abs((estimateChargeRecord(rows[0], { ...tariff, ac: { ...tariff.ac, efficiency: parts.acEfficiency } })?.cost ?? 0) - 1.5) < 1e-9);
  assert.equal(reconcileCharges([{ ...known, type: 'dc' }], [], parts)[0].gridKwh, 120 / 95);
});

test('Unknown charging state and long gaps never add unobserved SOC to charging energy', () => {
  const frames = [chargeFrame(0, 'unplugged', 40), chargeFrame(60, 'charging', 40),
    chargeFrame(120, 'charging', 42), chargeFrame(1200, 'charging', 60), chargeFrame(1260, 'charging', 61)];
  const rows = sampledCharges(frames, 50, start + 2_200_000);
  assert.deepEqual(rows.map(charge => charge.kwh), [1, 0.5]);
  assert.ok(rows.every(charge => charge.partial && !charge.active));
  const stopped = sampledCharges([...frames.slice(0, 3), chargeFrame(180, 'unknown', 42)], 50, start + 190_000);
  assert.equal(stopped[0].partial, true);
  const implausible = sampledCharges([chargeFrame(60, 'charging', 40), chargeFrame(66, 'charging', 100)], 50, start + 70_000);
  assert.equal(implausible[0].kwh, null);
});

test('Battery pack settings respect identified variants and preserve earlier custom charge efficiency', () => {
  const usable = vehicleBatteryPacks({ model: 'C10 530 后驱' }, 'bev').preset;
  assert.equal(usable?.kwh, 67);
  assert.equal(usable?.basis, 'usable');
  const published = vehicleBatteryPacks({ model: 'C10 2027款 纯电660智享版' }).preset;
  assert.equal(published?.kwh, 81.9);
  assert.equal(published?.basis, 'published');
  assert.equal(vehicleBatteryPacks({ model: 'C10 AWD' }, 'bev').preset, undefined);
  assert.equal(vehicleBatteryPacks({ model: 'B10' }, 'bev').preset, undefined);
  assert.deepEqual(vehicleBatteryPacks({ model: '零跑', carType: 'B05' }, 'bev').choices.map(pack => pack.kwh), [56.2, 67.1, 69.7]);
  assert.equal(vehicleBatteryPacks({ model: 'T03' }, 'bev').preset, undefined);
  assert.equal(vehicleBatteryPacks({ model: 'C16 280 增程' }).preset, undefined);
  assert.equal(vehicleBatteryPacks({ model: 'C16 280 增程', year: 2026 }).preset?.kwh, 38.7);
  assert.equal(vehicleBatteryPacks({ model: 'C11 580 四驱', year: 2024 }).preset?.kwh, 89.97);
  assert.equal(vehicleBatteryPacks({ model: 'C11 580', year: 2024 }).preset, undefined);
  assert.deepEqual(defaultVehicleEnergy(usable, tariff), { capacityKwh: 67, capacityBasis: 'usable', acEfficiency: 90, dcEfficiency: 90 });
  assert.equal(defaultVehicleEnergy(published, { ...tariff, dc: { ...tariff.dc, efficiency: 95 } }).dcEfficiency, 95);
});

test('All current mainland series have distinct published variant presets and legacy packs remain available', () => {
  const examples = [
    ['T03 310 舒享版', 31.9], ['A05S 510', 53], ['A10 403', 39.8], ['B01 590', 60.8],
    ['B10 610', 69.7], ['Lafa 5 605 Pro', 67.1], ['C10 290 增程', 38.7],
    ['C11 2027款 300 增程', 41.7], ['C16 2027款 280 增程', 38.9], ['D19 增程 400', 63.7],
    ['D99 纯电 700', 115], ['C01 316 增程', 43.7], ['S01 380 Pro', 35.6],
  ] as const;
  for (const [model, kwh] of examples) {
    const { choices, preset } = vehicleBatteryPacks({ model });
    assert.equal(preset?.kwh, kwh, model);
    assert.equal(preset?.basis, 'published', model);
    assert.equal(new Set(choices.map(pack => pack.label)).size, choices.length, model);
  }
  assert.equal(vehicleBatteryPacks({ model: 'D99' }).preset, undefined);
  assert.equal(vehicleBatteryPacks({ model: 'D99' }, 'reev').preset?.kwh, 80.3);
  assert.equal(vehicleBatteryPacks({ model: 'C18' }).choices.length, 0);
});

test('The capacity catalog contains mainland battery variants only', () => {
  assert.deepEqual(vehicleBatteryPacks({ model: 'A10' }).choices.map(pack => pack.kwh), [39.8, 53]);
  assert.deepEqual(vehicleBatteryPacks({ model: 'B10' }).choices.map(pack => pack.kwh), [56.2, 67.1, 60.8, 69.7]);
  assert.ok(!vehicleBatteryPacks({ model: 'T03' }).choices.some(pack => pack.kwh === 36));
  assert.equal(vehicleBatteryPacks({ model: 'B03X' }).choices.length, 0);
});

test('Cloud energy uses China calendar windows and rejects partial breakdown totals', () => {
  assert.equal(dayStart(start + 60_000), start);
  assert.equal(cloudDay(start - 1), '2026-11-22');
  assert.equal(cloudDay(start), '2026-11-23');
  const parts = energyParts({ driverEC: '8.2', acEC: '1.2', otherEC: '.6' });
  assert.deepEqual([parts.drive, parts.climate, parts.other], [8.2, 1.2, .6]);
  assert.ok(parts.total !== null && Math.abs(parts.total - 10) < 1e-9);
  assert.equal(energyParts({ driverEC: 5, acEC: 0, otherEC: null }).total, null);
});

test('Duplicate cloud frames do not extend a drive across an observation gap', () => {
  const stopped = frame(0, { motion: 'parked', odometer: 100 });
  const drive = frame(10, { motion: 'driving', speed: 30, odometer: 100 });
  let history = appendCloudFrame([stopped], drive);
  assert.equal(appendCloudFrame(history, drive), history);
  history = appendCloudFrame(history, frame(22, { motion: 'driving', speed: 40, odometer: 101 }));
  history = appendCloudFrame(history, frame(600, { motion: 'parked', odometer: 113 }));
  const trip = deriveTrips(history, 'live')[0];
  assert.equal(trip.complete, false);
  assert.equal(trip.distanceKm, 1);
  assert.equal(trip.energyKwh, null);
  assert.equal(trip.gap, true);
});

test('Official charging exposes the measured session without sampled detail', () => {
  const official = officialCharge({ chargeGunStartTs: start + 10_000, chargeGunEndTs: start + 130_000,
    chargeInEnergy: '0.2', chargeType: 'SLOW' });
  assert.ok(official);
  assert.equal(official.kwh, .2);
  assert.equal(official.type, 'ac');
  assert.equal(official.socStart, null);
  assert.deepEqual(official.powers, []);
});

test('HA tire pressures use kPa while preserving already normalized readings', () => {
  const frames = framesOf([
    { entity: 'sensor.kpa', at: start, state: '218', attrs: { unit_of_measurement: 'kPa' } },
    { entity: 'sensor.bar', at: start, state: '2.4', attrs: { unit_of_measurement: 'bar' } },
    { entity: 'sensor.psi', at: start, state: '35', attrs: { unit_of_measurement: 'psi' } },
  ], { tireFL: 'sensor.kpa', tireFR: 'sensor.bar', tireRL: 'sensor.psi' });
  assert.equal(frames[0].data.tireFL, 218);
  assert.equal(frames[0].data.tireFR, 240);
  assert.equal(Math.round(Number(frames[0].data.tireRL)), 241);
});
