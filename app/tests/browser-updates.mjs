import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browser, wait } from './cdp.mjs';

const base = process.env.LEAPMORE_DEMO_ORIGIN ?? 'http://127.0.0.1:5175/';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tab = await browser('about:blank', 320, 700);
const notice = 'dialog[open] h2';
const title = () => tab.run(`document.querySelector(${JSON.stringify(notice)})?.textContent ?? ''`);
async function until(check) {
  for (let i = 0; i < 80; i++) { if (await check()) return; await wait(75); }
  throw Error('Unexpected screen: ' + await tab.run('document.body.innerText'));
}
async function click(label) {
  await tab.run(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
}
async function reopen() {
  await tab.run(`window.testVisibility('hidden'); window.testVisibility('visible'); window.testVisibility('visible');`);
  await wait(150);
}
try {
  await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { get: () => visibility });
    window.testVisibility = state => { visibility = state; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); };
    const original = window.fetch.bind(window);
    window.queries = { github: 0, gitcode: 0 };
    window.fetch = async (url, options) => {
      const host = new URL(url, location.href).hostname;
      if (['github.com', 'gitcode.com', 'pan.quark.cn', 'leapmore.mirato66.cloud'].includes(host)) {
        if (sessionStorage.getItem('fixtureOffline')) throw new TypeError('Failed to fetch');
        if (String(url).includes('/download/') && options.method !== 'HEAD') throw Error('Unexpected package download');
        if (host === 'github.com' && !String(url).includes('/download/') && options.method === 'HEAD') return new Response(null, {status: 405});
        const status = host === 'gitcode.com' ? 503 : host === 'pan.quark.cn' ? 404 : 200;
        return new Response(null, {status});
      }
      if (!['api.github.com', 'api.gitcode.com'].includes(host)) return original(url, options);
      const github = host === 'api.github.com';
      window.queries[github ? 'github' : 'gitcode']++;
      if (sessionStorage.getItem('fixtureOffline')) throw new TypeError('Failed to fetch');
      const tag = github ? sessionStorage.getItem('fixtureTag') || 'v99.1.0' : 'v0.1.1';
      const repo = 'https://github.com/MiRaToo/LeapMore/releases';
      return Response.json([{ tag_name: tag, ...(github ? { html_url: repo + '/tag/' + tag } : {}),
        assets: [{ name: 'test.apk', ...(github ? { browser_download_url: repo + '/download/' + tag + '/test.apk' } : {}) }] }]);
    };
  ` });
  await tab.send('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'local_storage' });
  await tab.navigate(base + '#/welcome');
  await until(async () => await title() === '欢迎使用 LeapMore');
  assert.deepEqual(await tab.run('queries'), { github: 1, gitcode: 1 });
  await click('我知道了');
  await until(async () => await title() === '发现新版本 v99.1.0');
  assert.deepEqual(await tab.run('[...document.querySelectorAll("dialog[open] a")].map(a => a.href)'), [
    'https://github.com/MiRaToo/LeapMore/releases/download/v99.1.0/test.apk',
    'https://github.com/MiRaToo/LeapMore/releases/tag/v99.1.0', 'https://gitcode.com/MiraRato/LeapMore/releases',
    'https://pan.quark.cn/s/9e6168a73f21',
  ]);
  assert.match(await tab.run('document.querySelector("dialog[open]").innerText'), /镜像中查到的最新版本为 v0\.1\.1/);
  await click('稍后提醒');
  await tab.run('location.hash="/subaccount"');
  await wait(125);
  assert.deepEqual(await tab.run('queries'), { github: 1, gitcode: 1 });
  await reopen();
  await until(async () => await title() === '发现新版本 v99.1.0');
  assert.deepEqual(await tab.run('queries'), { github: 2, gitcode: 2 });
  await click('此版本不再提示');
  await tab.run(`localStorage.setItem('leapmore.mode','"demo"'); localStorage.setItem('leapmore.activeVehicle','"demo-c10"');`);
  await tab.navigate(base + '?test-updates#/mine');
  await until(async () => (await tab.run('document.body.innerText')).includes('关于 LeapMore'));
  assert.equal(await title(), '');
  await click('关于 LeapMore');
  await click('检查更新');
  await until(async () => (await tab.run('document.querySelector("dialog[open]").innerText')).includes('发现新版本 v99.1.0'));
  await until(async () => (await tab.run('document.querySelector("dialog a[href*=gitcode].update-destination").innerText')).includes('HTTP 503'));
  assert.match(await tab.run('document.querySelector("dialog a[href*=quark]").innerText'), /链接不存在 · HTTP 404/);
  assert.match(await tab.run('document.querySelector("dialog a[href*=mirato66]").innerText'), /可访问 · HTTP 200/);
  assert.match(await tab.run('document.querySelector("dialog a[href*=github].update-destination.secondary").innerText'), /可访问 · HTTP 200/);
  await tab.click('dialog[open] [aria-label="关闭"]');
  await tab.run('sessionStorage.setItem("fixtureTag", "v99.2.0")');
  await reopen();
  await until(async () => await title() === '发现新版本 v99.2.0');
  await click('稍后提醒');
  await click('关于 LeapMore');
  await tab.click('dialog[open] [role=switch]');
  await tab.click('dialog[open] [aria-label="关闭"]');
  await tab.reload();
  await until(async () => (await tab.run('queries.github')) === 1);
  assert.equal(await title(), '');
  await click('关于 LeapMore');
  assert.equal(await tab.run('document.querySelector("dialog[open] [role=switch]").getAttribute("aria-checked")'), 'false');
  assert.equal(await tab.run('document.querySelector("dialog[open] a[href*=mirato66]").href'), 'https://leapmore.mirato66.cloud/');
  await tab.run('sessionStorage.setItem("fixtureOffline", "1")');
  await click('检查更新');
  await until(async () => (await tab.run('document.body.innerText')).includes('暂时无法查询发布版本'));
  await until(async () => (await tab.run('document.querySelector("dialog a.update-destination.accent").innerText')).includes('无法连接'));
  assert.equal(await tab.run('document.querySelector("dialog a.update-destination.accent").href'),
    `https://github.com/MiRaToo/LeapMore/releases/download/v${version}/LeapMore-v${version}-android.apk`);
  assert.equal(await tab.run('document.querySelector("dialog a[href*=quark]").href'), 'https://pan.quark.cn/s/9e6168a73f21');
  await tab.click('dialog[open] [role=switch]');
  await tab.click('dialog[open] [aria-label="关闭"]');
  await reopen();
  assert.equal(await title(), '');
  await tab.run(`sessionStorage.removeItem("fixtureOffline"); sessionStorage.setItem("fixtureTag", ${JSON.stringify('v' + version)})`);
  await reopen();
  assert.equal(await title(), '');
  await click('关于 LeapMore');
  await click('检查更新');
  await until(async () => (await tab.run('document.body.innerText')).includes('当前已是最新版本'));
  assert.ok((await tab.run('document.querySelector("dialog a.update-destination.accent").textContent')).includes(`下载 v${version} · APK`));
  assert.deepEqual(tab.errors, []);
  console.log('Verified startup and foreground checks, modal ordering, per-version skipping, persistent reminders and public download links.');
} finally { await tab.close(); }
