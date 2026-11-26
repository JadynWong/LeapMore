import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

// Only native system controls load this local bundle. The platform supplies its transport.
export function buildQuickWorker(write = true, platform = 'android') {
  return build({
    configFile: false, publicDir: false, logLevel: write ? 'info' : 'silent',
    resolve: { alias: [{ find: './liveHttp', replacement: resolve('native/quick/http.ts') }] },
    build: { target: 'es2019', outDir: 'dist/native', emptyOutDir: false, write,
      lib: { entry: resolve(platform === 'ios' ? 'native/quick/ios.ts' : 'native/quick/worker.ts'), name: 'LeapDirect', formats: ['iife'], fileName: () => 'quick.js' } },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildQuickWorker(true, process.argv[2]);
