import { Picker } from '../../ui/Picker';
import { useEffect, useRef, useState } from 'react';
import { climatePresets, findClimatePreset } from '../../data/cloud/climatePresets';
import { permitsFeature } from '../../data/cloud/preparation';
import type { PreparationPreset } from '../../data/cloud/preparation';
import type { Vehicle } from '../../data/types';
import type { Favorite } from '../../data/preferences';
import { useModelContext } from '../context';
import { Icon } from '../../ui/Icon';
import { Row, Seg, Sheet, Switch } from '../../ui/components';
import { AmapKeySheet, useAmapKey } from './AmapKey';
import { useAmapSuggestions } from './amapServices';
import { resolveDestination } from './navigationDestination';

export const initialPresets: PreparationPreset[] = [
  { id: 'commute', name: '日常通勤', destination: null, climate: true, temperature: 24, fan: 2, seat: 'none', steering: false, mirrors: false },
  { id: 'summer', name: '夏日出行', destination: null, climate: true, temperature: 20, fan: 4, seat: 'none', steering: false, mirrors: false },
];
type SavedPresets = { presets: PreparationPreset[]; selected: string; defaultsVersion?: number };

export function loadPreparationPresets(stored: SavedPresets | null, vehicle?: Vehicle) {
  const saved = stored ?? { presets: initialPresets, selected: initialPresets[0].id };
  if (saved.defaultsVersion === 2 || saved.presets.some(p => p.id === 'winter' || p.name === '冬日温暖')) {
    return { ...saved, defaultsVersion: 2 };
  }
  const winter: PreparationPreset = { ...initialPresets[0], id: 'winter', name: '冬日温暖', temperature: 26, fan: 3,
    seat: vehicle?.source === 'fixture' || vehicle?.abilities?.includes('301') ? 'heat' : 'none' };
  return { ...saved, defaultsVersion: 2, presets: [...saved.presets, winter] };
}

export function presetSummary(p: PreparationPreset) {
  return [p.destination?.name, p.climate && (findClimatePreset(p.climatePreset)?.[0] ?? '空调 ' + p.temperature + '℃ · 风量 ' + p.fan + ' 档'),
    p.seat !== 'none' && ('主驾座椅' + (p.seat === 'heat' ? '加热' : '通风')), p.steering && '方向盘加热', p.mirrors && '后视镜加热'].filter(Boolean).join('、');
}

function DestinationPicker({ choose, close }: { choose: (dest: NonNullable<PreparationPreset['destination']>) => void; close: () => void }) {
  const m = useModelContext();
  const [text, setText] = useState('');
  const [config, setConfig] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  const { key } = useAmapKey();
  const { places, failed } = useAmapSuggestions(text, m.current.location);
  async function pick(fav: Favorite) {
    if (!fav.point && !key) { setConfig(true); return; }
    controller.current?.abort();
    const job = new AbortController();
    controller.current = job;
    setLoading(true); setMessage('');
    try {
      const dest = await resolveDestination(fav, key, m.vehicle?.abilities, job.signal);
      if (!job.signal.aborted) choose(dest);
    } catch { if (!job.signal.aborted) setMessage('无法解析地址，请核对地址和高德 Key。'); }
    finally { if (!job.signal.aborted) setLoading(false); }
  }
  return <Sheet title="选择导航目的地" close={close} showClose>
    <label className="field"><Icon name="locate" size={16} /><input aria-label="搜索目的地" placeholder="输入目的地名称或地址" value={text} onChange={e => setText(e.target.value)} /></label>
    {(text.trim() ? places : m.favorites).map((fav, i) => <Row key={i} icon="map" title={fav.name} sub={fav.address} disabled={loading} onClick={() => void pick(fav)} />)}
    {text.trim() && key && <Row icon="locate" title="使用输入的地址" sub={text.trim()} disabled={loading} onClick={() => void pick({ name: text.trim(), address: text.trim() })} />}
    {!key && <button className="link" onClick={() => setConfig(true)}>配置高德 Key 以搜索地点</button>}
    {(message || failed || loading) && <p className="tiny muted" role="status">{message || (loading ? '正在解析地址…' : '地点搜索失败，请检查高德 Key。')}</p>}
    {config && <AmapKeySheet close={() => setConfig(false)} />}
  </Sheet>;
}

