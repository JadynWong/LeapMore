import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppBar, Seg, Sheet, asset, hasLocalCarAssets, value } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useModelContext } from '../context';
import { ControlNotice } from './commands';
import { chargeLabels, useVehicleControls } from './controls';
import { widgetBridge } from '../../platform/widgets';
import type { WidgetControlRequest } from '../../platform/widgets';

type WidgetSize = 'small' | 'medium' | 'large';
function useWidgetData() {
  const model = useModelContext();
  const commands = useVehicleControls();
  const current = model.current;
  const modelImage = hasLocalCarAssets && model.vehicle?.model === 'C10' ? 'c10' : hasLocalCarAssets && model.vehicle?.model === 'B10' ? 'b10' : '';
  const range = current.range;
  const state = model.expired ? '会话失效' : model.scenario === 'offline' ? (model.simulated ? '离线' : '车况读取失败') : current.driving ? '行驶中' :
    model.scenario === 'stale' ? '数据过期' : current.driving === false ? '已驻车' : '状态未知';
  const controls = [
    { id: 'lock', icon: commands.locked === false ? 'lock' : 'unlock', label: commands.locked === false ? '上锁' : '解锁', title: commands.lockTitle, invoke: commands.lock, enabled: !commands.reason('lock'), active: commands.locked === false },
    { id: 'climate', icon: 'fan', label: '空调', title: commands.climateTitle, invoke: commands.toggleClimate, enabled: !commands.reason('climate'), active: commands.climateOn },
    { id: 'trunk', icon: commands.trunk ? 'tailgateOpen' : 'tailgate', label: '后备箱', title: commands.trunkTitle, invoke: commands.toggleTrunk, enabled: !commands.reason('trunk'), active: commands.trunk === true },
    { id: 'find', icon: 'find', label: '寻车', title: '鸣笛寻车', invoke: commands.find, enabled: !commands.reason('find'), active: false },
  ] as const;
  return { model, current, commands, controls, range, state, modelImage };
}
const widgetVehicle = (model: ReturnType<typeof useModelContext>) => model.mode === 'cloud' ? model.cloudKey : model.mode + ':' + model.vehicleId;

export function PublishWidget() {
  const { current, range, state, model, commands, controls, modelImage } = useWidgetData();
  const summary = model.vehicle && !model.expired ? {
    vehicle: widgetVehicle(model),
    soc: value(current.soc) + (current.soc !== null ? '%' : ''),
    range: value(range) + ' km', rangeLabel: current.rangeLabel, fuel: current.powertrain === 'reev' ? value(current.fuel) + '%' : '',
    state, charging: chargeLabels[current.charging], chargeStatus: current.charging, power: current.power === null ? '' : value(current.power, 1) + ' kW',
    inside: value(current.inside, 1) + '℃', locked: commands.locked === null ? '锁状态未知' : commands.locked ? '已锁' : '未锁',
    odometer: model.canSee('mileage') ? value(current.odometer) + ' km' : '',
    modelImage, colorScheme: model.colorScheme, climateOn: !!commands.climateOn, trunkOpen: commands.trunk === true,
    lockAction: controls[0].label, climateAction: controls[1].label, trunkAction: controls[2].label, findAction: controls[3].label,
    simulated: model.simulated, canLock: controls[0].enabled, canControl: controls[1].enabled,
  } : null;
  const serialized = JSON.stringify(summary);
  const ready = model.booted && (!summary || model.simulated || model.mode === 'ha' || model.controlStateReady || model.scenario === 'offline');
  useEffect(() => {
    if (!ready) return;
    const next = JSON.parse(serialized) as typeof summary;
    if (next) void widgetBridge.update(next); else void widgetBridge.clear();
  }, [ready, serialized]);
  return null;
}

