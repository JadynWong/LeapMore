import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { correctedC01Viewer, needsC01Viewer } from '../src/data/cloud/c01Viewer.ts';
import { diagnosticText, diagnosticCsv, diagnosticFamily, diagnosticRuns, diagnosticYear, modelFinding, startModelTrace, viewerDiagnosticStep } from '../src/data/modelDiagnostics.ts';

test('both affected C01 builds load the variant table and forward queued callbacks before loading the node', () => {
  const hashes = [
    '9d5d7318bc1abdc6f148343d0978febc71cdf21aa099b83c9d3d31486964f5a6',
    'ea1ab3f8ac19f281973d8ec2ad44d9ce0fba6ec479a6bb10cbc894266dc0f48e',
  ];
  for (const hash of hashes) {
    assert.equal(needsC01Viewer('C01', hash), true);
    assert.equal(needsC01Viewer('C10', hash), false);
  }
  assert.equal(needsC01Viewer('C01', 'updated-build'), false);
  const fixture = `
    const events = [];
    class CarNode {
      addOnStarterCarLoadedCallback(callback) { this.starter = callback; }
      addOnFullCarLoadedCallback(callback) { this.full = callback; }
      load() { this.starter?.(); this.full?.(); }
    }
    class CarModelModules_CarModelModules { load() { events.push('csv'); } }
    const car = {
      __onStarterCarLoadedCallbacks__: [() => events.push('starter')],
      __pendingFullCarLoadedCallbacks__: [() => events.push('full')],
      run() { return this.__carNode__=new CarNode(this.cartype,this.caryear),this.__carNode__.load(),new CarModelModules('variant.csv').load(); }
    };
    car.run();
    [...events, car.__onStarterCarLoadedCallbacks__.length, car.__pendingFullCarLoadedCallbacks__.length];
  `;
  assert.throws(() => runInNewContext(fixture), /CarModelModules is not defined/);
  const patched = new TextDecoder().decode(correctedC01Viewer(new TextEncoder().encode(fixture)));
  assert.deepEqual(Array.from(runInNewContext(patched)), ['starter', 'full', 'csv', 0, 0]);
});

test('reports distinguish cloud, viewer and missing-callback failures and exclude account and vehicle identifiers', () => {
  const scope = 'private-account:private-vehicle-id';
  const log = startModelTrace(scope);
  log('manifest', { modelType: 2, hasH5Key: false });
  log('unavailable');
  log('failed');
  assert.match(modelFinding(diagnosticRuns(scope)[0]), /仅返回 2D/);
  const second = startModelTrace(scope);
  second('viewer'); second('first'); second('timeout');
  assert.match(modelFinding(diagnosticRuns(scope)[0]), /缺少完整模型回执/);
  assert.equal(viewerDiagnosticStep({ t: 'err', msg: 'https://private.example/vin' }), 'scriptError');
  assert.equal(diagnosticFamily('private-vehicle-id'), undefined);
  assert.equal(diagnosticYear('2026?token=private'), undefined);
  assert.equal(diagnosticFamily('C01'), 'C01');
  const csv = diagnosticCsv({ version: '0.1.0' }, diagnosticRuns(scope));
  assert.match(csv, /"load_2"/);
  assert.doesNotMatch(csv, /private/);
  const txt = diagnosticText({ version: '0.1.0' }, diagnosticRuns(scope));
  assert.match(txt, /^\uFEFFLeapMore 诊断报告\r\n/);
  assert.match(txt, /车模检测 2/);
  assert.match(txt, /收到素材清单/);
  assert.doesNotMatch(txt, /private/);
  assert.equal(diagnosticRuns('other-vehicle').length, 0);
  startModelTrace(scope); startModelTrace(scope);
  log('ready');
  assert.equal(diagnosticRuns(scope).length, 3);
  assert.ok(diagnosticRuns(scope).every(run => !run.events.some(event => event.step === 'ready')));
});

test('viewer context errors survive the timeout and a later ready observation wins', () => {
  const scope = 'test-gl';
  const log = startModelTrace(scope);
  log('viewer'); log('boot'); log('glCreate'); log('scriptError'); log('timeout');
  assert.match(modelFinding(diagnosticRuns(scope)[0]), /WebGL/);
  log('ready');
  assert.match(modelFinding(diagnosticRuns(scope)[0]), /完整车模已显示/);
  assert.equal(viewerDiagnosticStep({ t: 'runtime-error', kind: 'webgl-lost' }), 'glLost');
  assert.equal(diagnosticFamily('零跑 C11 2024款 纯电'), 'C11');
  assert.equal(diagnosticFamily('PRIVATEVINCC11ABCDE'), undefined);
});
