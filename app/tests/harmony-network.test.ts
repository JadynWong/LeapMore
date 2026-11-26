import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { failureFacts, loginFailureMessage } from '../src/data/serviceFailure.ts';

test('Harmony bridge keeps bodyless POST and JSON POST distinct, reports sanitized native failures', async () => {
  // Run the shipped plugin with an HTTP adapter that uses the OpenHarmony extraData contract.
  const source = readFileSync(new URL('../native/harmony/LeapNative.ets', import.meta.url), 'utf8');
  const plugin = { exports: {} as any };
  const requests: Record<string, unknown>[] = [];
  let code = 0, destroyed = 0;
  const http = { RequestMethod: { GET: 'GET', POST: 'POST' }, HttpDataType: { STRING: 'STRING' },
    createHttp: () => ({ destroy: () => destroyed++,
      request: async (_url: string, options: Record<string, unknown>) => {
        requests.push(options);
        if (code || options.extraData === '') throw { code: code || 401, message: 'private-url-with-credentials' };
        return { responseCode: 200, result: '{}' };
      } }),
  };
  class Plugin { registerMethod() {} }
  const modules: Record<string, object> = { 'harmony-capacitor': { CapacitorPlugin: Plugin }, '@kit.NetworkKit': { http },
    '@kit.ArkTS': { util: { TextEncoder, TextDecoder: { create: () => new TextDecoder() } } } };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: plugin.exports, require: (name: string) => modules[name] ?? {} });
  const net = new plugin.exports.LeapNet();
  async function send(method: string, body?: string) {
    let result, failure;
    const params: Record<string, string | undefined> = { url: 'https://example.invalid/test', method, body };
    await net.request({ getString: (key: string) => params[key] ?? '',
      getObject: () => ({}), getNumber: () => 8000, getBoolean: () => false,
      resolve: (reply: unknown) => { result = reply; }, rejectMessage: (code: string, message: string) => { failure = { code, message }; } });
    if (failure) throw failure;
    return result;
  }
  await send('GET');
  await send('POST');
  await send('POST', '{"mode":"test"}');
  assert.deepEqual(requests.map(r => [r.method, Object.hasOwn(r, 'extraData'), r.extraData]),
    [['GET', false, undefined], ['POST', false, undefined], ['POST', true, '{"mode":"test"}']]);
  assert.equal(requests[0].readTimeout, 8000);
  for (const [nativeCode, kind] of [[401, 'request'], [201, 'permission'], [2300006, 'dns'], [2300028, 'timeout'], [2300060, 'tls'], [2300999, 'transport']] as const) {
    code = nativeCode;
    await assert.rejects(send('POST'), (error: unknown) => {
      assert.deepEqual(failureFacts(error), { kind, nativeCode });
      assert.doesNotMatch(JSON.stringify(error), /private-url/);
      assert.match(loginFailureMessage('vehicle-auth', failureFacts(error)), /获取车辆服务授权失败/);
      return true;
    });
  }
  assert.equal(destroyed, requests.length);
});
