import { browser, wait } from './cdp.mjs';
import assert from 'node:assert/strict';

const origin = process.env.LEAPMORE_DEMO_ORIGIN ?? 'http://127.0.0.1:5175/';
const b = await browser(origin, 390, 844);
const match = async (pattern, timeout = 6500) => {
  let body = '';
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    body = await b.run('document.body.innerText');
    if (pattern.test(body)) return;
    await wait(100);
  }
  throw new Error('未找到 ' + pattern + '\n' + body.slice(0, 800));
};
const click = async (label, selector = 'button,a') => {
  await b.run(`(() => {
    const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(label)});
    if (!element) throw Error(${JSON.stringify(label)});
    element.click();
  })()`);
  await wait(145);
};
const route = async (path) => { await b.run('location.hash=' + JSON.stringify(path)); await wait(190); };
const fill = async (label, value) => {
  await b.run(`(() => {
    const i = document.querySelector('[aria-label='+CSS.escape(${JSON.stringify(label)})+']') ?? [...document.querySelectorAll('input')].find(el=>el.labels?.[0]?.textContent.trim() === ${JSON.stringify(label)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});
    i.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
};
try {
  if ((await b.run('document.body.innerText')).includes('欢迎使用 LeapMore')) await click('我知道了');
  const session = await b.run("localStorage.getItem('leapmore.mode')");
  if (session !== '"demo"') {
    await route('/login');
    await click('使用演示账号');
    await click('进入车辆');
  }
  await route('/home');
  await match(/车辆位置/);
  if (process.env.LEAPMORE_TEST_3D === '1') {
    await b.run(`new Promise((resolve, reject) => {
      const stop = Date.now() + 19000;
      function check() {
        if (document.querySelector('.home-model')?.dataset.modelStatus === 'full') { resolve(); return; }
        if (Date.now() > stop) { reject(new Error('首页 3D 未加载')); return; }
        setTimeout(check, 100);
      }
      check();
    })`);
    await b.run("window.checkedHomeViewer = document.querySelector('.home-model iframe'); window.checkedHomeViewerLoads = 0; window.checkedHomeViewer.addEventListener('load', () => window.checkedHomeViewerLoads++);");
    const drag = await b.run(`new Promise(resolve => {
      const frame = window.checkedHomeViewer.contentWindow;
      const startingAngle = frame.viewer.controls.getAzimuthalAngle();
      frame.addEventListener('message', function check(event) {
        if (event.data?.t !== 'test-orbit-check') return;
        frame.removeEventListener('message', check);
        const difference = frame.viewer.controls.getAzimuthalAngle() - startingAngle;
        resolve(Math.atan2(Math.sin(difference),Math.cos(difference)));
        frame.postMessage({t:'orbit-reset', animate:false}, location.origin);
      });
      frame.postMessage({t:'orbit', azimuth:.22, pitch:0, zoom:1}, location.origin);
      frame.postMessage({t:'test-orbit-check'}, location.origin);
    })`);
    assert.ok(Math.abs(drag - .22) < .03, '触摸消息到达时应直接更新镜头');
    await route('/energy');
    assert.equal(await b.run(`(() => {
      const {renderer, scene, camera} = window.checkedHomeViewer.contentWindow.viewer;
      const frame = renderer.info.render.frame;
      renderer.render(scene, camera);
      return renderer.info.render.frame === frame;
    })()`), true);
    await route('/mine');
    await route('/home');
    assert.equal(await b.run("window.checkedHomeViewer === document.querySelector('.home-model iframe') && window.checkedHomeViewerLoads === 0"), true);
  }
  await click('胎压');
  await click('设置范围');
  await fill('最低胎压（kPa）','235');
  await fill('最高胎压（kPa）','245');
  await click('保存范围');
  await match(/235–245 kPa/);
  assert.equal(await b.run("document.querySelectorAll('.tire-diagram .tire[data-pressure-alert]').length"), 2);
  await b.click('dialog[open] [aria-label=关闭]');
  assert.equal(await b.run("document.querySelector('.home-entries button').getAttribute('aria-description')"), '胎压异常');
  assert.equal(await b.run("getComputedStyle(document.querySelector('.home-entries button .entry-ic'), '::after').backgroundColor"), 'rgb(219, 68, 55)');
  await route('/control');
  await match(/235–245 kPa/);
  await route('/home');
  await b.click('[aria-label=车窗]');
  await click('开一条缝');
  await match(/确认车窗开一条缝/);
  await click('取消');
  await b.click('[aria-label=空调预设]');
  await click('极速降温');
  await click('确认发送');
  await match(/车端已确认/);
  await wait(1050);
  await match(/16.0/);
  await b.click('[aria-label="座椅与加热"]');
  await match(/主驾座椅加热/);
  await b.run("document.querySelector('dialog[open]').dispatchEvent(new Event('cancel',{cancelable:true}))");
  await route('/location');
  await match(/车辆位置/);
  const marker = await b.run(`(() => {
    const map = document.querySelector('.location-map .amap-view').getBoundingClientRect();
    const button = document.querySelector('.location-map .amap-car');
    const pin = button.getBoundingClientRect(), icon = button.querySelector('svg').getBoundingClientRect();
    const center = rect => [rect.x + rect.width / 2, rect.y + rect.height / 2];
    return { width: pin.width, pin: center(pin), map: center(map), icon: center(icon) };
  })()`);
  assert.equal(marker.width, 26);
  assert.ok(marker.pin.every((value, i)=>Math.abs(value-marker.map[i])<1 && Math.abs(value-marker.icon[i])<1));
  assert.equal(await b.run(`document.querySelector('.location-page .hint').classList.contains('warn')`),false);
  await click('去配置');
  await match(/Web 服务 Key/);
  await click('取消','dialog button');
  await click('管理');
  await fill('名称','测试车位');
  await fill('地址','模拟车位 A');
  await click('添加常用地址','dialog button');
  await match(/模拟车位 A/);
  await b.click('dialog[open] [aria-label=关闭]');
  await b.click('[aria-label="发送导航到测试车位"]');
  await match(/确认发送导航到测试车位/);
  await click('取消');
  await click('管理');
  await b.click('[aria-label="删除测试车位"]');
  await click('删除');
  assert.ok(!(await b.run('document.body.innerText')).includes('模拟车位 A'));
  await b.click('dialog[open] [aria-label=关闭]');
  await route('/trips/demo-trip-0');
  await b.click('[aria-label=放大]');
  await match(/2.0×/);
  await b.click('[aria-label=回到路线]');
  await b.click('[aria-label=切换底图]');
  await match(/日间/);
  await b.click('[aria-label=切换底图]');
  await match(/卫星/);
  await route('/appearance');
  if (process.env.LEAPMORE_TEST_3D === '1') {
    await match(/本地样例/,23000);
    assert.equal(await b.run("document.querySelector('[aria-label=\"3D 设置\"]').getAttribute('aria-expanded')"),'true');
    assert.ok(await b.run(`(() => {
      const preview=document.querySelector('.appearance-preview').getBoundingClientRect();
      const settings=document.querySelector('.appearance-controls').getBoundingClientRect();
      window.appearanceFrame=document.querySelector('.c3d-stage iframe');
      return preview.height >= 190 && settings.top >= preview.bottom && !document.querySelector('dialog[open]');
    })()`));
    await click('夜间','[aria-label="背景"] button');
    for(let attempt=0;attempt<15;attempt++){
      if(await b.run(`(() => {const node=window.appearanceFrame.contentWindow.__api?.skyNode(), u=node?.material.uniforms;
        return u?.dayOrNight?.value===1&&u.nightTexture.value.image.dataset?.source==='procedural-night';})()`)) break;
      await wait(140);
    }
    assert.equal(await b.run(`(() => {const node=window.appearanceFrame.contentWindow.__api?.skyNode(), u=node?.material.uniforms;
      const sky=u?.nightTexture?.value?.image;
      if(u?.dayOrNight?.value!==1||sky?.dataset?.source!=='procedural-night')return false;
      const pixel=sky.getContext('2d').getImageData(0,sky.height-1,1,1).data;
      const floor=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      const expected=[1,3,5].map(offset=>Number.parseInt(floor.slice(offset,offset+2),16));
      return expected.every((value,i)=>pixel[i]===value);
    })()`),true);
    await b.click('[aria-label=冰川蓝]');
    await match(/冰川蓝/);
    await b.click('[aria-label=自定义车漆]');
    await match(/色相/);
    assert.equal(await b.run("window.appearanceFrame===document.querySelector('.c3d-stage iframe') && !!document.querySelector('.model-orbit') && !document.querySelector('dialog[open]')"),true);
    await click('完成');
    await click('自定义车衣');
    await click('条纹');
    await match(/不透明度/);
    await click('清除本面');
    await click('完成');
  }
  await click('仅 2D');
  await click('B10');
  await click('查询商城车模');
  await click('完成');
  await match(/B10 · 2D 车模/);
  await route('/home');
  assert.equal(await b.run("document.querySelector('.home-model')?.dataset.modelStatus"), '2d');
  await route('/energy');
  await b.click('[aria-label="编辑"]');
  await b.click('[aria-label="删除近 6 周能耗排名"]');
  await click('+ 添加卡片');
  await click('近 6 周能耗排名','dialog button');
  await b.click('[aria-label="完成"]');
  await route('/operation-pin');
  await fill('设置操作密码','5566');
  await fill('确认操作密码','5566');
  await click('保存操作密码');
  await match(/已加密保存/);
  await route('/mine');
  await b.click('.settings-page a[href="#/mine/appearance"]');
  await match(/主题色/);
  await click('深色');
  assert.equal(await b.run('document.documentElement.dataset.theme'),'dark');
  assert.ok(await b.run(`(() => {
    const group = document.querySelector('[aria-label="主题"]');
    const [light,dark,system] = group.children;
    return light.offsetWidth === dark.offsetWidth && system.getBoundingClientRect().right <= group.getBoundingClientRect().right &&
      dark.getAttribute('aria-pressed') === 'true' && !['切换账号', '单位与格式'].some(label => document.body.innerText.includes(label));
  })()`));
  await route('/home');
  assert.equal(await b.run('getComputedStyle(document.querySelector(".hero-actions .circ svg")).stroke'),'rgb(139, 201, 236)');
  await route('/mine/appearance');
  await click('紫色');
  const accent = () => b.run('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()');
  assert.equal(await accent(), '#bc9cfa');
  await route('/home');
  assert.equal(await b.run('getComputedStyle(document.querySelector(".hero-actions .circ svg")).stroke'),'rgb(188, 156, 250)');
  await route('/mine/appearance');
  const systemColor = value => b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
  await systemColor('light');
  await click('跟随系统');
  assert.equal(await b.run('document.documentElement.dataset.theme'),'light');
  assert.equal(await accent(), '#6e4bb4');
  await systemColor('dark');
  await wait(180);
  assert.equal(await b.run('document.documentElement.dataset.theme'),'dark');
  await b.reload();
  await match(/主题色/);
  assert.equal(await accent(), '#bc9cfa');
  assert.equal(await b.run('document.querySelector(".theme-swatches [aria-pressed=true]").textContent'),'紫色');
  await click('默认蓝');
  assert.equal(await accent(), '#03a9f4');
  await click('浅色');
  assert.equal(await b.run('document.documentElement.dataset.theme'),'light');
  await systemColor('light');
  await b.click('.appbar [aria-label="返回"]');
  await click('退出登录');
  await match(/退出登录？/);
  await click('取消');
  await click('关于 LeapMore');
  await match(/0\.1\.0 · 预发布/);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
  const repositoryLinks = await b.run(`[...document.querySelectorAll('dialog[open] a')].map(link => [link.href, link.querySelector('small')?.innerText])`);
  const repositoryUrls = ['https://github.com/MiRaToo/LeapMore', 'https://gitcode.com/MiraRato/LeapMore'];
  assert.deepEqual(repositoryLinks, repositoryUrls.map(url => [url, url]));
  assert.ok(await b.run(`[...document.querySelectorAll('dialog[open] a small')].every(label => label.offsetWidth >= label.scrollWidth)`));
  await click('GitCode', '[aria-label="首选更新源"] button');
  await b.click('dialog[open] [aria-label=关闭]');
  await click('关于 LeapMore');
  assert.equal(await b.run(`document.querySelector('[aria-label="首选更新源"] button[aria-pressed="true"]').textContent`), 'GitCode');
  await click('检查更新');
  await match(/模拟检查完成 · 0\.1\.0/);
  await click('忽略此版本');
  await match(/恢复版本提醒/);
  await b.click('dialog[open] .about-license summary');
  assert.match(await b.run("document.querySelector('dialog[open] details[open] .about-license-text').innerText"), /GNU GENERAL PUBLIC LICENSE/);
  assert.equal(b.errors.length, 0, JSON.stringify(b.errors));
  console.log('控车弹层、空调预设、常用地址导航、路线地图、车型、能源卡片、操作密码、主题和预发布检查通过。');
} finally {
  await b.close();
}
