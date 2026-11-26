import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Harmony bridge strips payload logs without changing bridge data flow', () => {
  const script = readFileSync('scripts/harmony-project.mjs', 'utf8');
  const definition = script.match(/function stripHarmonyPayloadLogs\(source, kind\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(definition);
  const strip = Function(`${definition}; return stripHarmonyPayloadLogs`)() as (source: string, kind: string) => string;
  const cpp = 'for (int i = 0; i < 1; i++) OH_LOG_Print(LOG_APP, "%{public}s", secret.c_str());\nsend(secret);';
  const cleaned = strip(cpp, 'cpp');
  assert.doesNotMatch(cleaned, /OH_LOG_Print|secret\.c_str/);
  assert.match(cleaned, /\(void\)0;.*\nsend\(secret\)/);
  assert.equal(strip(cleaned, 'cpp'), cleaned);
  const ets = '  console.info(`args ${pageIndex.pageArgs}`);\n  process(pageIndex.pageArgs);';
  assert.doesNotMatch(strip(ets, 'ets'), /console\.info/);
  assert.match(strip(ets, 'ets'), /process\(pageIndex\.pageArgs\)/);
  const bridge = "if (cap.isLoggingEnabled && pluginName !== 'Console') { cap.logToNative(callData); }\nif (cap.isLoggingEnabled && result.pluginId !== 'Console') { cap.logFromNative(result); }";
  assert.doesNotMatch(strip(bridge, 'bridge'), /if \(cap\.isLoggingEnabled/);
});
