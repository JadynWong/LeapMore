import { useState } from 'react';
import { AppBar, Hint, Row, Section, Seg, stamp, Switch, value } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useModelContext } from '../context';
import { ControlNotice } from './commands';
import { CabinHeatingRows, chargeLabels, useVehicleControls } from './controls';
import { Tires } from './Home';
import { BatteryPreheat } from './BatteryPreheat';
import { useChargingConfig } from './chargeSchedules';
import { repeatLabel, WeekdaySelector } from './WeekdaySelector';

export function VehicleControl() {
  const { current, simulated, tireRange, tireAlerts } = useModelContext();
  const c = useVehicleControls();
  const [tires, showTires] = useState(false);
  const block = !!c.reason('climate');
  const s = c.settings;
  const abnormalTires = tireAlerts.some(Boolean);
  const normalTires = current.tires.length === 4 && current.tires.every(x => x !== null) && !abnormalTires;
  return <><AppBar title="车辆控制" back="/home" sub={simulated ? '更新于 今天 20:35' : current.at ? '更新于 ' + stamp(current.at) : undefined} /><div className="page no-nav">
    <ControlNotice />
    <Section title={<>胎压 {normalTires && <span className="pill green">正常</span>}{abnormalTires && <span className="pill warn">异常</span>}
      <button className="link push" onClick={() => showTires(true)}>查看</button></>}>
      <div className="tpms">{['左前', '右前', '左后', '右后'].map((label, i) => <div className="tire" data-pressure-alert={tireAlerts[i] || undefined} key={label}><span>{label}</span><b className="num">{value(current.tires[i])}</b><small>kPa</small></div>)}</div>
      <div className="tiny muted">冷胎胎压 · {tireRange.min}–{tireRange.max} kPa</div>
    </Section>
    <Section title="车门与车窗">
      <Row icon="lock" title="车门锁" right={c.locked === null ? '—' : c.locked ? '已锁' : '未锁'} onClick={c.lock} disabled={!!c.reason('lock')} />
      <Row icon={c.trunk ? 'tailgateOpen' : 'tailgate'} title="后备箱" right={c.trunk === null ? '—' : c.trunk ? '已开' : '已关'} onClick={c.toggleTrunk} disabled={block} />
      <Row icon={c.window.icon} title="车窗" right={c.windowPosition === 'unknown' ? '—' : c.window.status} onClick={() => c.setSheet('windows')} disabled={block} />
      <Row icon={c.shadeOpen ? 'roofShadeOpen' : 'roofShade'} title="遮阳帘" right={c.shadeOpen === null ? '—' : c.shadeOpen ? '已开' : '已关'} onClick={c.shade} disabled={block} />
    </Section>
    <Section title="空调与舒适">
      <Row icon="fan" title="空调" right={c.climateOn === null ? '—' : c.climateOn ? '开' : '关'} to="/climate" />
      {c.climate.seat >= 0 && <Row icon="seat" title="主驾座椅加热" right={c.climate.seat || '关'} disabled={block} onClick={() => c.setSheet('seat')} />}
      {c.climate.vent >= 0 && <Row icon="wind" title="主驾座椅通风" right={c.climate.vent || '关'} disabled={block} onClick={() => c.setSheet('seat')} />}
      <CabinHeatingRows />
    </Section>
    <Section title="充电">
      <Row icon="bolt" title="充电上限" right={simulated ? s.limit + '%' : '—'} to="/charging" />
      <Row icon="battery" title="健康充电" right={simulated ? s.health ? '开' : '关' : current.healthCharging === null ? '—' : current.healthCharging ? '开' : '关'} to="/charging" />
      <Row icon="clock" title="预约充电" right={simulated ? s.schedule ? '开' : '关' : undefined} to="/charging" />
    </Section>
    <Section title="更多">
      {current.powertrain === 'reev' && <Row icon="fuel" title="燃油续航" right={value(current.fuelRange) + ' km'} />}
      <Row icon="find" title="鸣笛寻车" sub="闪灯 + 鸣笛" onClick={c.find} disabled={block} />
      <Row icon="shield" title="哨兵模式" right="按车辆与账号权限" disabled />
      <Row icon="file" title="OTA 升级" right="按车辆" disabled />
    </Section>
    {tires && <Tires close={() => showTires(false)} />}
  </div></>;
}

