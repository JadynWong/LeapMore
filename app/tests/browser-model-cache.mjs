// Optional compatibility check using the locally available viewer from the demo assets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { browser } from './cdp.mjs';

const base = process.env.LEAPMORE_DEMO_ORIGIN ?? 'http://127.0.0.1:5175/';
const h5 = readFileSync(new URL('../public/car3d-demo/index.js', import.meta.url));
const pack = entries => Buffer.from(zipSync(entries)).toString('base64');
const tab = await browser(new URL('/@vite/client', base).href);
try {
  await tab.send('Page.bringToFront');
  const run = await tab.run(`(async () => {
    const { prepareCloud3D, dropCloud3D, sendViewerAssets } = await import('/src/data/cloud/cloud3d.ts');
    const id = 'test-model-cache-' + crypto.randomUUID();
    const unpack = text => Uint8Array.from(atob(text), char => char.charCodeAt(0)).buffer;
    const client = { get3DPackages: async () => ({ h5: unpack(${JSON.stringify(pack({ 'index.js': h5 }))}),
      src: unpack(${JSON.stringify(pack({ 'C01_2024/C01_2024_full_car.fbx': new Uint8Array([1]) }))}),
      modelParam: { carType: 'C01', year: 2024 } }) };
    try {
      const fresh = await prepareCloud3D(client, id);
      const cache = await caches.open('cloud3d-v6-' + fresh.webId);
      const url = name => new URL(name, fresh.url).href;
      const original = await (await cache.match(url('index.js'))).text();
      const patched = await (await cache.match(url('index.c01-v1.js'))).text();
      const manifest = await (await cache.match(url('manifest.json'))).json();
      delete manifest.viewerSha256;
      await cache.put(url('manifest.json'), new Response(JSON.stringify(manifest)));
      await cache.delete(url('index.c01-v1.js'));
      const events = [];
      const cached = await prepareCloud3D({ get3DPackages: () => { throw Error('Unexpected download'); } }, id,
        undefined, undefined, (step, facts) => events.push({ step, facts }));
      const checked = [];
      await prepareCloud3D({ get3DManifest: async () => { throw Error('UnknownHostException'); },
        get3DPackages: () => { throw Error('Unexpected download'); } }, id,
        undefined, undefined, (step, facts) => checked.push({ step, facts }), true);
      if (!checked.some(event => event.step === 'manifestCheckError' && event.facts.kind === 'dns')) throw Error('Missing live manifest failure');
      let entries;
      await sendViewerAssets({postMessage: message => { entries = message.files.map(([path]) => path.split('/').pop()); }},
        fresh.webId, cached.params);
      const repairedCache = await (await cache.match(url('index.c01-v1.js'))).text() === patched;
      // Exercise the shipped wrapper with the fast-worker ordering, independently of the FBX fixture.
      await cache.put(url('index.c01-v1.js'), new Response(
        'window.newInit = () => { window.onFullCarLoaded(); setTimeout(window.onFirstFrame, 300); };',
        { headers: { 'Content-Type': 'text/javascript' } }));
      const frame = document.createElement('iframe');
      frame.sandbox = 'allow-scripts';
      frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
      const signals = [];
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Viewer did not become ready: ' + signals.join(','))), 5000);
        function observe(event) {
          if (event.source !== frame.contentWindow || event.origin !== 'null') return;
          if (event.data?.t === 'runtime-error' || event.data?.t === 'err') reject(Error('Wrapper failed: ' + JSON.stringify(event.data)));
          if (['viewer-boot', 'first', 'full', 'ready'].includes(event.data?.t)) signals.push(event.data.t);
          if (event.data?.t === 'ready') {
            clearTimeout(timer);
            window.removeEventListener('message', observe);
            resolve();
          }
        }
        window.addEventListener('message', observe);
        frame.onload = () => sendViewerAssets(frame.contentWindow, cached.webId, cached.params).catch(reject);
      });
      frame.srcdoc = cached.document;
      document.body.append(frame);
      try { await ready; } finally { frame.remove(); }
      return { freshPatched: new URL(fresh.url).searchParams.get('c01Compat'), cachedPatched: new URL(cached.url).searchParams.get('c01Compat'),
        originalPreserved: original.includes('new CarModelModules('), corrected: !patched.includes('new CarModelModules('),
        repairedCache, entries, events, signals };
    } finally { await dropCloud3D(id); }
  })()`);
  assert.equal(run.freshPatched, '1');
  assert.equal(run.cachedPatched, '1');
  assert.ok(run.originalPreserved && run.corrected && run.repairedCache);
  assert.ok(run.entries.includes('index.c01-v1.js') && !run.entries.includes('index.js'));
  assert.ok(run.events.some(event => event.step === 'hit'));
  assert.equal(run.events.find(event => event.step === 'viewerBuild').facts.c01Compat, true);
  assert.deepEqual(run.signals, ['viewer-boot', 'full', 'first', 'ready']);
  console.log('C01 fresh install and offline upgrade of a legacy cache both select the corrected viewer.');
} finally { await tab.close(); }
