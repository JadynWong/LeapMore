import { test } from 'node:test';
import assert from 'node:assert/strict';
import { favoriteScope } from '../src/data/favoriteScope.ts';
import { historyKey, ledgerKey, archivePointer, archiveKey } from '../src/data/ha/cacheKeys.ts';

test('private vehicle preferences are separated by account and HA authorization', () => {
  const cloudA = favoriteScope('cloud', 'account-a:car', undefined, '', 'car');
  const cloudB = favoriteScope('cloud', 'account-b:car', undefined, '', 'car');
  const haA = favoriteScope('ha', '', 'authorization-a', 'vin', 'ha-local');
  const haB = favoriteScope('ha', '', 'authorization-b', 'vin', 'ha-local');
  assert.ok(cloudA && cloudB && haA && haB);
  assert.equal(new Set([cloudA, cloudB, haA, haB]).size, 4);
  assert.equal(favoriteScope('ha', '', undefined, 'vin', 'ha-local'), '');
  assert.equal(favoriteScope('ha', '', 'authorization-a', '', 'ha-local'), '');
  assert.equal(favoriteScope('cloud', '', undefined, '', 'car'), '');
  assert.doesNotMatch(cloudA, /account-a|car/);
});

test('HA caches use the authorization scope and do not claim old unscoped data', () => {
  const a = { url: 'https://ha.example', days: 30, auto: true, auth: 'manual' as const, mappings: {}, localScope: 'a' };
  const b = { ...a, localScope: 'b' };
  for (const key of [(c: typeof a) => historyKey(c, 'vehicle', 'vin'), (c: typeof a) => ledgerKey(c, 'vin'), (c: typeof a) => archivePointer(c, 'vehicle'), (c: typeof a) => archiveKey(c, 'source', 'dataset', 'vehicle')]) {
    assert.notEqual(key(a), key(b));
    assert.notEqual(key(a), key({ ...a, localScope: '' }));
  }
});
