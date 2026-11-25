import { copyFileSync, existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
const app = resolve(import.meta.dirname, '..');
const root = resolve(app, '..');
const localDemo = process.argv.includes('--demo');
mkdirSync(resolve(app, 'public/assets'), { recursive: true });
copyFileSync(resolve(root, 'docs/wechat-reward.png'), resolve(app, 'public/assets/wechat-reward-qr.png'));
for (const name of ['leaplink-icon.png', 'leaplink-icon-simple.png', 'leaplink-lockup.png']) {
  const source = resolve(root, 'icons/brand', name);
  if (existsSync(source)) copyFileSync(source, resolve(app, 'public/assets', name));
}
if (localDemo) {
  for (const name of ['hero-day.png', 'hero-night.png', 'b10.png', 'c10.png']) {
    const source = resolve(root, 'prototype/assets', name);
    if (existsSync(source)) copyFileSync(source, resolve(app, 'public/assets', name));
  }
  const studio = resolve(app, 'public/car3d-demo');
  const model = resolve(root, 'prototype/car3d');
  if (existsSync(model)) {
    if (existsSync(studio) && lstatSync(studio).isSymbolicLink()) unlinkSync(studio);
    mkdirSync(studio, { recursive: true });
    for (const name of ['C10_2026', 'models', 'textures', 'FBX.worker.js', 'index.js', 'fallback.png']) {
      if (!existsSync(resolve(studio, name))) symlinkSync('../../../prototype/car3d/' + name, resolve(studio, name));
    }
    for (const name of ['view.html', 'view.js']) copyFileSync(resolve(app, 'public/viewer', name), resolve(studio, name));
  }
}
