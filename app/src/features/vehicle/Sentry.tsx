import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { focusManager } from '@tanstack/react-query';
import { readSetting, saveSetting } from '../../data/localDatabase';
import { permitsCommand } from '../../data/cloud/preparation';
import { needsParkingSentry } from '../../data/cloud/remote';
import { Section, Switch } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useModelContext } from '../context';
import { useVehicleControls } from './controls';

function useSentryPreference() {
  const m = useModelContext();
  const key = 'always-sentry:' + m.profileScope + ':' + m.vehicle?.vin;
  const enabled = useSyncExternalStore(subscribe, () => readSetting<boolean>(key, false) === true);
  const owner = !!m.vehicle && m.canSee('control') && !m.expired &&
    (m.simulated ? !m.vehicle.shared : !!m.client && !!m.vehicle.boundOwner && permitsCommand(m.vehicle, 400));
  function setEnabled(value: boolean) {
    saveSetting(key, value);
    window.dispatchEvent(new Event('sentry-preference'));
  }
  return { key, enabled, owner, setEnabled };
}
function subscribe(change: () => void) {
  window.addEventListener('sentry-preference', change);
  window.addEventListener('storage', change);
  return () => { window.removeEventListener('sentry-preference', change); window.removeEventListener('storage', change); };
}

export function SentryCheck({ allowedScreen }: { allowedScreen: boolean }) {
  const m = useModelContext();
  const c = useVehicleControls();
  const { key, owner, enabled } = useSentryPreference();
  const latest = useRef({ m, c, allowedScreen });
  const [request, setRequest] = useState<{ valid: () => boolean; report?: number } | null>(null);
  const wake = useRef<() => void>();
  latest.current = { m, c, allowedScreen };
  useEffect(() => {
    if (!owner || !enabled) return;
    let generation = 0;
    let used = false;
    async function check(turn: number) {
      const valid = () => generation === turn && latest.current.allowedScreen && !document.hidden && focusManager.isFocused() && readSetting<boolean>(key, false) === true;
      if (!valid() || latest.current.c.command) return;
      const { m, c } = latest.current;
      if (m.simulated) {
        if (!c.settings.sentry && m.scenario === 'normal' && !c.reason('sentry')) setRequest({ valid });
        return;
      }
      // Share the regular foreground fetch and evaluate the actual vehicle report.
      const state = await m.readVehicleReport().catch(() => undefined);
      if (valid() && state?.vehicleId === m.vehicleId && needsParkingSentry(state)) {
        setRequest({ valid, report: state.reportedAt! });
      }
    }
    const visibility = () => {
      const visible = !document.hidden && focusManager.isFocused();
      if (!visible) {
        ++generation; used = false;
        const { c } = latest.current;
        if (c.command?.stillRequested && !c.step && !c.verifying) c.close();
      } else if (!used && latest.current.allowedScreen) {
        used = true;
        const turn = ++generation;
        queueMicrotask(() => { void check(turn); });
      }
    };
    wake.current = visibility;
    visibility();
    const unsubscribe = focusManager.subscribe(visibility);
    document.addEventListener('visibilitychange', visibility);
    return () => { ++generation; wake.current = undefined; unsubscribe(); document.removeEventListener('visibilitychange', visibility); };
  }, [key, owner, enabled]);
  useEffect(() => { wake.current?.(); }, [allowedScreen]);
  useEffect(() => {
    if (!request) return;
    if (request.valid() && !c.command) {
      // Query observers can publish the new report one render after refetch resolves.
      if (request.report && (m.current.reportedAt ?? 0) < request.report) return;
      const off = m.simulated ? !c.settings.sentry : m.current.sentry === false;
      if (off && !c.reason('sentry')) c.toggleSentry(true, request.valid);
    }
    setRequest(null);
  }, [request, m, c]);
  return null;
}

export function SentryCard() {
  const m = useModelContext();
  const c = useVehicleControls();
  const { enabled, owner, setEnabled } = useSentryPreference();
  const sentry = m.simulated ? c.settings.sentry : m.current.sentry;
  const alwaysOn = enabled && owner;
  const checked = alwaysOn || sentry === true;
  const disabled = !owner || sentry == null || !!c.reason('sentry');
  const unknown = sentry == null || m.scenario === 'offline' || m.scenario === 'stale';
  const status = alwaysOn && (unknown ? '车况待确认' : !sentry ? '本次驻车未开启' : '');
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  function changeSentry() {
    if (alwaysOn && sentry === false) {
      setEnabled(false);
      return;
    }
    c.toggleSentry(!checked, undefined, alwaysOn ? () => setEnabled(false) : undefined);
  }
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent | FocusEvent) => { if (!area.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <Section className="sentry-card"><div className={'sentry-row' + (disabled ? ' unavailable' : '')}>
    <span className="control-icon"><Icon name="shield" size={22} /></span><strong>哨兵模式</strong>
    <div className="sentry-anchor" ref={area}>
      <button className="sentry-info" ref={trigger} aria-label="哨兵模式使用条件" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(!open)}><Icon name="info" size={16} /></button>
      {open && <div className="preset-bubble sentry-bubble" id={id} role="group" aria-label="哨兵设置">
        <div className="sentry-option"><strong>一直启动哨兵模式</strong><Switch checked={alwaysOn} label="一直启动哨兵模式" disabled={!owner} action={() => setEnabled(!enabled)} /></div>
        <p>仅当前车辆的主账号可用。车辆开关只对当次驻车有效。</p>
        <p>开启时会立即检查，以后每次打开 App 或回到前台也会检查。车辆已挂 P 挡且哨兵关闭时，App 会按你的控车验证设置开启。</p>
        {sentry == null && owner && <p>暂未收到车辆的哨兵状态。</p>}
      </div>}
    </div>
    {status && <span className="sentry-status" role="status">{status}</span>}
    <Switch checked={checked} label="哨兵模式" disabled={disabled} action={changeSentry} />
  </div></Section>;
}
