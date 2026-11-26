import assert from 'node:assert/strict';
import { browser, wait } from './cdp.mjs';

const base = process.env.LEAPMORE_DEMO_ORIGIN ?? 'http://127.0.0.1:5175/';
function fixture() {
  window.CapacitorCustomPlatform = { name: 'openharmony' };
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  const plugins = { App: ['getInfo'], LeapNet: ['request'], LeapVault: ['get'], LeapSettings: ['diagnosticEnvironment', 'saveText'] };
  window.Capacitor = {
    PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({ name, methods: methods.map(name => ({ name, rtype: 'promise' })) })),
    nativePromise: async (name, op, options) => {
      if (name === 'LeapNet') {
        const path = new URL(options.url).pathname;
        if (path.endsWith('sendmessagecode')) return { status: 200, data: '{"code":0}' };
        if (path.endsWith('check_login_with_phone')) {
          if (!window.testVehicleFailure) throw { code: 'HARMONY_HTTP_2300006', message: 'private-network-message' };
          return { status: 200, data: JSON.stringify({ code: 0, data: { token: 'test-secret', accountId: 'test-user-id' } }) };
        }
        if (path.endsWith('account/v1/login')) throw { code: 'HARMONY_HTTP_2300060' };
        return { status: 404, data: '' };
      }
      if (name === 'App') return { version: 'fixture', build: '1' };
      if (op === 'diagnosticEnvironment') return { os: 'OpenHarmony fixture', sdk: 26, activeNetwork: true, validated: true, wifi: true };
      if (op === 'saveText') { window.testReport = options.text; return { saved: true }; }
      return {};
    },
  };
}
const tab = await browser('about:blank');
async function until(expr) {
  for (let n = 0; n < 100; n++) { if (await tab.run(expr)) return; await wait(80); }
  throw Error('未满足预期 ' + expr);
}
const fill = (label, value) => tab.run(`(() => { const input = document.querySelector('[aria-label="${label}"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
  input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
const click = text => tab.run(`[...document.querySelectorAll('button,a')].find(n=>n.textContent.trim()===${JSON.stringify(text)}).click()`);
try {
  await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + fixture.toString() + ')()' });
  await tab.navigate(base + '#/login');
  await until("!!document.querySelector('[aria-label=同意条款]')");
  await tab.click('[aria-label=同意条款]');
  await fill('手机号', '13800001234'); await click('获取验证码');
  await until("document.body.innerText.includes('验证码已发送')");
  await fill('验证码', '654321'); await click('登录');
  await until("document.body.innerText.includes('域名解析失败（鸿蒙 2300006）')");
  await tab.run('window.testVehicleFailure=true');
  await click('登录');
  await until("document.body.innerText.includes('获取车辆服务授权失败。安全连接或证书校验失败')");
  await click('故障诊断与导出');
  await until("document.body.innerText.includes('最近失败')");
  await click('检测网络与车辆');
  await until("document.body.innerText.includes('已收到 HTTP 响应')");
  await click('导出 TXT');
  await until('!!window.testReport');
  const report = await tab.run('window.testReport');
  assert.match(report, /network\s+connected/);
  assert.match(report, /webViewOnline\s+false/);
  assert.match(report, /lastLoginFailure[^\r\n]*"stage":"vehicle-auth"/);
  assert.match(report, /lastLoginFailure[^\r\n]*"activeNetwork":true/);
  assert.match(report, /lastLoginFailure[^\r\n]*"nativeCode":2300060/);
  assert.doesNotMatch(report, /test-secret|test-user-id|13800001234|654321|private-network-message/);
  console.log('鸿蒙模拟桥回归通过：网页误报离线、短信校验 DNS 失败、车辆授权 TLS 失败、原生网络快照和脱敏 TXT 导出。');
} finally { await tab.close(); }