const modes = [['cool', '制冷'], ['heat', '制热'], ['vent', '通风'], ['def', '除霜']] as const;
const speeds = [1, 2, 3, 4, 5].map(i => [i, i] as const);
const levels = [[0, '关'], [1, 1], [2, 2], [3, 3]] as const;
export function ClimatePage() {
  const model = useModelContext();
  const c = useVehicleControls();
  const settings = c.climate;
  const [draft, setDraft] = useState<Partial<typeof settings>>({});
  const values = { ...settings, ...draft };
  const blocked = !!c.reason('climate');
  const dirty = Object.keys(draft).length > 0;
  function edit<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    const next = { ...draft, [key]: value };
    if (settings[key] === value) delete next[key];
    setDraft(next);
  }
  return <><AppBar title="空调" back="/home" /><div className="page no-nav climate-page">
    <ControlNotice />
    <Section className="climate-main">
      <div className="climate-status"><span>车内 <b className="num">{value(model.current.inside, 1)}℃</b></span>
        <button className={'climate-power' + (c.climateOn ? ' on' : '')} aria-label="空调电源" aria-pressed={c.climateOn === true} disabled={blocked} onClick={c.toggleClimate}><Icon name="fan" size={17} />
          {c.climateOn === null ? '状态未知' : c.climateOn ? '已开启' : '已关闭'}</button></div>
      <div className="climate-stepper">
        <button className="round-btn" aria-label="降低目标温度" disabled={values.temp <= 16 || blocked} onClick={() => edit('temp', values.temp - 1)}><Icon name="minus" size={21} /></button>
        <div><div className="climate-target num">{value(dirty ? values.temp : c.targetTemp, 1)}<span>℃</span></div><div className="muted">{dirty || c.targetTemp !== null ? '目标温度' : '目标温度未上报'} {dirty && <span className="pill pending">待发送</span>}</div></div>
        <button className="round-btn" aria-label="提高目标温度" disabled={values.temp >= 30 || blocked} onClick={() => edit('temp', values.temp + 1)}><Icon name="plus" size={21} /></button>
      </div>
      <div className="climate-row"><span>模式</span><Seg label="模式" current={values.mode} options={modes} choose={v => edit('mode', v)} disabled={blocked} /></div>
      <div className="climate-row"><span>风量</span><Seg label="风量" current={values.fan} options={speeds} choose={v => edit('fan', v)} disabled={blocked} /></div>
    </Section>
    {(settings.seat >= 0 || settings.vent >= 0) && <Section className="climate-seats"><h2>主驾座椅</h2>
      {settings.seat >= 0 && <div className="climate-row"><span>加热</span><Seg label="加热" current={values.seat} options={levels} choose={v => model.simulated ? edit('seat', v) : c.seat('seat', v)} disabled={blocked} /></div>}
      {settings.vent >= 0 && <div className="climate-row"><span>通风</span><Seg label="通风" current={values.vent} options={levels} choose={v => model.simulated ? edit('vent', v) : c.seat('vent', v)} disabled={blocked} /></div>}
    </Section>}
    {c.hasCabinHeating && <Section><CabinHeatingRows /></Section>}
    <button className="climate-presets" disabled={blocked} onClick={() => c.setSheet('presets')}><Icon name="spark" size={18} /><span>空调预设</span>{settings.preset && <span className="muted">{settings.preset}</span>}<Icon name="chevron" size={15} /></button>
    <button className="btn accent" disabled={!dirty || blocked} onClick={() => c.sendClimate(draft, [values.temp + '℃', modes.find(m => m[0] === values.mode)?.[1], '风量 ' + values.fan + ' 档'].join(' · '), () => setDraft({}))}>发送空调设置</button>
  </div></>;
}

