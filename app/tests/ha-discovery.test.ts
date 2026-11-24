import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverVehicles, vehicleByVin } from '../src/data/ha/discovery.ts';
import type { RegisteredEntity } from '../src/data/ha/discovery.ts';
import { framesOf, openingOf } from '../src/data/ha/measurements.ts';
import { samplesOf } from '../src/data/ha/schema.ts';

const vin = 'LFB1A2B3C4D000001', secondVin = 'LFB1A2B3C4D000002';
const registered = (entity_id: string, key: string, changes: Partial<RegisteredEntity> = {}): RegisteredEntity => ({
  entity_id, platform: 'leapmotor', device_id: 'a', unique_id: `${vin}_${key}`, ...changes,
});

test('registry discovery uses stable identity and matches only the exact cloud VIN', () => {
  const entries = [
    registered('sensor.renamed', 'battery'),
    registered('sensor.second_car', 'battery', { device_id: 'b', unique_id: `${secondVin}_battery` }),
    registered('sensor.phone', 'battery', { platform: 'mobile_app' }),
    registered('sensor.disabled', 'total_mileage', { disabled_by: 'user' }),
    registered('device_tracker.hidden', 'tracker'),
  ];
  const devices = discoverVehicles(entries, [], entries.filter(e => e.entity_id !== 'device_tracker.hidden')
    .map(e => ({ entity_id: e.entity_id, state: '65' })));
  assert.equal(devices.length, 2);
  assert.deepEqual(vehicleByVin(devices, vin.toLowerCase())?.mapping, { soc: 'sensor.renamed' });
  assert.deepEqual(vehicleByVin(devices, secondVin)?.mapping, { soc: 'sensor.second_car' });
  assert.equal(vehicleByVin(devices, '0001'), undefined);
  assert.equal(vehicleByVin(devices.slice(0, 1), secondVin), undefined);
});

test('ambiguous fields and combined range stay unmapped', () => {
  const entries = [registered('sensor.first', 'battery'), registered('sensor.duplicate', 'battery'),
    registered('sensor.range', 'range'), registered('sensor.fuel', 'fuel_level')];
  const states = entries.map(e => ({ entity_id: e.entity_id, state: '100' }));
  assert.deepEqual(discoverVehicles(entries, [], states)[0].mapping, { fuel: 'sensor.fuel' });
  const conflict = [{ device_id: 'a', vin: secondVin }];
  assert.deepEqual(discoverVehicles(entries, conflict, states)[0].mapping, {});
});

test('attributes feed readings from one tracked entity and retain historical gaps', () => {
  const entry = registered('sensor.status', 'vehicle_state');
  const states = [
    { entity_id: entry.entity_id, state: 'driving', last_updated: '2026-11-24T01:00:00Z', attributes: { speed: 40, windows_open: false } },
    { entity_id: entry.entity_id, state: 'parked', last_updated: '2026-11-24T01:01:00Z' },
  ];
  const [vehicle] = discoverVehicles([entry], [], states);
  const frames = framesOf(samplesOf(states), vehicle.mapping);
  assert.deepEqual(frames.map(frame => [frame.data.motion, frame.data.speed, openingOf(frame.data.windows)]),
    [['driving', 40, false], ['parked', null, null]]);
});
