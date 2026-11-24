import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePreheatEdit, readPreheatEntries } from '../src/data/cloud/preheat.ts';
import { chargePlanState, chargeRepeatDays } from '../src/data/cloud/remote.ts';
import { maskPhone } from '../src/data/phoneMask.ts';

const now = Date.parse('2026-11-24T13:00:00Z');
const first = { set_id: 'first', on: '1', start_time: '2026-11-25 07:00:00', days: [1], extra: 'keep' };
const second = { set_id: 'second', on: '0', start_time: '2026-11-25 08:00:00', days: [] };

test('Preheat updates the selected schedule and preserves all other cloud fields', () => {
  const entries = readPreheatEntries(JSON.stringify({ controls: [first, second] }));
  const result = preparePreheatEdit(entries, { previous: entries[0].plan, enabled: true, start: '06:30', days: [1] }, 'TEST', now);
  assert.deepEqual(result.controls, [{ ...first, start_time: '2026-11-30 06:30:00', update_time: String(now) }, second]);
  assert.deepEqual(result.plan, { id: 'first', enabled: true, start: '06:30', days: [1] });
});

test('A new one-time preheat schedule uses the next occurrence in vehicle time', () => {
  const result = preparePreheatEdit(readPreheatEntries(null), { enabled: true, start: '07:00', days: [] }, 'TEST', now);
  assert.deepEqual(result.controls, [{ set_id: `Android_TEST_${now}`, on: '1', start_time: '2026-11-25 07:00:00', update_time: String(now), days: [] }]);
});

test('An unknown or changed schedule cannot become an empty replacement', () => {
  assert.throws(() => readPreheatEntries(undefined), /无法识别/);
  assert.throws(() => readPreheatEntries({ controls: [first, first] }), /无法识别/);
  const entries = readPreheatEntries({ controls: [first] });
  const edit = { enabled: false, start: '07:00', days: [] };
  assert.throws(() => preparePreheatEdit(entries, edit, 'TEST', now), /已变更/);
  assert.throws(() => preparePreheatEdit(entries, { ...edit, previous: { ...entries[0].plan, start: '08:00' } }, 'TEST', now), /已变更/);
});

test('Charge repeats preserve the Sunday-first cloud mask and support one-time schedules', () => {
  const current = { isEnable: 1, percent: 80, circulation: 1, recharge: 1, cycles: '1,1,1,1,1,1,1', beginTime: '23:00', endTime: '06:00' };
  const edited = chargePlanState({ days: [0, 2, 6] }, current);
  assert.equal(edited.cycles, '1,0,1,0,0,0,1');
  assert.deepEqual(chargeRepeatDays(edited.circulation, edited.cycles), [0, 2, 6]);
  assert.deepEqual(chargeRepeatDays(1, '1,2,3,4,5'), [1, 2, 3, 4, 5]);
  assert.equal(chargePlanState({ days: [] }, current).circulation, 0);
  assert.throws(() => chargePlanState({ days: [8] }, current), /有效/);
});

test('The profile mask omits the middle digits and rejects invalid numbers', () => {
  assert.equal(maskPhone('+86 138 0000 1234'), '138****1234');
  assert.equal(maskPhone('1234'), '');
});
