import { useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useSetting } from '../../data/preferences';
import { AppBar, Section, Seg, Switch } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useModelContext } from '../context';
import { proximityFeatures } from './vehicleBluetooth';

export function ProximityPage() {
  const m = useModelContext();
  const { feature } = useParams();
  const entry = proximityFeatures.find(([id]) => id === feature);
  if (!entry || !m.simulated || m.expired || !m.vehicle?.vin || !m.canSee('control')) return <Navigate to="/control" replace />;
  return <><AppBar title={entry[1]} back="/control" action={<span className="ble-status connected"><Icon name="bluetooth" size={14} />演示蓝牙已连接</span>} />
    <div className="page no-nav near-page">{feature === 'remote' ? <Handset /> : feature === 'straight' ? <Straight /> : <Parking />}</div></>;
}

const levels = [[0, '关'], [1, '1'], [2, '2'], [3, '3']] as const;
const tracks = ['海岸公路', '夜间电台', '晨间漫游'];
function Handset() {
  const m = useModelContext();
  const [tab, show] = useState('home');
  const [seat, selectSeat] = useState<'driver' | 'passenger'>('driver');
  const [settings, setSettings] = useSetting('demo-handset:' + m.vehicleId, {
    track: 0, playing: false, volume: 35, climate: true, temp: 24, fan: 2, mood: true, color: 0, reading: false,
    driver: { heat: 0, vent: 0 }, passenger: { heat: 0, vent: 0 },
  });
  const change = (value: Partial<typeof settings>) => setSettings(s => ({ ...s, ...value }));
  const colors = [['冰蓝', '#48b3e7'], ['薄荷', '#59bd9f'], ['琥珀', '#e8a34b'], ['暮紫', '#a28bcd']] as const;
  return <>
    <Seg label="遥控器面板" current={tab} choose={show} options={[[ 'home', '首页'], ['seat', '座椅'], ['light', '灯光']]} />
    {tab === 'home' && <>
      <Section title="媒体"><div className="media-deck">
        <span className={'media-disc' + (settings.playing ? ' playing' : '')} aria-hidden="true"><Icon name="music" size={28} /></span>
        <div><strong>{tracks[settings.track]}</strong><span>{settings.playing ? '正在播放' : '已暂停'}</span></div>
        <div className="media-buttons">{([[-1,'上一首','previous'],[0,settings.playing ? '暂停' : '播放',settings.playing ? 'pause' : 'play'],[1,'下一首','next']] as const).map(([delta,label,icon]) =>
          <button key={delta} className="iconbtn" aria-label={label} onClick={() => change(delta ? { track: (settings.track + tracks.length + delta) % tracks.length } : { playing: !settings.playing })}><Icon name={icon} size={19} /></button>)}</div>
      </div><label className="near-range">音量<input type="range" min="0" max="100" value={settings.volume} onChange={e => change({ volume: +e.target.value })} /><output>{settings.volume}%</output></label></Section>
      <Section title={<>空调<Switch label="遥控器空调" checked={settings.climate} action={() => change({ climate: !settings.climate })} /></>}>
        <div className="remote-thermostat"><button className="iconbtn" aria-label="降低温度" disabled={!settings.climate || settings.temp <= 18} onClick={() => change({ temp: settings.temp - 1 })}><Icon name="minus" size={22} /></button>
          <strong>{settings.temp}<small>℃</small></strong><button className="iconbtn" aria-label="提高温度" disabled={!settings.climate || settings.temp >= 32} onClick={() => change({ temp: settings.temp + 1 })}><Icon name="plus" size={22} /></button></div>
        <label className="near-range">风量<input type="range" min="1" max="7" value={settings.fan} disabled={!settings.climate} onChange={e => change({ fan: +e.target.value })} /><output>{settings.fan} 档</output></label>
      </Section></>}
    {tab === 'seat' && <Section title="座椅舒适"><Seg label="选择座椅" current={seat} choose={selectSeat} options={[[ 'driver','主驾'], ['passenger','副驾']]} />
      {(['heat','vent'] as const).map(field => <div className="cRow" key={field}><Icon name={field === 'heat' ? 'seatComfort' : 'wind'} size={19} />
        <span className="cL">{field === 'heat' ? '座椅加热' : '座椅通风'}</span>
        <Seg label={field === 'heat' ? '座椅加热' : '座椅通风'} options={levels} current={settings[seat][field]} choose={n =>
          change({ [seat]: { ...settings[seat], [field]: n, ...(n && { [field === 'heat' ? 'vent' : 'heat']: 0 }) } })} /></div>)}</Section>}
    {tab === 'light' && <>
      <Section title={<>氛围灯<Switch label="氛围灯" checked={settings.mood} action={() => change({ mood: !settings.mood })} /></>}>
        <div className="mood-colors" role="group" aria-label="氛围灯颜色">{colors.map(([name, color], index) => <button key={name} aria-label={name} aria-pressed={settings.color === index} disabled={!settings.mood}
          style={{ backgroundColor: color }} onClick={() => change({ color: index })}>{settings.color === index && <Icon name="check" size={20} />}</button>)}</div>
      </Section><Section><div className="sentry-option"><strong>阅读灯</strong><Switch label="阅读灯" checked={settings.reading} action={() => change({ reading: !settings.reading })} /></div></Section></>}
  </>;
}