export function ChargingPage() {
  const model = useModelContext();
  const { current, simulated } = model;
  const c = useVehicleControls();
  const s = c.settings;
  const blocked = !!c.reason('charge');
  const [limit, setLimit] = useState<number | null>(null);
  const [draftSchedule, setSchedule] = useState<{ schedule?: boolean; start?: string; end?: string; days?: number[] }>({});
  const chargingConfig = useChargingConfig();
  const plan = chargingConfig.data;
  const storedLimit = simulated ? s.limit : plan?.percent ?? null;
  const shownLimit = limit ?? storedLimit;
  const health = simulated ? s.health : model.canSee('control') ? current.healthCharging : null;
  const scheduled = simulated ? s.schedule : plan?.enabled ?? null;
  const saved = { schedule: scheduled, start: simulated ? s.start : plan?.beginTime ?? '',
    end: simulated ? s.end : plan?.endTime ?? '', days: simulated ? s.days : plan?.days ?? null };
  const schedule = { ...saved, ...draftSchedule };
  const scheduleDisabled = blocked || scheduled === null || storedLimit === null;
  const scheduleChanged = schedule.schedule !== scheduled || schedule.start !== saved.start || schedule.end !== saved.end ||
    schedule.days?.join(',') !== saved.days?.join(',');
  const scheduleDescription = [schedule.start + '–' + schedule.end, schedule.days && repeatLabel(schedule.days)].filter(Boolean).join(' · ');
  function confirmLimit() {
    if (limit !== null && storedLimit !== null && limit !== storedLimit && !blocked) c.charging({ limit }, '将充电上限设为 ' + limit + '%');
    setLimit(null);
  }
  const radius = 62, circumference = 2 * Math.PI * radius;
  const chargeState = current.charging;
  const title = chargeState === 'unplugged' ? '未连接充电枪' : chargeState === 'plugged' ? '等待充电' : chargeLabels[chargeState];
  return <><AppBar title="充电" back="/home" /><div className="page no-nav charging-settings">
    <ControlNotice />
    <div className="card charging-status"><div className="between"><div><b>{title}</b>
      {current.power !== null && chargeState === 'charging' && <div className="tiny muted">{value(current.power, 1)} kW</div>}</div>
      {chargeState === 'unplugged' && <span className="pill">待机</span>}
      {chargeState === 'plugged' && <span className="pill warn">已插枪</span>}</div>
      <div className="ring"><svg viewBox="0 0 142 142"><circle cx="71" cy="71" r={radius} fill="none" stroke="var(--card-2)" strokeWidth="9" />
        <circle cx="71" cy="71" r={radius} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, current.soc ?? 0)) / 100)} /></svg>
        <div className="center"><b className="num">{value(current.soc)}{current.soc !== null && '%'}</b><span>当前电量</span></div></div>
      <div className="tiny muted">纯电续航 {value(current.electricRange)} km</div></div>
    <Section title="充电上限">
      <div className="charge-limit"><input className="slide" type="range" min="50" max="100" step="5" value={shownLimit ?? 50}
        aria-label="充电上限" aria-valuetext={shownLimit === null ? '未知' : shownLimit + '%'} disabled={blocked || storedLimit === null} onChange={e => setLimit(e.target.valueAsNumber)}
        onPointerUp={confirmLimit} onKeyUp={confirmLimit} /><span className="num">{shownLimit === null ? '—' : shownLimit + '%'}</span></div>
      <div className="cRow"><span className="cIC"><Icon name="battery" size={18} /></span><span className="cL">健康充电</span>{health === null ? <span className="muted">—</span> :
        <Switch checked={health} label="健康充电" disabled={blocked} action={() => c.charging({ health: !health }, health ? '关闭健康充电' : '开启健康充电')} />}</div>
    </Section>
    <Section>
      <div className="cRow"><span className="cIC"><Icon name="clock" size={18} /></span><span className="cL">预约充电</span>{scheduled === null ? <span className="muted">—</span> :
        <Switch checked={schedule.schedule === true} label="预约充电" disabled={scheduleDisabled}
          action={() => setSchedule({ ...draftSchedule, schedule: !schedule.schedule })} />}</div>
      {schedule.schedule && <>
        <div className="schedule-grid"><label>开始<input type="time" value={schedule.start} disabled={scheduleDisabled} onChange={e => setSchedule({ ...draftSchedule, start: e.target.value })} /></label>
          <label>结束<input type="time" value={schedule.end} disabled={scheduleDisabled} onChange={e => setSchedule({ ...draftSchedule, end: e.target.value })} /></label></div>
        <WeekdaySelector days={schedule.days} label="充电重复日期" disabled={scheduleDisabled} change={days => setSchedule({ ...draftSchedule, days })} />
      </>}
      {(schedule.schedule || scheduleChanged) && <button className="btn secondary sm" disabled={!scheduleChanged || scheduleDisabled ||
        !!schedule.schedule && (!schedule.start || !schedule.end || schedule.days === null)}
        onClick={() => c.charging(schedule.schedule ? draftSchedule : { schedule: false }, schedule.schedule ? '保存预约充电' : '关闭预约充电',
          schedule.schedule ? scheduleDescription : undefined, () => setSchedule({}))}>保存预约</button>}
    </Section>
    <BatteryPreheat />
  </div></>;
}
export function DrivingLock() {
  return <><AppBar title="行车中无法控车" back="/home" /><div className="page no-nav">
    <Hint kind="warn" icon="alert">当前车辆处于行驶状态。请安全停车、挂入 P 挡并刷新车况。</Hint>
    <Section title="安全限制"><p>行驶期间，解锁、上锁、后备箱、车窗、空调、充电与寻车等远程操作暂停。</p></Section>
  </div></>;
}
