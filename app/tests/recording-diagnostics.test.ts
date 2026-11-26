import test from 'node:test';
import assert from 'node:assert/strict';
import { noteRecording, recordingHours } from '../src/data/recordingDiagnostics.ts';
import { readFailure, rememberFailure } from '../src/data/readDiagnostics.ts';

test('recording evidence survives re-reads, stays scoped, rotates after 48 hours, and never exposes the request', () => {
  const store = new Map<string, string>();
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, val: string) => store.set(key, val),
  } });
  try {
    const scope = 'private-account:private-car', hour = 3600000, now = hour * 500000;
    noteRecording(scope, ['backgroundPoll'], { now });
    noteRecording(scope, ['readFailed'], { now: now + 1, error: new Error('Timeout private-query') });
    noteRecording(scope, ['reply', 'charging', 'repeat', 'invalidTime'], { now: now + hour, reportedAt: now });
    let rows = recordingHours(scope, now + hour);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].lastFailure, { kind: 'timeout' });
    assert.equal(rows[0].last.readFailed, now + 1);
    assert.equal(rows[1].counts.committed, undefined);
    assert.equal(rows[1].lastReportAt, now);
    assert.deepEqual(recordingHours('another-car', now), []);
    noteRecording(scope, ['committed', 'chargingCommitted'], { now: now + hour * 48 });
    rows = recordingHours(scope, now + hour * 48);
    assert.equal(rows.length, 2);
    assert.equal(rows.at(-1)?.counts.chargingCommitted, 1);
    assert.equal(rows[0].counts.backgroundPoll, undefined);
    rememberFailure('local', 'login', { code: 'HARMONY_HTTP_2300006', message: 'private-query' }, 'sms-verify');
    assert.deepEqual(readFailure('local', 'login'), { at: readFailure('local', 'login')!.at, stage: 'sms-verify', kind: 'dns', nativeCode: 2300006 });
    assert.doesNotMatch(JSON.stringify([...store]), /private-query|private-account|private-car/);
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