export function WidgetAction() {
  const { controls, model } = useWidgetData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const kind = params.get('action');
  const intent = controls.find(c => c.id === kind);
  useEffect(() => {
    if (!model.vehicle) return;
    navigate('/home', { replace: true });
    if (intent?.enabled) intent.invoke();
    else if (intent) model.setToast('当前状态无法执行该控车操作。');
  // Each widget intent is handled once when its route opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, model.vehicle?.id]);
  return <p className="loading">正在打开车辆…</p>;
}

export function WidgetControl({ request }: { request: WidgetControlRequest }) {
  const { controls, model, commands } = useWidgetData();
  const intent = controls.find(control => control.id === request.action);
  const waiting = !model.booted || model.mode === 'cloud' && !!model.vehicle && !model.expired &&
    !model.controlStateReady && model.scenario !== 'offline';
  const error = waiting ? '' : model.expired || !model.vehicle ? '请打开 LeapMore 登录并同步车况。' :
    request.vehicle !== widgetVehicle(model) ? '桌面卡片里的车辆已切换，请打开 LeapMore 更新卡片。' :
    !intent?.enabled ? commands.reason(intent?.id ?? 'find')?.[0] ?? '当前状态无法执行该控车操作。' : '';
  const started = useRef(false);
  useEffect(() => {
    if (started.current || waiting || error || !intent) return;
    started.current = true;
    intent.invoke();
  }, [waiting, error, intent]);
  if (started.current || !waiting && !error) return commands.step === 'confirmed' ? <PublishWidget /> : null;
  return <Sheet title="桌面控车" close={widgetBridge.closeControl} showClose>
    <p className="confirm-desc" role="status">{error || '正在读取车况…'}</p>
  </Sheet>;
}

export function WidgetPreview() {
  const [size, setSize] = useState<WidgetSize>('medium');
  const [params] = useSearchParams();
  const { current, range, state, model, commands, controls, modelImage } = useWidgetData();
  const stat = (v: string, unit: string, label: string) => <div className="widget-stat"><strong className="num">{v}<small>{v === '—' && unit === '%' ? '' : unit}</small></strong><span>{label}</span></div>;
  const image = modelImage ? <img className="widget-car" src={asset(modelImage + '.png')} alt="" /> :
    <span className="widget-car"><Icon name="car" size={40} /></span>;
  const charge = <span className="widget-charge-state" data-status={current.charging}><Icon name={current.charging === 'charging' ? 'bolt' : 'plug'} size={12} />{chargeLabels[current.charging]}</span>;
  const meter = (v: number | null, label: string, icon: 'battery' | 'fuel') => <div className={'widget-level ' + icon}>
    <span><Icon name={icon} size={15} />{label}</span><div className="widget-meter"><i style={{ width: (v ?? 0) + '%' }} /></div><b>{value(v)}{v !== null && '%'}</b></div>;
  return <><AppBar title="桌面卡片预览" back={params.get('from') === 'mine' ? '/mine' : '/home'} /><div className="page no-nav widget-page">
    <Seg current={size} options={[[ 'small', '小 · 2×2'], ['medium', '中 · 4×2'], ['large', '大 · 4×4']]} choose={setSize} label="卡片尺寸" />
    <ControlNotice />
    <div className="widget-desktop"><section className={'widget widget-' + size} aria-label="桌面预览">
      <div className="widget-range"><div>{stat(value(range), ' km', current.rangeLabel)}
        {size !== 'small' && <span className="widget-state">{state}</span>}</div>{size !== 'large' && stat(value(current.soc), '%', '电量')}
        {size === 'medium' && <div className="widget-car-status">{image}<div className="widget-charging">{charge}{current.power !== null && <b>{value(current.power, 1)} kW</b>}</div></div>}
        {size === 'large' && image}</div>
      {size === 'large' && <div className="widget-levels">{meter(current.soc, '电量', 'battery')}{current.powertrain === 'reev' && meter(current.fuel, '油量', 'fuel')}</div>}
      {size !== 'medium' && <div className="widget-charging">{charge}{size === 'large' && current.power !== null && <b>{value(current.power, 1)} kW</b>}</div>}
      {size === 'large' && <div className="widget-metrics">{[
        ['车门', commands.locked === null ? '—' : commands.locked ? '已锁' : '未锁'],
        ['车内温度', value(current.inside, 1) + '℃'],
        ...(model.canSee('mileage') ? [['总里程', value(current.odometer) + ' km']] : []),
      ].map(([name, v]) => <div className="widget-metric" key={name}><span>{name}</span><b>{v}</b></div>)}</div>}
      <div className="widget-actions" role="group" aria-label="快捷控车">{(size === 'small' ? controls.slice(0, 2) : controls).map(c =>
        <button key={c.id} className={'widget-action' + (c.active ? ' on' : '')} disabled={!c.enabled} onClick={c.invoke} aria-label={c.title}>
          <Icon name={c.icon} /><span>{c.label}</span></button>)}</div>
    </section><div className="widget-caption">LeapMore</div></div>
  </div></>;
}
