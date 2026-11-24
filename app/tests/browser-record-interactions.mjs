import { browser, wait } from './cdp.mjs';
import assert from 'node:assert/strict';

const app = process.env.LEAPMORE_DEMO_ORIGIN ?? 'http://127.0.0.1:5175/';
const b = await browser(app, 390, 844);
const route = async path => { await b.run('location.hash=' + JSON.stringify(path)); await wait(200); };
const touch = (type, point) => b.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
async function swipe(from, to, beforeEnd) {
  await touch('touchStart', from);
  for (const fraction of [.25, .5, .75, 1]) {
    await touch('touchMove', { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction });
    await wait(25);
  }
  if (beforeEnd) await beforeEnd();
  await touch('touchEnd');
}

try {
  await b.run(`localStorage.setItem('leapmore.mode', '"demo"'); localStorage.setItem('leapmore.activeVehicle', '"demo-c10"');
    localStorage.removeItem('leapmore.source'); localStorage.removeItem('leapmore.energyCards');`);
  await b.reload();
  await route('/energy');
  assert.equal(await b.run("JSON.parse(localStorage.getItem('leapmore.theme'))"), 'system');
  assert.equal(await b.run("JSON.parse(localStorage.getItem('leapmore.source'))"), 'hybrid');
  assert.ok(await b.run(`(() => {
    const series = document.querySelector('.trend-card .plot-series');
    return series && getComputedStyle(series).animationName === 'plot-reveal';
  })()`));
  await b.click('[aria-label="编辑"]');
  const order = () => b.run('[...document.querySelectorAll(".energy-card")].map(card => card.dataset.energyCard)');
  const beforeOrder = await order();
  const cardPoint = key => b.run(`(() => {
    const rect = document.querySelector('[data-energy-card="${key}"]').getBoundingClientRect();
    return { x: rect.left + 36, y: rect.top + 46 };
  })()`);
  const rankPoint = await cardPoint('rank');
  await swipe(rankPoint, { x:rankPoint.x, y:rankPoint.y - 140 });
  await wait(120);
  assert.ok(await b.run('document.querySelector(".app-view").scrollTop > 50'));
  assert.deepEqual(await order(), beforeOrder);
  await b.run('document.querySelector(".app-view").scrollTop=0');
  const fromCard = await cardPoint('stats'), toCard = await cardPoint('rank');
  await touch('touchStart', fromCard);
  await wait(280);
  assert.ok(await b.run('!!document.querySelector("[data-energy-card=stats][data-dragging]")'));
  await touch('touchMove', toCard);
  await touch('touchEnd');
  assert.deepEqual((await order()).slice(0, 2), ['rank', 'stats']);
  await b.click('[aria-label="完成"]');
  await b.click('[aria-label="时间范围"] button:nth-child(2)');
  await b.click('[aria-label="图表类型"] button:nth-child(2)');
  await b.click('[aria-label="趋势指标"] button:nth-child(2)');
  await b.click('[aria-label="费用统计范围"] button:nth-child(3)');
  await b.run(`document.querySelector('.trend-card .energy-plot').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft',bubbles:true}));
    document.querySelector('.app-view').scrollTop=220;`);
  await wait(50);
  const energyView = () => b.run(`({
    options: [...document.querySelectorAll('.energy-screen [aria-pressed="true"]')].map(option => option.textContent.trim()),
    top: document.querySelector('.app-view').scrollTop,
    reading: document.querySelector('#energy-day-reading').textContent
  })`);
  const energyBefore = await energyView();
  assert.deepEqual(energyBefore.options, ['月', '折线', '耗电', '90 天']);
  assert.ok(energyBefore.top > 0);
  await route('/home');
  assert.equal(await b.run("document.querySelector('.energy-screen').hidden"), true);
  await route('/energy');
  assert.deepEqual(await energyView(), energyBefore);
  assert.equal(await b.run("getComputedStyle(document.querySelector('.trend-card .plot-series')).animationName"), 'none');
  await route('/records');
  const daySummary = await b.run(`(() => {
    const summary = document.querySelector('.record-day summary');
    summary.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
    return summary.parentElement.querySelector('.record-day-items').getAnimations().length;
  })()`);
  assert.equal(daySummary, 1);
  await wait(250);
  assert.ok(await b.run('document.querySelector(".record-day").open'));
  await b.run(`document.querySelector('.record-day summary').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}))`);
  await wait(250);
  assert.equal(await b.run('document.querySelector(".record-day").open'), false);
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:420,deviceScaleFactor:1,mobile:true});
  const headingTop = () => b.run('document.querySelector(".appbar, .hero-top").getBoundingClientRect().top');
  const recordsHeading = await headingTop();
  await b.run("document.querySelectorAll('.record-day').forEach(day => day.open = true)");
  const viewport = '.app-view';
  const navVisible = () => b.run('!document.querySelector(".tabbar").classList.contains("nav-concealed")');
  await b.run(`document.querySelector('${viewport}').scrollTop=130`);
  await wait(100);
  assert.equal(await navVisible(), false);
  assert.equal(await headingTop(), recordsHeading);
  await b.run(`document.querySelector('${viewport}').scrollTop=45`);
  await wait(100);
  assert.equal(await navVisible(), true);
  await b.run(`document.querySelector('${viewport}').scrollTop=0`);
  await swipe({ x:175, y:205 }, { x:175, y:288 }, async () => {
    assert.match(await b.run("getComputedStyle(document.querySelector('.app-scroll-content > .page')).translate"), /^0px [1-9]/);
    assert.equal(await headingTop(), recordsHeading);
  });
  await wait(280);
  assert.equal(await b.run("getComputedStyle(document.querySelector('.app-scroll-content > .page')).translate"), 'none');
  await b.run(`const view = document.querySelector('${viewport}'); view.scrollTop=view.scrollHeight`);
  await swipe({ x:175, y:265 }, { x:175, y:180 }, async () => {
    assert.match(await b.run("getComputedStyle(document.querySelector('.app-scroll-content > .page')).translate"), /^0px -[1-9]/);
    assert.equal(await headingTop(), recordsHeading);
  });
  for (const path of ['/mine', '/home']) {
    await route(path);
    const top = await headingTop();
    await b.run(`document.querySelector('${viewport}').scrollTop=200`);
    await wait(80);
    const scrolled = await b.run(`document.querySelector('${viewport}').scrollTop > 100`);
    assert.ok(scrolled, path + ' scrolls independently of its header');
    if (path === '/home') assert.ok(await headingTop() < top - 100);
    else assert.equal(await headingTop(), top);
  }
  const homeNotPulling = async () => {
    assert.equal(await b.run("document.querySelector('.app-scroll-content').style.getPropertyValue('--page-pull')"), '');
    assert.equal(await b.run("getComputedStyle(document.querySelector('.home .hero')).translate"), 'none');
  };
  await b.run(`document.querySelector('${viewport}').scrollTop=0`);
  await swipe({ x:175, y:205 }, { x:175, y:288 }, homeNotPulling);
  await b.run(`const homeView=document.querySelector('${viewport}'); homeView.scrollTop=homeView.scrollHeight`);
  await swipe({ x:175, y:265 }, { x:175, y:180 }, homeNotPulling);
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await route('/records-source');
  const defaultOption = () => b.run(`[...document.querySelectorAll('.source-opt')].filter(b => b.querySelector('.pill')?.textContent === '默认')
    .map(b => [b.querySelector('b').textContent, b.getAttribute('aria-pressed')])`);
  assert.deepEqual(await defaultOption(), [['手机记录 + HA 同步', 'true']]);
  await b.run(`[...document.querySelectorAll('.source-opt')].find(b => b.querySelector('b').textContent === '手机记录').click()`);
  await b.reload();
  assert.deepEqual(await defaultOption(), [['手机记录 + HA 同步', 'false']]);
  assert.equal(await b.run("document.querySelector('.source-opt[aria-pressed=true] b').textContent"), '手机记录');
  assert.deepEqual(b.errors, []);
  console.log('统计卡长按、普通滚动、图表入场、每日展开收起、导航隐藏和列表两端回弹通过。');
} finally {
  await b.close();
}
