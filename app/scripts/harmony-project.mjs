import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const entry = 'openharmony/entry/src/main';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const overlay = 'native/harmony';
const ets = entry + '/ets';
for (const [file, folder] of [['LeapNative.ets', 'plugins'], ['WidgetCard.ets', 'widget'], ['WidgetAbility.ets', 'widget']]) {
  mkdirSync(ets + '/' + folder, { recursive: true });
  copyFileSync(overlay + '/' + file, ets + '/' + folder + '/' + file);
}
function edit(file, edit) { writeFileSync(file, edit(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))); }

edit(ets + '/pages/Index.ets', source => {
  if (source.includes('import { LeapAuth')) return source;
  return source.replace('import { MainPage', "import { common } from '@kit.AbilityKit';\nimport { LeapAuth, LeapNet, LeapVault, LeapWidget } from '../plugins/LeapNative';\nimport { MainPage")
    .replace('cordovaPlugs:Array< PluginEntry> = [];', `capacitorPlugins: Array<PluginEntry> = [];
  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.capacitorPlugins = [
      { pluginName: 'LeapAuth', pluginObject: new LeapAuth(context) },
      { pluginName: 'LeapNet', pluginObject: new LeapNet() },
      { pluginName: 'LeapVault', pluginObject: new LeapVault() },
      { pluginName: 'LeapWidget', pluginObject: new LeapWidget(context) }
    ];
  }`)
    .replace('cordovaPlugs:this.cordovaPlugs', 'capacitorPlugins:this.capacitorPlugins');
});
edit(ets + '/pages/Index.ets', source => source.includes('new LeapSettings(') ? source : source
  .replace('LeapAuth, LeapNet, LeapVault, LeapWidget', 'LeapAuth, LeapNet, LeapSettings, LeapVault, LeapWidget')
  .replace("{ pluginName: 'LeapNet', pluginObject: new LeapNet() },", "{ pluginName: 'LeapNet', pluginObject: new LeapNet() },\n      { pluginName: 'LeapSettings', pluginObject: new LeapSettings(context) },"));
edit(ets + '/entryability/EntryAbility.ets', source => {
  if (source.includes('acceptWidgetAction')) return source;
  return source.replace("const DOMAIN", "import { acceptWidgetAction } from '../plugins/LeapNative';\n\nconst DOMAIN")
    .replace('    webview.WebviewController.initializeWebEngine();', '    this.widget(want);\n    webview.WebviewController.initializeWebEngine();')
    .replace('  onDestroy(): void', `  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.widget(want);
  }

  private widget(want: Want): void {
    const action = want.parameters?.['leapWidgetAction'];
    if (typeof action === 'string') acceptWidgetAction(action);
  }

  onDestroy(): void`);
});
edit(entry + '/module.json5', source => {
  if (source.includes('WidgetAbility')) return source;
  return source.replace('"extensionAbilities": [', `"extensionAbilities": [
      {
        "name": "WidgetAbility",
        "srcEntry": "./ets/widget/WidgetAbility.ets",
        "type": "form",
        "exported": true,
        "metadata": [{ "name": "ohos.extension.form", "resource": "$profile:leap_widget" }]
      },`)
    .replace('"exported": true,\n        "skills"', '"exported": true,\n        "launchType": "singleton",\n        "skills"');
});
writeFileSync(entry + '/resources/base/profile/leap_widget.json', JSON.stringify({
  forms: [{
    name: 'LeapMoreVehicle', displayName: 'LeapMore 车辆', description: '查看车辆续航、充电与车况',
    src: './ets/widget/WidgetCard.ets', uiSyntax: 'arkts', isDynamic: true, isDefault: true,
    updateEnabled: true, updateDuration: 1, defaultDimension: '2*4', supportDimensions: ['2*2', '2*4', '4*4'],
  }],
}, null, 2));

edit(entry + '/resources/rawfile/www/index.html', html => html.includes('CapacitorCustomPlatform') ? html :
  html.replace('<head>', '<head>\n<script>window.CapacitorCustomPlatform = { name: "openharmony" };</script>'));
edit(entry + '/module.json5', source => source.includes('ohos.permission.INTERNET') ? source :
  source.replace('"module": {', '"module": {\n    "requestPermissions": [{ "name": "ohos.permission.INTERNET" }],'));
edit(entry + '/module.json5', source => source.replace(
  /,\s*\{ "name": "ohos\.permission\.(?:APPROXIMATELY_)?LOCATION", "reason": "\$string:EntryAbility_location",\s*"usedScene": \{[^}]*\} \}/g, ''));
