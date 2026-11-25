import assert from 'node:assert/strict';
import { test } from 'node:test';
import { periodStart } from '../src/data/recordPeriod.ts';

test('自然周从周一开始，跨年周与本年分别取各自的起点', () => {
  const sunday = +new Date(2023, 0, 1, 18, 30);
  assert.equal(periodStart('week', sunday), +new Date(2022, 11, 26));
  assert.equal(periodStart('month', sunday), +new Date(2023, 0, 1));
  assert.equal(periodStart('year', sunday), +new Date(2023, 0, 1));
  assert.equal(periodStart('week', +new Date(2023, 0, 2)), +new Date(2023, 0, 2));
  assert.equal(periodStart('month', +new Date(2024, 1, 29, 23)), +new Date(2024, 1, 1));
  assert.equal(periodStart('all', sunday), 0);
});
