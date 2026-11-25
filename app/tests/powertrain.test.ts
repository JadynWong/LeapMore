import assert from 'node:assert/strict';
import test from 'node:test';
import { displayedRange, namedPowertrain, powertrainRanges, resolvePowertrain } from '../src/data/powertrain.ts';

test('C11 BEV can report an 80% tank, millilitres and a combined range identical to EV range', () => {
  for (const level of [0, 80]) {
    const ranges = powertrainRanges({ 3235: level, 3263: 40000, 3259: 0, 3260: 312, 3261: 312 });
    assert.equal(ranges.evidence, null);
    assert.equal(resolvePowertrain('auto', namedPowertrain('C11'), ranges.evidence, false).type, 'bev');
  }
});

test('REEV evidence follows the selected range cycle and only compares within that cycle', () => {
  const signals = { 3256: '400', 3257: 200, 3258: 600, 3259: 0, 3260: 170, 3261: 170 };
  assert.equal(powertrainRanges({ ...signals, 3262: '0' }).evidence, 'fuel-range');
  assert.equal(powertrainRanges(signals).evidence, null);
  assert.equal(powertrainRanges({ 3258: 360, 3260: 310 }).evidence, null);
  assert.equal(powertrainRanges({ 3258: 360 }).evidence, null);
  assert.equal(powertrainRanges({ 3261: 360, 3260: -1 }).evidence, null);
  assert.equal(powertrainRanges({ 3257: '110', 3258: '360' }).evidence, 'combined-range');
  assert.equal(powertrainRanges({ 3256: 'unknown', 3259: '80', 3262: 0 }).evidence, 'fuel-range');
});

test('BEV range prefers the dashboard, then electric range, then total, including a single reported cycle and zero', () => {
  const read = (raw: Record<string, unknown>) => displayedRange('bev', powertrainRanges(raw));
  assert.deepEqual(read({ 2188: 0, 3257: 180 }), { km: 0, source: 'live' });
  assert.deepEqual(read({ 2188: -1, 3257: 180, 3258: 185 }), { km: 180, source: 'ev' });
  assert.deepEqual(read({ 3235: 80, 3261: 383 }), { km: 383, source: 'total' });
  assert.deepEqual(read({ 3262: '0', 3258: 350, 3261: 312 }), { km: 350, source: 'total' });
  assert.deepEqual(read({ 3235: 80 }), { km: null, source: 'missing' });
});

test('REEV uses reported total once, or same-cycle components, with a readable partial range', () => {
  const read = (raw: Record<string, unknown>) => displayedRange('reev', powertrainRanges(raw));
  assert.deepEqual(read({ 2188: 630, 3256: 450, 3257: 180, 3258: 630 }), { km: 630, source: 'total' });
  assert.deepEqual(read({ 3256: 450, 3257: 180 }), { km: 630, source: 'combined' });
  assert.deepEqual(read({ 3256: 450, 3260: 180 }), { km: 180, source: 'ev' });
  assert.deepEqual(read({ 3256: 450, 2188: 180 }), { km: 630, source: 'combined' });
  assert.deepEqual(read({ 3258: 0 }), { km: 0, source: 'total' });
});

test('remembered REEV survives missing or empty signals, named variants and manual overrides take precedence', () => {
  assert.equal(resolvePowertrain('auto', undefined, null, true).reason, 'remembered');
  assert.equal(resolvePowertrain('auto', namedPowertrain('C11 EREV'), null, false).type, 'reev');
  assert.equal(resolvePowertrain('auto', namedPowertrain('C11 纯电'), 'fuel-range', true).type, 'bev');
  assert.deepEqual(resolvePowertrain('bev', 'reev', 'fuel-range', true), { type: 'bev', reason: 'manual' });
  assert.deepEqual(resolvePowertrain('reev', 'bev', null, false), { type: 'reev', reason: 'manual' });
});