// Top-down diagram uses the same coordinates for a bay, its path and the car's position.
function ParkingDiagram({ parking, offset = 0, progress = 0, side = 1, exiting = false }: { parking?: boolean; offset?: number; progress?: number; side?: number; exiting?: boolean }) {
  const startY = exiting ? 95 : 152;
  const endY = exiting ? (side === 0 ? 46 : 152) : 95;
  const distanceX = side * 64;
  const x = parking ? 150 + distanceX * progress * progress : 150;
  const y = parking ? startY + (endY - startY) * progress : 112 - Math.max(-64, Math.min(64, offset * 9));
  const bays = exiting ? [0] : [-1, 1];
  return <svg className="parking-diagram" viewBox="0 0 300 224" aria-hidden="true">
    {parking ? <g className="bay-marks">{bays.map(s => <g key={s} transform={'translate(' + (150 + s * 64) + ' 0)'}>
      <path d="M-27 140V49H27V140"/>{(exiting || side === s) && <rect className="bay-target" x="-24" y="52" width="48" height="85" rx="5"/>}</g>)}
      <path className="diagram-path" d={'M150 ' + startY + ' Q150 ' + (startY + endY) / 2 + ' ' + (150 + distanceX) + ' ' + endY} /></g>
      : <g className="bay-marks"><path d="M95 12V212M205 12V212"/><path className="diagram-path" d="M150 8V216"/></g>}
    <g transform={'translate(' + x + ' ' + y + ')'} className="diagram-car">
      <path d="M-17-28Q-17-38 0-39Q17-38 17-28L18 26Q18 36 12 38Q0 41-12 38Q-18 36-18 26Z"/>
      <path className="car-glass" d="M-14-19Q0-25 14-19L11-9Q0-12-11-9ZM-12 20Q0 23 12 20L13 27Q0 31-13 27Z"/>
      <path className="car-detail" d="M-15-7v24m30-24v24M-15-29l6-3m18 0 6 3M-14 33l6 1m16 0 6-1"/>
    </g>
  </svg>;
}

