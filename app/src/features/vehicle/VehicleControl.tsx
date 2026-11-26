import { useEffect, useState } from 'react';
import { proximityFeatures } from './vehicleBluetooth';
import { readSetting, saveSetting } from '../../data/localDatabase';
import { allowsPreparationContent, preparationContent } from '../../data/cloud/preparation';
import type { PreparationPreset } from '../../data/cloud/preparation';
import { Icon } from '../../ui/Icon';
import { AppBar, Row, Section, Sheet } from '../../ui/components';
import { useModelContext } from '../context';
import { ControlNotice } from './commands';
import { useVehicleControls } from './controls';
import { initialPresets, PresetEditor, presetSummary, loadPreparationPresets } from './PreparationPresets';
import { PreparationSchedules } from './PreparationSchedules';

export function VehicleControl() {
  const m = useModelContext();
  const scope = m.profileScope + ':' + m.vehicleId;
  return <><AppBar title="车辆控制" back="/home" />
    <ControlPanel key={scope} scope={scope} /></>;
}

function ControlPanel({ scope }: { scope: string }) {
  const m = useModelContext();
  const cmd = useVehicleControls();
  const construction = () => m.setToast('正在施工');
  const [manager, showManager] = useState(false);
  const storageKey = 'preparation-presets:' + scope;
  const [saved, setSaved] = useState(() => loadPreparationPresets(readSetting(storageKey, null), m.vehicle));
  useEffect(() => { saveSetting(storageKey, saved); window.dispatchEvent(new Event('quick-controls-changed')); }, [storageKey, saved]);
  const [editor, setEditor] = useState<PreparationPreset>();
  const [schedules, showSchedules] = useState(false);
  const preset = saved.presets.find(p => p.id === saved.selected) ?? saved.presets[0];
  const canEdit = m.canSee('control') && (m.simulated || !!m.client);
  const content = preset && m.vehicle ? preparationContent(preset, m.vehicle) : {};
  const prepareBlock = cmd.reason('prepare');
  const scheduleBlock = cmd.reason('prepareSchedule');
  const canPrepare = !!m.vehicle && allowsPreparationContent(m.vehicle, content, false, m.canSee('location'));
  function newPreset() {
    setEditor({ ...initialPresets[0], id: Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('-'), name: '' });
  }
  function savePreset(updated: PreparationPreset) {
    setSaved(prev => ({ ...prev, presets: prev.presets.some(p => p.id === updated.id)
      ? prev.presets.map(p => p.id === updated.id ? updated : p) : [...prev.presets, updated], selected: updated.id }));
    setEditor(undefined);
    showManager(false);
  }
  return <div className="page no-nav vehicle-controls">
    <ControlNotice />
    <Section><button type="button" className="sentry-row construction-sentry" aria-label="哨兵模式" aria-disabled="true" onClick={construction}>
      <span className="control-icon"><Icon name="shield" size={22} /></span><strong>哨兵模式</strong>
      <span className="switch" aria-hidden="true" /></button></Section>
    <Section title="蓝牙控制"><div className="proximity-controls" role="group" aria-label="蓝牙控制">{proximityFeatures.map(([id, title, icon]) =>
      <button key={id} type="button" aria-disabled="true" onClick={construction}><Icon name={icon} size={23} /><span>{title}</span></button>)}</div>
    </Section>
    <Section className="prepare-card" title={<>一键备车<button className="link more" disabled={!canEdit} onClick={() => showManager(true)}><Icon name="climatePresets" size={16} />管理预设</button></>}>
      {preset && <div className="prepare-selection"><div className="prepare-options" aria-label="备车预设" role="group">{saved.presets.map(p =>
        <button key={p.id} aria-pressed={p.id === preset.id} onClick={() => setSaved({ ...saved, selected: p.id })}>{p.name}</button>)}</div></div>}
      {preset && !canPrepare && canEdit && <p className="control-help">当前车辆或账号不支持预设中的部分操作。</p>}
      {prepareBlock && !cmd.reason('climate') && <p className="control-help">{prepareBlock[0]}</p>}
      <button className="btn accent" disabled={!preset || !canPrepare || !!prepareBlock}
        onClick={() => cmd.ask({ kind: 'prepare', title: '立即备车', icon: 'spark', description: preset.name + ' · ' + presetSummary(preset),
          remote: { kind: 'prepare', content }, apply: () => cmd.applyPreparation(preset) })}><Icon name="spark" size={18} />立即备车</button>
    </Section>
    <Section className="schedule-entry"><Row icon="clock" title="预约备车" sub={scheduleBlock?.[0]} disabled={!!scheduleBlock} onClick={() => showSchedules(true)} /></Section>
    {manager && !editor && <Sheet title="管理备车预设" close={() => showManager(false)} showClose>
      {saved.presets.map(p => <Row key={p.id} icon="spark" label={'编辑' + p.name} title={p.name} right={<Icon name="edit" size={15} />} onClick={() => setEditor(p)} />)}
      <button className="btn accent prep-add" onClick={newPreset}><Icon name="plus" size={17} />新建预设</button>
    </Sheet>}
    {editor && <PresetEditor initial={editor} save={savePreset} close={() => setEditor(undefined)} remove={saved.presets.some(p => p.id === editor.id) ? () => {
      setSaved(prev => { const presets = prev.presets.filter(p => p.id !== editor.id); return { ...prev, presets, selected: prev.selected === editor.id ? presets[0]?.id ?? '' : prev.selected }; });
      setEditor(undefined);
    } : undefined} />}
    {schedules && <PreparationSchedules presets={saved.presets} selected={preset?.id} close={() => showSchedules(false)} />}
  </div>;
}
