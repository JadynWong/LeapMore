import test from 'node:test';
import assert from 'node:assert/strict';
import { failureFacts, ServiceFailure } from '../src/data/serviceFailure.ts';

test('only safe categories and structured response codes reach reports', () => {
  for (const [type, category] of [['UnknownHostException', 'dns'], ['SSLHandshakeException', 'tls'], ['SocketTimeoutException', 'timeout'], ['unrecognized', 'unknown']]) {
    assert.deepEqual(failureFacts(new Error(type + ' https://example.com/private-token')), { kind: category });
  }
  assert.deepEqual(failureFacts(new ServiceFailure('rate', 429, 1023)), { kind: 'rate', httpStatus: 429, businessCode: 1023 });
});

test('older WebViews keep successful requests and can still cancel or time out', async () => {
  const proto = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'throwIfAborted')!;
  const timeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!;
  Reflect.deleteProperty(AbortSignal.prototype, 'throwIfAborted');
  Reflect.deleteProperty(AbortSignal, 'timeout');
  try {
    const { abortCompatibility } = await import('../src/platform/abortCompatibility.ts');
    assert.deepEqual(abortCompatibility, { check: true, timeout: true });
    const ctrl = new AbortController();
    ctrl.signal.throwIfAborted();
    ctrl.abort(new Error('cancel'));
    assert.throws(() => ctrl.signal.throwIfAborted(), /cancel/);
    const signal = AbortSignal.timeout(1);
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    assert.throws(() => signal.throwIfAborted(), { name: 'TimeoutError' });
  } finally {
    Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', proto);
    Object.defineProperty(AbortSignal, 'timeout', timeout);
  }
});
