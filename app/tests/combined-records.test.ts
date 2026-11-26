import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combineCharges, combineTrips } from '../src/data/combinedRecords.ts';
import type { Charge, Trip } from '../src/data/ha/measurements.ts';

const minute = 60_000;
const base = 1_800_000_000_000;
const trip = (id: string, source: Trip['source'], from: number, to: number | null): Trip => ({
  id, source, startedAt: base + from * minute, endedAt: to === null ? null : base + to * minute,
  distanceKm: 4, durationMin: null, energyKwh: 1, efficiency: null, avgSpeedKmh: null,
  pointCount: null, complete: to !== null, gap: false, route: [], speeds: [],
});
const charge = (id: string, source: Charge['source'], from: number, to: number, type: Charge['type']): Charge => ({
  id, source, type, startedAt: base + from * minute, endedAt: base + to * minute,
  kwh: source === 'ha' ? 20 : 18, gridKwh: null, socStart: 27, socEnd: 68, cost: null, partial: false, powers: [],
});

test('HA trip replaces overlapping phone fragments while keeping separately recorded drives', () => {
  const phoneOnly = trip('live-older', 'live', 0, 12);
  const after = trip('live-next', 'live', 36, 41);
  const fragments = [trip('live-part-1', 'live', 14, 21), trip('live-part-2', 'live', 22, 35)];
  const master = trip('ha-trip-master', 'ha', 13, 36);
  const rows = combineTrips([phoneOnly, after, ...fragments], [master]);
  assert.deepEqual(rows.trips.map(row => row.id), [after.id, master.id, phoneOnly.id]);
  assert.deepEqual(rows.aliases.get(master.id), fragments.map(row => row.id));
  assert.deepEqual(combineTrips([phoneOnly, after, ...fragments], []).trips.length, 4);
});

test('Charging sessions use one amount and keep adjacent unplug-and-replug sessions', () => {
  const old = charge('official-1', 'live', 30, 60, 'ac');
  const similar = charge('sampled-1', 'live', 62, 96, 'ac');
  const remote = charge('ha-charge-1', 'ha', 61, 97, 'dc');
  const next = charge('sampled-2', 'live', 97, 115, 'dc');
  similar.position = { at: similar.startedAt, lat: 30, lon: 120, coordinate: 'gcj02' };
  const combined = combineCharges([old, similar, next], [remote]);
  assert.deepEqual(combined.charges.map(row => [row.id, row.kwh]), [[next.id, 18], [remote.id, 20], [old.id, 18]]);
  assert.deepEqual(combined.aliases.get(remote.id), [similar.id]);
  assert.deepEqual(combined.charges.find(c => c.id === remote.id)?.position, similar.position);
  assert.equal(combined.charges.find(c => c.id === next.id)?.position, undefined);
});