edit(entry + '/resources/base/element/string.json', source => {
  const values = JSON.parse(source);
  values.string = values.string.filter(item => item.name !== 'EntryAbility_location');
  return JSON.stringify(values, null, 2) + '\n';
});
edit(entry + '/module.json5', source => source.includes('ohos.permission.ACCESS_BIOMETRIC') ? source :
  source.replace(/"requestPermissions"\s*:\s*\[/, '$&\n      { "name": "ohos.permission.ACCESS_BIOMETRIC" },'));

// hionic's npm installer does not support this pnpm workspace layout. Use the
// pinned plugin sources and the registration points from their plugin.xml files.
const capacitor = 'openharmony/capacitor';
const plugins = [
  { name: 'filesystem', classpath: 'Filesystem', action: 'FilesystemAction' },
];
edit(capacitor + '/src/main/cpp/CMakeLists.txt', source => source.replace(
  /^[ \t]*(?:add_subdirectory\(Geolocation\)|Geolocation)[ \t]*\n/gm, ''));
edit(capacitor + '/build-profile.json5', source => source.replace(
  /^[ \t]*"\.\/src\/main\/ets\/components\/Geolocation\/Geolocation\.ets",\n/gm, ''));
for (const { name, classpath, action } of plugins) {
  const plugin = `node_modules/@capacitor-ohos/${name}`;
  for (const part of ['cpp', 'ets/components']) {
    const path = `src/main/${part}/${classpath}`;
    cpSync(`${plugin}/${path}`, `${capacitor}/${path}`, { recursive: true });
  }
  edit(capacitor + '/src/main/cpp/CMakeLists.txt', source => source.includes(`add_subdirectory(${classpath})`) ? source :
    source.replace('#END_ADD_SUBDIRECTORY', `add_subdirectory(${classpath})\n#END_ADD_SUBDIRECTORY`)
      .replace('    "-Wl,--no-whole-archive"', `    ${classpath}\n    "-Wl,--no-whole-archive"`));
  const runtimePath = `./src/main/ets/components/${classpath}/${action}.ets`;
  edit(capacitor + '/build-profile.json5', source => source.includes(runtimePath) ? source :
    source.replace('"./src/main/ets/components/Permission/PermissionAction.ets"',
      `"${runtimePath}",\n          "./src/main/ets/components/Permission/PermissionAction.ets"`));
}
edit(entry + '/resources/rawfile/capacitor.plugins.json', source => {
  const values = JSON.parse(source).filter(item => item.classpath !== 'Geolocation');
  for (const { name, classpath } of plugins) {
    if (!values.some(item => item.classpath === classpath)) values.push({ pkg: `@capacitor/${name}`, classpath });
  }
  return JSON.stringify(values, null, 2) + '\n';
});

const ssl = process.env.LEAPMORE_OHOS_OPENSSL_DIR;
if (ssl) {
  cpSync(ssl + '/libs', 'openharmony/capacitor/libs', { recursive: true });
  cpSync(ssl + '/openssl', 'openharmony/capacitor/src/main/cpp/openssl', { recursive: true });
}
edit('openharmony/build-profile.json5', source => source.replace('"5.0.0(12)"', '"6.0.0(20)"')
  .replace('"5.0.5(17)"', '"6.0.0(20)"'));

for (const folder of ['openharmony/AppScope/resources/base/media', entry + '/resources/base/media']) {
  if (!existsSync(folder)) continue;
  copyFileSync('public/assets/leaplink-icon-simple.png', folder + '/leapmore.png');
}
copyFileSync('public/assets/leaplink-icon.png', 'openharmony/AppScope/resources/base/media/leapmore_original.png');
edit('openharmony/AppScope/app.json5', source => source.replace(/"versionName"\s*:\s*"[^"]+"/, `"versionName": "${version}"`)
  .replace('"vendor": "example"', '"vendor": "LeapMore"')
  .replace('"$media:layered_image"', '"$media:leapmore"'));
edit('openharmony/AppScope/app.json5', source => source.includes('"alternateIcons"') ? source :
  source.replace('"app": {', '$&\n    "alternateIcons": [{ "name": "original", "icon": "$media:leapmore_original" }],'));
edit(entry + '/module.json5', source => source.replace('"$media:layered_image"', '"$media:leapmore"')
  .replace('"$media:startIcon"', '"$media:leapmore"'));