export function PresetEditor({ initial, save, remove, close }: {
  initial: PreparationPreset; save: (preset: PreparationPreset) => void; remove?: () => void; close: () => void;
}) {
  const m = useModelContext();
  const [draft, setDraft] = useState(initial);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const patch = (update: Partial<PreparationPreset>) => setDraft(previous => ({ ...previous, ...update }));
  const supports = (id: number) => !!m.vehicle && permitsFeature(m.vehicle, id);
  const canLocation = m.canSee('location') && supports(180);
  const selected = findClimatePreset(draft.climatePreset);
  return <Sheet title={remove ? '编辑备车预设' : '新建备车预设'} close={close} showClose className="prep-editor">
    <div className="prep-edit-body">
      <label className="prep-field">预设名称<input aria-label="预设名称" placeholder="为这套备车设置命名" maxLength={20} value={draft.name} onChange={e => patch({ name: e.target.value })} /></label>
      <div className="prep-group">
        <Row icon="locate" title="导航目的地" right={draft.destination?.name || '选择地点'} disabled={!canLocation} onClick={() => setPicking(true)} />
        {draft.destination && <button className="link prep-remove-dest" onClick={() => patch({ destination: null })}>移除目的地</button>}
      </div>
      <div className="prep-group">
        <div className="cRow"><Icon name="climateFan" size={18} /><strong className="cL">空调</strong>
          <Switch checked={draft.climate} label="预设空调" disabled={!supports(170) && !supports(171) && !draft.climate} action={() => patch({ climate: !draft.climate })} /></div>
        {draft.climate && <>
          <div className="prep-climate-grid" role="group" aria-label="备车空调预设">{climatePresets.map(([name, icon, settings]) =>
            <button className="prep-climate-choice" key={settings.mode} aria-pressed={selected?.[2].mode === settings.mode}
              onClick={() => patch({ climatePreset: settings.mode })}><Icon name={icon} size={17} />{name}</button>)}</div>
          <button className="prep-custom" aria-expanded={!selected} onClick={() => patch({ climatePreset: undefined })}>
            <Icon name="climatePresets" size={16} />自定义温度与风量<Icon name={selected ? 'chevron' : 'check'} size={15} /></button>
          {!selected && <div className="schedule-grid"><label>目标温度<Picker aria-label="目标温度" value={draft.temperature} onValue={v => patch({ temperature: +v })}>
            {Array.from({ length: 17 }, (_, i) => i + 16).map(n => <option key={n} value={n}>{n} ℃</option>)}</Picker></label>
            <label>风量<Picker aria-label="风量" value={draft.fan} onValue={v => patch({ fan: +v })}>
              {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n} 档</option>)}</Picker></label></div>}
        </>}
      </div>
      <div className="prep-group">
        <div className="cRow"><Icon name="seatComfort" size={18} /><span className="cL">主驾座椅</span>
          <Seg label="预设座椅" current={draft.seat} disabled={!supports(301) && draft.seat === 'none'} options={[[ 'none', '跳过'], ['heat', '加热'], ['vent', '通风']]} choose={seat => patch({ seat })} /></div>
        {([['steering', '方向盘加热', 'steering', 320], ['mirrors', '后视镜加热', 'defrost', 440]] as const).map(([field, title, icon, id]) =>
          <div className="cRow" key={field}><Icon name={icon} size={18} /><span className="cL">{title}</span>
            <Switch checked={draft[field]} label={title} disabled={!supports(id) && !draft[field]} action={() => patch({ [field]: !draft[field] })} /></div>)}
      </div>
    </div>
    <footer className="prep-actions">{remove && <button className="link" onClick={() => setDeleting(true)}>删除预设</button>}
      <button className="btn accent" disabled={!draft.name.trim() || !presetSummary(draft)} onClick={() => save({ ...draft, name: draft.name.trim() })}>保存预设</button></footer>
    {deleting && <Sheet title="删除这个预设？" sub="已保存的预约会继续使用各自的配置。" close={() => setDeleting(false)} showClose>
      <button className="btn danger" onClick={remove}>确认删除预设</button></Sheet>}
    {picking && <DestinationPicker close={() => setPicking(false)} choose={destination => { patch({ destination }); setPicking(false); }} />}
  </Sheet>;
}