function useStopOnLeave(stop: () => void) {
  const latest = useRef(stop);
  latest.current = stop;
  useEffect(() => {
    const blur = () => latest.current();
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, []);
}

function Straight() {
  const [travel, setTravel] = useState({ offset: 0, total: 0 });
  const [direction, setDirection] = useState(0);
  const start = useRef({ offset: 0, total: 0, at: 0, sign: 0 });
  function measure() {
    const from = start.current;
    const distance = Math.min(5, 15 - from.total, (performance.now() - from.at) / 1600);
    setTravel({ offset: from.offset + from.sign * distance, total: from.total + distance });
    return distance === 5 || from.total + distance >= 15;
  }
  function stop() {
    if (!start.current.sign) return;
    measure();
    start.current.sign = 0;
    setDirection(0);
  }
  useStopOnLeave(stop);
  useEffect(() => {
    if (!direction) return;
    const interval = window.setInterval(() => {
      if (start.current.sign && measure()) { start.current.sign = 0; setDirection(0); }
    }, 50);
    return () => clearInterval(interval);
  }, [direction]);
  const begin = (sign: number) => {
    if (start.current.sign || travel.total >= 15) return;
    start.current = { ...travel, at: performance.now(), sign };
    setDirection(sign);
  };
  return <><Section className="maneuver-card" title={<>{direction ? (direction > 0 ? '正在前进' : '正在后退') : '车辆已停止'}<span className="maneuver-reading">{travel.total.toFixed(1)} m</span></>}>
    <ParkingDiagram offset={travel.offset} /></Section>
    <div className="hold-controls">{([[1, '长按前进','up'], [-1, '长按后退','down']] as const).map(([sign,label,icon]) =>
      <button key={label} className={'btn ' + (direction === sign ? 'accent' : 'secondary')} disabled={travel.total >= 15 || !!direction && direction !== sign}
        onPointerDown={e => { if (!e.isPrimary || e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); begin(sign); }}
        onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) begin(sign); } }}
        onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') stop(); }} onBlur={stop} onContextMenu={e => e.preventDefault()}>
        <Icon name={icon} size={22} />{label}</button>)}</div>
    {travel.total >= 15 && <button className="btn ghost" onClick={() => setTravel({ offset: 0, total: 0 })}>重新演示</button>}</>;
}

function Parking() {
  const [mode, setMode] = useState<'in'|'out'>('in');
  const [side, setSide] = useState(1);
  const [phase, setPhase] = useState<'ready'|'moving'|'paused'|'done'>('ready');
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(progress);
  useStopOnLeave(() => setPhase(current => current === 'moving' ? 'paused' : current));
  useEffect(() => {
    if (phase !== 'moving') return;
    const from = progressRef.current, start = performance.now();
    const timer = window.setInterval(() => {
      const value = Math.min(1, from + (performance.now() - start) / 9000);
      progressRef.current = value; setProgress(value);
      if (value === 1) setPhase('done');
    }, 80);
    return () => clearInterval(timer);
  }, [phase]);
  const reset = () => { setPhase('ready'); setProgress(0); progressRef.current = 0; };
  const verb = mode === 'in' ? '泊入' : '泊出';
  const ready = phase === 'ready';
  return <><Seg label="泊车方式" current={mode} disabled={!ready} options={[[ 'in','泊入'], ['out','泊出']]} choose={v => { setMode(v); setSide(1); }} />
    <Section className="maneuver-card" title={<>{ready ? (mode === 'in' ? '选择车位' : '选择泊出方向') : phase === 'done' ? verb + '完成' : phase === 'paused' ? '泊车已暂停' : '正在' + verb}
      {!ready && <span className="maneuver-reading">{Math.round(progress * 100)}%</span>}</>}>
      <ParkingDiagram parking progress={progress} side={side} exiting={mode === 'out'} />
      {ready && <Seg label={mode === 'in' ? '车位' : '泊出方向'} current={side} choose={setSide} options={mode === 'in' ? [[-1,'左侧车位'],[1,'右侧车位']] : [[-1,'左侧'],[0,'前方'],[1,'右侧']]} />}
    </Section>
    {phase === 'done' ? <button className="btn accent" onClick={reset}>完成</button> : <>
      <button className={'btn ' + (phase === 'moving' ? 'secondary' : 'accent')} onClick={() => setPhase(phase === 'moving' ? 'paused' : 'moving')}>{ready ? '开始' + verb : phase === 'moving' ? '暂停泊车' : '继续' + verb}</button>
      {phase === 'paused' && <button className="btn ghost" onClick={reset}>结束泊车</button>}</>}
  </>;
}
