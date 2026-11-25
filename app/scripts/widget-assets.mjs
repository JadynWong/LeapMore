import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { widgetVectorSvg } from './widget-vector.mjs';

// Export the preview's theme and the Android line artwork as native resources.
const vectors = 'native/android/res/drawable';
const platform = process.argv[2];
if (!['android', 'ios', 'harmony'].includes(platform)) throw Error('未知桌面卡片平台');
const ios = platform === 'ios';
const destination = ios ? 'ios/App/LeapWidget/WidgetAssets.xcassets' : 'openharmony/entry/src/main/resources/base/media';
const info = { author: 'xcode', version: 1 };
const themes = JSON.parse(readFileSync('src/data/widgetPalette.json', 'utf8'));
const colors = Object.entries(themes).flatMap(([theme, roles]) => Object.entries(roles).map(([role, value]) =>
  ({ name: 'widget_' + role + '_' + theme, value })));
if (platform === 'android') {
  const values = 'android/app/src/main/res/values';
  mkdirSync(values, { recursive: true });
  writeFileSync(join(values, 'leap_widget_colors.xml'), '<resources>\n' +
    colors.map(({ name, value }) => `  <color name="${name}">${value}</color>`).join('\n') + '\n</resources>\n');
  process.exit(0);
}
mkdirSync(destination, { recursive: true });
if (ios) {
  writeFileSync(join(destination, 'Contents.json'), JSON.stringify({ info }));
  for (const { name, value } of colors) {
    const folder = join(destination, name + '.colorset');
    const components = { red: '0x' + value.slice(1, 3), green: '0x' + value.slice(3, 5), blue: '0x' + value.slice(5), alpha: '1.000' };
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'Contents.json'), JSON.stringify({ info, colors: [
      { idiom: 'universal', color: { 'color-space': 'srgb', components } },
    ] }));
  }
} else {
  writeFileSync('openharmony/entry/src/main/resources/base/element/widget_colors.json', JSON.stringify({ color: colors }));
}

function iosImage(name, extension) {
  const folder = join(destination, name + '.imageset');
  mkdirSync(folder, { recursive: true });
  const filename = name + extension;
  writeFileSync(join(folder, 'Contents.json'), JSON.stringify({
    images: [{ idiom: 'universal', filename }], info,
    ...(extension === '.svg' && { properties: { 'preserves-vector-representation': true } }),
  }));
  return join(folder, filename);
}

for (const file of readdirSync(vectors).filter(name => name.startsWith('leap_widget_icon_'))) {
  const name = file.slice('leap_'.length, -4);
  const xml = readFileSync(join(vectors, file), 'utf8');
  writeFileSync(ios ? iosImage(name, '.svg') : join(destination, name + '.svg'), widgetVectorSvg(xml));
}

if (ios) cpSync('public/assets/leaplink-icon-simple.png', iosImage('widget_logo', '.png'));
