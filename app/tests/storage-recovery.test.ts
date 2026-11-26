import assert from 'node:assert/strict';
import test from 'node:test';
import { readDataset } from '../src/data/localDatabase.ts';
import { request, NetworkError } from '../src/platform/network.ts';

test('the next read reopens the record database after a temporary open failure', async () => {
  let opens = 0;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open() {
      opens++;
      const handle: { onerror?: () => void } = {};
      queueMicrotask(() => handle.onerror?.());
      return handle;
    },
  } });
  try {
    await assert.rejects(readDataset('trip'), /无法打开/);
    await assert.rejects(readDataset('charge'), /无法打开/);
    assert.equal(opens, 2);
  } finally {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});

test('a cancellable web request still times out, and explicit navigation cancellation still works', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  }));
  const navigation = new AbortController();
  const first = request('https://example.test', { signal: navigation.signal });
  t.mock.timers.tick(20_000);
  await assert.rejects(first, (error: unknown) => error instanceof NetworkError && error.status === 0);
  assert.equal(navigation.signal.aborted, false);
  const second = request('https://example.test', { signal: navigation.signal });
  navigation.abort();
  await assert.rejects(second, { name: 'AbortError' });
});
