import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinkAccess } from '../src/platform/linkAccess.ts';

test('page probes retry unsupported HEAD with a partial GET and never fetch a package body', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    methods.push(options.method!);
    if (options.method === 'HEAD') return new Response(null, { status: 405 });
    assert.equal(new Headers(options.headers).get('range'), 'bytes=0-1023');
    return new Response(null, { status: 206 });
  });
  assert.match(await checkLinkAccess('https://example.com/'), /可访问 · HTTP 206/);
  assert.match(await checkLinkAccess('https://example.com/file.apk', true), /不支持预检/);
  assert.deepEqual(methods, ['HEAD', 'GET', 'HEAD']);
});

test('an opaque browser response and a network or HTTP error have distinct explanations', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    if (options.mode === 'no-cors') return { type: 'opaque', status: 0, body: null };
    throw TypeError('Failed to fetch');
  });
  assert.match(await checkLinkAccess('https://example.com/'), /未提供状态码/);
  fetcher.mock.mockImplementation(async () => { throw TypeError('Failed to fetch'); });
  assert.match(await checkLinkAccess('https://example.com/'), /无法连接/);
  for (const [status, pattern] of [[403, /访问受限/], [404, /链接不存在/], [503, /访问异常/]] as const) {
    fetcher.mock.mockImplementation(async () => new Response(null, { status }));
    assert.match(await checkLinkAccess('https://example.com/'), pattern);
  }
});
