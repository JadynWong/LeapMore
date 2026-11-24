import { browser,wait } from './cdp.mjs';
import assert from 'node:assert/strict';
const app=process.env.LEAPMORE_HA_TEST_APP ?? 'http://127.0.0.1:5176/', ha=process.env.LEAPMORE_HA_TEST_ORIGIN ?? 'http://127.0.0.1:8139';
const b=await browser(app+'#/ha');
const mode=name=>fetch(ha+'/fixture-mode?mode='+name,{method:'POST'});
const stats=()=>fetch(ha+'/fixture-stats').then(r=>r.json());
const find=(s)=>`Array.from(document.querySelectorAll('button,a')).find(e=>e.textContent.trim()===${JSON.stringify(s)})`;
async function click(s){await b.run(`(() => { const e=${find(s)}; if(!e) throw new Error('missing '+${JSON.stringify(s)}); e.click(); })()`);await wait(125);}
async function fill(sel,value,select=false){
 await b.run(`(() => {const e=document.querySelector(${JSON.stringify(sel)}); if(!e)throw new Error(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(${select?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event(${JSON.stringify(select?'change':'input')},{bubbles:true}));})()`);
 await wait(45);
}
async function text(pattern,timeout=6500){const end=Date.now()+timeout;let body=''; while(Date.now()<end){body=await b.run('document.body.innerText'); if(pattern.test(body)) return body; await wait(130);} throw new Error('expected '+pattern+' on '+body.slice(0,900));}
async function route(path){await b.run('location.hash='+JSON.stringify(path));await wait(220);}
async function expandDay() {
  assert.equal(await b.run('document.querySelectorAll(".record-day[open]").length'),0);
  await b.click('.record-day summary');
  assert.equal(await b.run('document.querySelectorAll(".record-day[open]").length'),1);
}
async function dragPlot(selector, from, to) {
  const rect = await b.run(`(() => {
    const timeline = document.querySelector(${JSON.stringify(selector)});
    timeline.scrollIntoView({block:'center'});
    const {left,top,width,height} = timeline.getBoundingClientRect();
    return {left,top,width,height};
  })()`);
  const send = (type, fraction) => b.send('Input.dispatchTouchEvent', {type, touchPoints: fraction == null ? [] :
    [{x:rect.left + rect.width * fraction, y:rect.top + rect.height * .45}]});
  const readings = [];
  await send('touchStart', from);
  for (const step of [.25,.5,.75,1]) {
    await send('touchMove', from + (to - from) * step);
    await wait(30);
    readings.push(await b.run(`document.querySelector(${JSON.stringify(selector)})?.parentElement.querySelector('[role=status], .sample-readout')?.textContent`));
  }
  await send('touchEnd');
  return readings;
}
const dragTimeline = (from,to) => dragPlot('.sample-timeline',from,to);
async function tap(point) {
  await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
try{
 await b.send('Storage.clearDataForOrigin', { origin: new URL(app).origin, storageTypes: 'local_storage,indexeddb' });
 await b.reload();
 await text(/登录 Home Assistant/); await mode('state'); await fill('[aria-label="HA 地址"]',ha); await click('登录 Home Assistant');
 await text(/授权回调无法校验/);
 await mode('normal'); await fill('[aria-label="HA 地址"]',ha); await click('登录 Home Assistant');
 await text(/已读取 1 条行程 · 1 条充电记录/);
 assert.doesNotMatch(await b.run('document.body.innerText'),/管理实体映射|保存映射/);
 await b.click('details summary'); await text(/不可用/);
 assert.equal(await b.run('document.querySelectorAll("select").length'),0);
 await b.reload(); await text(/已连接/);
 await text(/已读取 1 条行程 · 1 条充电记录/);
 await b.run(`(() => {
   const buttons = [...document.querySelectorAll('[aria-label="同步范围"] button')];
   if (buttons.length !== 3 || buttons.some(button => getComputedStyle(button).whiteSpace !== 'nowrap' || button.scrollWidth > button.clientWidth)) {
     throw new Error('同步范围选项在 320px 时折行或溢出');
   }
 })()`);
 await click('重新登录 HA');
 await text(/重新登录 Home Assistant/);
 await click('返回同步设置');
 await text(/立即同步/);
 await route('/home'); const home=await text(/登录零跑查看实时车况/); assert.doesNotMatch(home,/64%|288 km/); assert.match(home,/—/);
 await route('/records'); await expandDay(); const trips=await text(/10.0 km/); assert.match(trips,/HA/); assert.doesNotMatch(trips,/1\.0 km/);
 assert.ok(await b.run(`(() => {
   const tabs = document.querySelector('.record-tabs'), group = tabs.getBoundingClientRect(), parent = tabs.parentElement.getBoundingClientRect();
   const [first, second] = [...tabs.querySelectorAll('button')].map(button => button.getBoundingClientRect());
   return Math.abs(group.left + group.right - parent.left - parent.right) < 2 && Math.abs(first.width - second.width) < 1 && group.right - second.right <= 5;
 })()`));
 const before=await b.run('document.querySelectorAll(".trip-row").length'); assert.equal(before,1);
 await text(/本月行程/);
 assert.match(await b.run('document.querySelector(\'[aria-label="本月行程统计"]\').innerText'), /平均单段[\s\S]*累计耗时[\s\S]*行程耗电/);
 await b.click('[aria-label="行程显示"]'); await text(/缩略图/);
 assert.equal(await b.run('document.querySelector(".app-toast").textContent'), '缩略图');
 await b.run("document.querySelector('.record-day summary').scrollIntoView({block:'center'})");
 for (let i = 0; i < 30 && await b.run('document.querySelectorAll(".record-day .trip-thumbnail-route").length') < 2; i++) await wait(100);
 assert.equal(await b.run('document.querySelectorAll(".record-day .trip-thumbnail-route").length'),2);
 assert.deepEqual(await b.run('[...document.querySelectorAll(".trip-day-totals small")].map(el=>el.textContent.trim())'), ['当天里程 10.0 km', '当天耗时 11 分钟']);
 assert.equal(await b.run('[...document.querySelectorAll(".trip-thumbnail-map")].some(el=>el.textContent.includes("高德地图"))'),false);
 await b.click('[aria-label="行程显示"]'); await text(/卡片/);
 assert.equal(await b.run('document.querySelector(".app-toast").textContent'), '卡片');
 assert.equal(await b.run('document.querySelectorAll(".trip-grid .trip-card").length'),1);
 assert.equal(await b.run('getComputedStyle(document.querySelector(".trip-grid")).gridTemplateColumns.split(" ").length'),3);
 await route('/records?tab=charges'); assert.equal(await b.run('document.querySelector(\'[aria-label="行程显示"]\')'),null);
 assert.equal(await b.run('document.querySelector(\'[aria-label="本月行程统计"]\')'),null);
 await route('/records'); assert.equal(await b.run('document.querySelector(\'[aria-label="行程显示"]\').title'),'卡片');
 await b.click('[aria-label="行程显示"]'); await text(/简洁/);
 assert.equal(await b.run('document.querySelector("dialog[open]")'),null);
 await mode('slow-track');
 await route('/trips/ha-trip-ledger-test'); await text(/2.5/);
 const placeholder = await b.run(`(() => {
   const placeholder = document.querySelector('.trip-map-placeholder');
   const root = document.documentElement, theme = root.dataset.theme;
   const brightness = () => getComputedStyle(placeholder).backgroundColor.match(/[0-9]+/g).slice(0,3).reduce((sum, n) => sum + Number(n), 0);
   root.dataset.theme = 'light'; const light = brightness();
   root.dataset.theme = 'dark'; const dark = brightness();
   root.dataset.theme = theme;
   return {light, dark, height: placeholder.clientHeight};
 })()`);
 assert.equal(placeholder.height, 210);
 assert.ok(placeholder.light > placeholder.dark, JSON.stringify(placeholder));
 await text(/行程路线/);
 await mode('normal');
 assert.match(await b.run("document.querySelector('.appbar .title').textContent"), /\d\d:\d\d → \d\d:\d\d/);
 assert.equal(await b.run("document.querySelector('.sample-timeline')"),null);
 assert.ok(await b.run('document.querySelectorAll(".amap-speed-path").length >= 2'));
 await b.run("document.querySelector('.amap-view').scrollIntoView({block:'center'})");
 const mapPoint = await b.run(`(() => {const r=document.querySelector('.amap-route circle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await tap(mapPoint); await text(/31.0 km\/h · SOC 62%/);
 assert.equal(await b.run("!!document.querySelector('.trip-info + .chart-card .sample-timeline')"),true);
 assert.deepEqual(await b.run("[...document.querySelectorAll('.sample-axis-primary')].map(el=>el.textContent)"),['0','20','40','60','80']);
 await dragTimeline(.10, .65); await text(/68.0 km\/h · SOC 60%/);
 assert.equal(await b.run("document.querySelector('.amap-route-cursor').dataset.sampleAt"),
   await b.run("document.querySelector('.sample-readout').dataset.sampleAt"));
 await b.run("document.querySelector('.sample-timeline').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))");
 await text(/SOC 59% · 暂无定位/);
 assert.equal(await b.run("document.querySelector('.amap-route-cursor')"),null);
 await b.run("document.querySelector('.amap-view').scrollIntoView({block:'center'})");
 const blankMap = await b.run(`(() => {const r=document.querySelector('.amap-view').getBoundingClientRect();return {x:r.left+12,y:r.bottom-12};})()`);
 await tap(blankMap); await wait(120);
 assert.equal(await b.run("document.querySelector('.sample-timeline')"),null);
 await b.run("document.querySelector('.amap-drag').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))");
 await text(/68.0 km\/h · SOC 60%/);
 await b.run("document.querySelector('.amap-drag').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
 assert.equal(await b.run("document.querySelector('.sample-timeline')"),null);
 assert.equal(await b.run('document.querySelector(".trip-coverage")'),null);
 const zoom = () => b.run('Number(document.querySelector(".amap-view").dataset.mapZoom)');
 const zoomBefore = await zoom();
 const firstPoint = await b.run(`(() => {
   const map = document.querySelector('.amap-drag');
   map.scrollIntoView({block:'center'});
   const box = map.getBoundingClientRect();
   return {x:box.left + box.width * .45, y:box.top + box.height / 2};
 })()`);
 const pinch = async (from, to) => {
   const touches = span => [-1, 1].map((sign, id) => ({id, x:firstPoint.x + sign * span, y:firstPoint.y}));
   await b.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:touches(from)});
   for (const fraction of [.33, .67, 1]) {
     await b.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:touches(from + (to - from) * fraction)});
     await wait(25);
   }
   await b.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
 };
 await pinch(25, 55);
 assert.ok(await zoom() > zoomBefore + .8);
 assert.equal(await b.run('document.querySelector(".sample-timeline")'),null);
 await pinch(55, 25);
 assert.ok(Math.abs(await zoom() - zoomBefore) < .1);
 await b.click('[aria-label="回到路线"]');
 assert.equal(await zoom(), zoomBefore);
 await route('/records?tab=charges'); await expandDay(); await text(/16.2 kWh/);
 await text(/本月电费估算/);
 assert.match(await b.run("document.querySelector('.trip-sum .expense-totals').innerText"),/交流[\s\S]*直流/);
 const chargeHeight = await b.run('document.querySelector(".trip-sum").getBoundingClientRect().height');
 const costLabels = await b.run(`Array.from(document.querySelectorAll('.expense-totals-titled .tiny'), el =>
   [el.textContent, el.getBoundingClientRect().top - el.closest('.expense-totals-titled').getBoundingClientRect().top])`);
 assert.deepEqual(costLabels, [['本月电费估算', 0], ['合计', 0], ['交流', 0], ['直流', 0]]);
 assert.match(await b.run("document.querySelector('.charge-estimate').textContent"),/约 ¥.*元\/kWh/);
 assert.deepEqual(await b.run("[...document.querySelectorAll('[aria-label=记录类型] [role=tab]')].map(tab=>tab.textContent.trim())"), ['行程','充电']);
 assert.doesNotMatch(await b.run('document.body.innerText'),/31\.4 kWh|22\.8 kWh/);
 assert.equal(await b.run('document.querySelectorAll(".trip-row").length'),1);
 await route('/records');
 assert.equal(await b.run('document.querySelector(".trip-sum").getBoundingClientRect().height'), chargeHeight);
 await route('/charges/ha-charge-ledger-charge'); await text(/充电功率/); await text(/平均采样功率/);
 assert.deepEqual(await b.run("[...document.querySelectorAll('.sample-axis-primary')].map(el=>el.textContent)"),['0','2','4','6','8']);
 assert.deepEqual(await b.run("[...document.querySelectorAll('.sample-axis-soc')].map(el=>el.textContent)"),['0','25','50','75','100']);
 await dragTimeline(.10, .50); await text(/暂无功率 · SOC 55%/);
 await dragTimeline(.50, .92); await text(/7.1 kW · SOC 67%/);
 await route('/records-source');
 await b.run("[...document.querySelectorAll('button.row')].find(e=>e.innerText.startsWith('电价设置')).click()");
 await text(/保存电价/); await click('取消');
 await route('/records?tab=cost'); await text(/充电费用估算/);
 assert.match(await b.run('location.hash'),/^#\/energy\?section=cost/);
 assert.ok(await b.run(`(() => {
   const header=document.querySelector('.trend-card .chart-head'), h=header.getBoundingClientRect();
   const title=header.querySelector('h3').getBoundingClientRect();
   return [...header.querySelectorAll('.seg')].length===2 && [...header.querySelectorAll('.seg')].every(el=>{
     const r=el.getBoundingClientRect();return r.left>=title.right&&r.right<=h.right+1&&r.top<title.bottom&&r.bottom>title.top;
   });
 })()`));
 await b.click('[aria-label="费用统计范围"] button:nth-child(1)');
 assert.equal(await b.run('document.querySelector(".expense-plot").getAttribute("aria-label")'),'近 7 天预估电费柱状图');
 await b.click('[aria-label="费用统计范围"] button:nth-child(2)');
 assert.equal(await b.run('document.querySelectorAll(".expense-plot rect").length'),1);
 const expenseBar=await b.run(`(() => {
   document.querySelector('.expense-day-plot').scrollIntoView({block:'center'});
   const bar=document.querySelector('.expense-plot rect'), r=bar.getBoundingClientRect();
   return {day:bar.dataset.day,x:r.left+r.width/2,y:r.top+r.height/2};
 })()`);
 await tap({x:expenseBar.x,y:expenseBar.y}); await wait(120);
 assert.equal(await b.run("document.querySelector('#expense-day-reading').dataset.day"),expenseBar.day);
 assert.ok(await b.run("document.querySelector('#expense-day-reading').textContent.includes('¥') && document.querySelector('.expense-day-plot').classList.contains('show-guide')"));
 const scrubReadings = await dragPlot('.expense-day-plot',.88,.36);
 assert.ok(new Set(scrubReadings.filter(Boolean)).size >= 2, JSON.stringify(scrubReadings));
 const expenseReading=await b.run("document.querySelector('#expense-day-reading').dataset.day");
 assert.notEqual(expenseReading,expenseBar.day);
 const offChart=await b.run(`(() => {const r=document.querySelector('.expense-card h3').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
 await tap(offChart); await wait(120);
 assert.equal(await b.run("document.querySelector('.expense-day-plot').classList.contains('show-guide')"),false);
 assert.equal(await b.run("document.querySelector('#expense-day-reading').dataset.day"),expenseReading);
 await b.click('[aria-label="费用统计范围"] button:nth-child(3)');
 await text(/请登录零跑账号查看排名/); await wait(500);
 assert.doesNotMatch(await b.run("document.querySelector('[data-energy-card=rank]').innerText"),/超过 8%|18.5/);
 assert.equal(await b.run('document.querySelectorAll(".expense-plot rect").length'),2);
 await text(/耗电/); await text(/17.5/); assert.match(await b.run('document.querySelector("#energy-day-reading").textContent'),/\d|—/);
 await b.click('[aria-label="时间范围"] button:nth-child(2)');
 await text(/17.5/);
 const beforeStatsReturn = await stats();
 assert.ok(beforeStatsReturn.energy >= 2);
 await route('/mine'); await route('/energy');
 assert.equal(await b.run(`document.querySelector('[aria-label="时间范围"] button[aria-pressed="true"]').textContent`), '月');
 assert.equal((await stats()).energy, beforeStatsReturn.energy);
 await route('/ha'); await text(/立即同步/);
 const firstSync = await stats();
 await click('立即同步'); await text(/已读取 1 条行程 · 1 条充电记录/);
 const manualSync = await stats();
 assert.ok(manualSync.trips > firstSync.trips && manualSync.charges > firstSync.charges);
 await route('/records'); assert.equal(await b.run('document.querySelectorAll(".trip-row").length'),1);
 await mode('reset'); await route('/ha'); await click('立即同步'); await wait(700);
 const scope=await stats(); assert.ok(scope.bootstrap>=4&&scope.pull>=2&&scope.membership>=2,JSON.stringify(scope));
 await mode('active-ledger'); await click('立即同步'); await route('/records'); await text(/正在记录行程/);
 assert.equal(await b.run('document.querySelectorAll(".trip-row").length'),1);
 assert.deepEqual(await b.run('[...document.querySelectorAll(".recording dd")].map(e => e.textContent)'), ['47 km/h', '4.5 km']);
 await route('/records?tab=charges');
 assert.equal(await b.run('document.querySelectorAll(".recording").length'),0);
 await mode('active-charge'); await route('/ha'); await click('立即同步'); await text(/已读取 1 条行程 · 2 条充电记录/);
 await route('/records');
 assert.equal(await b.run('document.querySelectorAll(".recording").length'),0);
 await route('/records?tab=charges'); await text(/正在记录充电/);
 assert.deepEqual(await b.run('[...document.querySelectorAll(".recording dd")].map(e => e.textContent)'), ['61.0%', '4.2 kWh', '7.4 kW']);
 await mode('empty-ledger'); await route('/ha'); await click('立即同步'); await text(/已读取 0 条行程 · 0 条充电记录/);
 await route('/records?tab=charges'); await text(/暂无充电记录/);
 assert.equal(await b.run('document.querySelectorAll(".recording").length'),0);
 await route('/records'); await text(/暂无行程记录/);
 await mode('normal'); await route('/ha'); await click('立即同步'); await text(/已读取 1 条行程 · 1 条充电记录/);
 await mode('offline'); await click('立即同步'); await text(/网络不可用|服务暂不可用|连接中断/,9500);
 await route('/home'); await text(/登录零跑查看实时车况/);
 await mode('refresh'); await route('/ha'); await click('立即同步'); await wait(800); assert.ok((await stats()).refresh>=1);
 await mode('expired'); await click('立即同步'); await text(/授权失效/);
 await mode('normal'); await click('手动输入长期访问令牌'); await fill('[aria-label="访问令牌"]','local-manual-fixture'); await click('连接并测试'); await text(/已连接/); await text(/立即同步/);
 await route('/records-source'); await text(/清理本地记录/); await b.run("Array.from(document.querySelectorAll('button.row')).find(e=>e.innerText.includes('清理本地记录')).click()");await text(/输入「清除本地记录」/);
 await fill('[aria-label="输入清除本地记录"]','清除本地记录');await click('清除记录');await text(/已关闭记录/);
 await mode('limited');
 await b.send('Storage.clearDataForOrigin', { origin: new URL(app).origin, storageTypes: 'local_storage,indexeddb' });
 await route('/ha'); await b.reload(); await text(/登录 Home Assistant/);
 await fill('[aria-label="HA 地址"]',ha); await click('登录 Home Assistant');
 await text(/HA 实体注册表不可用/);
 await text(/已读取 1 条行程 · 1 条充电记录/);
 await text(/零跑原始档案暂不可用/);
 await mode('charge-unavailable'); await click('立即同步'); await text(/LeapToHA 充电记录暂不可用/);
 await route('/records?tab=charges'); await expandDay(); await text(/16.2 kWh/);
 await mode('multi'); await route('/ha'); await click('立即同步'); await text(/请选择要同步的车辆/);
 assert.doesNotMatch(await b.run('document.body.innerText'),/已读取 \d 条行程/);
 await fill('[aria-label="HA 车辆"]','LFB1A2B3C4D000002',true); await text(/已读取 1 条行程 · 0 条充电记录/);
 await route('/home'); assert.doesNotMatch(await text(/登录零跑查看实时车况/),/19%/);
 await route('/records'); await expandDay(); await text(/77.0 km/); assert.doesNotMatch(await b.run('document.body.innerText'),/10.0 km/);
 await route('/ha'); await fill('[aria-label="HA 车辆"]','LFB1A2B3C4D000001',true); await text(/已读取 1 条行程 · 1 条充电记录/);
 await mode('offline'); await click('立即同步'); await text(/网络不可用|服务暂不可用|连接中断/);
 await route('/records'); await expandDay();
 await b.run(`document.querySelector('.trip-row').dispatchEvent(new KeyboardEvent('keydown', {key:'Delete', bubbles:true}))`);
 await text(/仅从本机的行程列表和导出中移除/);
 assert.equal((await stats()).deletes, 0);
 await click('确认删除'); await text(/已从本机删除行程/);
 assert.equal(await b.run('document.querySelectorAll(".trip-row").length'), 0);
 await mode('normal'); await route('/ha'); await click('立即同步'); await text(/已读取 1 条行程 · 1 条充电记录/);
 assert.equal((await stats()).deletes, 0);
 await route('/records'); await b.reload(); await text(/暂无行程记录/);
 await route('/ha'); await mode('multi'); await click('立即同步'); await text(/HA 车辆/);
 await fill('[aria-label="HA 车辆"]','LFB1A2B3C4D000002',true); await text(/已读取 1 条行程 · 0 条充电记录/);
 await route('/records'); await expandDay(); await text(/77.0 km/);
 assert.equal(b.errors.length,0,JSON.stringify(b.errors));
 console.log(JSON.stringify({auth:'state rejection and PKCE redirect/exchange',discovery:'automatic single VIN and isolated multiple vehicles',records:'HA list parity, active trip, server-associated official charge and sampled curve, empty ledger, costs, track and energy',deletion:'local removal while HA is offline, reload and sync keep server records',sync:'automatic and manual sync, no archive permission, bootstrap/membership/pull/reset/dedupe',recover:'partial failures, offline cache, refresh, expiry and manual token',stats:await stats(),browserErrors:b.errors}));
} catch(error){console.error(error); console.error(b.errors);process.exitCode=1;}
finally{await mode('normal');await b.close();}
