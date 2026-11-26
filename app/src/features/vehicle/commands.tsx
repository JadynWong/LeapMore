import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useModelContext } from '../context';
import { Hint, Sheet, SheetButtons } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/Icon';
import { CloudSessionExpired } from '../../data/cloud/LiveClient';
import { matchesRemoteState, OperationPinRejected, RemoteCommandError } from '../../data/cloud/remote';
import type { RemoteCommand } from '../../data/cloud/remote';
import { confirmsPreparation, permitsCommand, preparationKey } from '../../data/cloud/preparation';
import { allowsPreheat, preheatSchedulesKey, samePreheatPlan } from '../../data/cloud/preheat';
import { biometricAvailabilityKey, defaultOperationAuth, forgetOperationPin, operationAuth, operationAuthKey, readOperationPin, rememberOperationPin, validOperationPin } from '../../platform/operationAuth';
import type { OperationMode } from '../../platform/operationAuth';
import { biometricsAvailable } from '../../platform/secure';

export type Command = { kind: RemoteCommand['kind']; title: string; description?: string; icon: IconName;
  stillRequested?: () => boolean; remote?: RemoteCommand; apply?: () => void; onComplete?: () => void };
const status = {
  sending: '正在发送', accepted: '云端已受理', waiting: '等待车辆确认',
  confirmed: '操作成功 · 车端已确认', saved: '云端充电计划已更新', preheatSaved: '云端预热预约已更新', preparationSaved: '预约备车已更新',
  unconfirmed: '车辆未确认', failed: '指令发送失败',
} as const;
type Step = keyof typeof status;
type AuthMethod = 'password' | 'saved' | 'biometrics';

function vehicleFeedback(ack: Promise<'confirmed' | 'failed' | 'pending'>, observed: Promise<boolean>) {
  return new Promise<'confirmed' | 'failed' | 'pending' | 'observed'>(resolve => {
    void ack.then(result => { if (result !== 'pending') resolve(result); });
    void observed.then(matched => { if (matched) resolve('observed'); });
    void Promise.all([ack, observed]).then(() => resolve('pending'));
  });
}

function useCommandModel(onClose?: () => void) {
  const model = useModelContext();
  const qc = useQueryClient();
  const scope = model.operationScope;
  const widgetLink = useMatch('/widget-action');
  const quickLink = useMatch('/quick-action');
  const auth = useQuery({ queryKey: operationAuthKey(scope), enabled: !!scope, queryFn: () => operationAuth(scope), staleTime: Infinity });
  const biometrics = useQuery({ queryKey: biometricAvailabilityKey, enabled: !!scope, queryFn: biometricsAvailable, staleTime: 0 });
  const latest = useRef(model);
  latest.current = model;
  const [command, setCommand] = useState<Command | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [message, setMessage] = useState('');
  const [pin, setPin] = useState('');
  const [manual, setManual] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [authNote, setAuthNote] = useState('');
  const { mode, saved: savedPin, biometric: savedBioPin } = auth.data ?? defaultOperationAuth;
  const useSaved = mode !== 'verify' && savedPin && !manual;
  const useBiometrics = mode === 'verify' && savedBioPin && !!biometrics.data && !manual;
  const [checking, setChecking] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const operation = useRef<AbortController | null>(null);
  const vehicle = model.vehicle?.id;
  const session = useRef({ scope, vehicle, mode: model.mode });
  const sameVehicle = () => latest.current.operationScope === scope && latest.current.vehicle?.id === vehicle && latest.current.mode === model.mode;
  const clear = () => {
    operation.current?.abort();
    operation.current = null;
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);
  useLayoutEffect(() => {
    const before = session.current;
    if (before.scope === scope && before.vehicle === vehicle && before.mode === model.mode) return;
    session.current = { scope, vehicle, mode: model.mode };
    clear(); setCommand(null); setStep(null); setPin(''); setChecking(false); setVerifying(false);
  }, [scope, vehicle, model.mode]);

  function reason(kind: Command['kind']) {
    const m = latest.current;
    if (m.expired) return ['会话已失效', '/login', '重新登录'] as const;
    if (!m.vehicle) return ['没有已授权的车辆', '/vehicle-access', '查看车辆授权'] as const;
    if (m.scenario === 'offline') return [m.simulated ? '网络不可用，显示缓存车况' : m.stateFailure + (m.current.at ? '，显示上次车况' : '，暂无车况'), '/states', '查看诊断'] as const;
    if (m.current.driving) return ['行驶中，停车挂 P 后可控车', '/driving-lock', '查看原因'] as const;
    if (kind !== 'lock' && !m.canSee('control')) return ['车辆控制未授权', '/vehicle-access', '查看车辆授权'] as const;
    if (kind === 'sentry' && (!m.simulated && (!m.vehicle.boundOwner || !permitsCommand(m.vehicle, 400)))) return ['仅主账号可使用哨兵模式', '/vehicle-access', '查看车辆授权'] as const;
    if ((kind === 'prepare' || kind === 'prepareSchedule') && !permitsCommand(m.vehicle, kind === 'prepare' ? 360 : 361)) return ['备车功能未授权', '/vehicle-access', '查看车辆授权'] as const;
    if (kind === 'preheat' && !allowsPreheat(m.vehicle)) return ['电池预热预约未授权', '/vehicle-access', '查看车辆授权'] as const;
    if (kind === 'navigation' && !m.canSee('location')) return ['车辆定位未授权', '/vehicle-access', '查看车辆授权'] as const;
    if (!m.simulated && !m.client) return ['当前车况为只读接入', '/states', '查看状态'] as const;
    return null;
  }
  async function ask(next: Command) {
    if (operation.current || !sameVehicle() || next.stillRequested && (command || !next.stillRequested())) return;
    const blocked = reason(next.kind);
    if (blocked) { latest.current.setToast(blocked[0]); return; }
    if (!latest.current.simulated && !next.remote) return;
    clear();
    setPin('');
    setManual(false);
    setAuthNote('');
    setMessage('');
    setChecking(false);
    setStep(null);
    if (latest.current.simulated || !scope) { setCommand(next); return; }

    const controller = new AbortController();
    operation.current = controller;
    // Another app window may have changed this vehicle's preference since it was opened.
    const prefs = await qc.fetchQuery({ queryKey: operationAuthKey(scope), queryFn: () => operationAuth(scope),
      staleTime: 0, retry: false, networkMode: 'always' }).catch(() => null);
    if (controller.signal.aborted || !sameVehicle()) return;
    if (next.stillRequested && !next.stillRequested()) { close(); return; }
    setCommand(next);
    // Public widget URLs open a review sheet. Opening a URL alone is not a control-button tap.
    if (!widgetLink && !quickLink && prefs?.mode === 'instant' && prefs.saved) {
      setStep('sending');
      await authorizeSend(next, controller, 'saved', prefs.mode);
    } else {
      if (!prefs) setManual(true);
      operation.current = null;
    }
  }
  function close() { clear(); setPin(''); setStep(null); setCommand(null); setVerifying(false); onClose?.(); }
  const after = (delay: number, action: () => void) => timers.current.push(setTimeout(action, delay));
  function complete(next: Command, step: 'confirmed' | 'saved' | 'preheatSaved' | 'preparationSaved') {
    next.onComplete?.();
    setStep(step);
    after(880, close);
  }
  async function sendLive(next: Command, password: string, saved: boolean, authMode: OperationMode, signal: AbortSignal) {
    const m = latest.current;
    const remote = next.remote!;
    let submitted = false;
    let accepted = false;
    const submit = async (force: boolean) => {
      const client = await m.controlClient(force);
      signal.throwIfAborted();
      const receipt = await client.sendCommand(m.vehicleId, remote, password, signal, () => {
        if (next.stillRequested && !next.stillRequested()) throw new RemoteCommandError('本次哨兵检查已结束。');
        submitted = true;
      },
        !saved ? async () => {
          try {
            const prefs = await rememberOperationPin(scope, authMode, password);
            if (!signal.aborted) qc.setQueryData(operationAuthKey(scope), prefs);
          } catch { if (!signal.aborted) m.setToast('本机未能保存操作密码。'); }
        } : undefined);
      return { client, receipt };
    };
    try {
      const { client, receipt } = await submit(false).catch(error => {
        if (!submitted && error instanceof CloudSessionExpired) return submit(true);
        throw error;
      });
      signal.throwIfAborted();
      accepted = true;
      setStep('accepted');
      after(650, () => setStep(current => current === 'accepted' ? 'waiting' : current));
      const deadline = Date.now() + 25_000;
      const wait = (delay = 1_600) => new Promise<void>((resolve) => {
        const finish = () => { signal.removeEventListener('abort', finish); clearTimeout(timer); resolve(); };
        const timer = setTimeout(finish, delay);
        signal.addEventListener('abort', finish, { once: true });
      });
      if (receipt.preheatTarget || receipt.preparationTarget) {
        const preparation = receipt.preparationTarget;
        const key = preparation ? preparationKey(m.cloudKey) : preheatSchedulesKey(m.cloudKey);
        const readBack = async () => {
          if (preparation) {
            const plans = await client.getPreparationSchedules(m.vehicleId, 6_000);
            signal.throwIfAborted();
            qc.setQueryData(key, plans);
            return confirmsPreparation(plans, preparation);
          }
          const plans = await client.getPreheatSchedules(m.vehicleId, 6_000);
          signal.throwIfAborted();
          qc.setQueryData(key, plans);
          const target = receipt.preheatTarget!;
          return plans.some(plan => plan.id === target.id && samePreheatPlan(plan, target));
        };
        for (const delay of [1_600, 4_000, 8_000]) {
          await wait(delay);
          signal.throwIfAborted();
          const [result, matched] = await Promise.all([client.queryCommand(receipt).catch(() => 'pending'), readBack().catch(() => false)]);
          signal.throwIfAborted();
          if (result === 'failed') throw new RemoteCommandError('车辆未能保存预约。');
          if (matched) { complete(next, preparation ? 'preparationSaved' : 'preheatSaved'); return; }
        }
        void qc.invalidateQueries({ queryKey: key });
        setMessage('云端已受理，暂未读到一致的预约。');
        setStep('unconfirmed');
        return;
      }
      let delay = 650;
      do {
        await wait(delay);
        delay = 1_600;
        signal.throwIfAborted();
        const ack = client.queryCommand(receipt).catch(() => 'pending' as const);
        if (receipt.planPatch) {
          const [result, configured] = await Promise.all([ack, client.confirmChargePlan(m.vehicleId, receipt.planPatch, receipt.plan).catch(() => false)]);
          signal.throwIfAborted();
          if (result === 'failed') throw new RemoteCommandError('车辆未能执行本次操作。');
          if (configured || result === 'confirmed') {
            m.refreshChargePlan();
            complete(next, configured ? 'saved' : 'confirmed');
            return;
          }
          continue;
        }
        const observed = client.getState(m.vehicleId, 5_000).then(frame => {
          if (signal.aborted) return false;
          m.showControlState(frame);
          const reported = frame.reportedAt ?? 0;
          return reported > (receipt.before.reportedAt ?? 0) && reported >= receipt.sentAt - 5_000 &&
            !matchesRemoteState(remote, receipt.before) && matchesRemoteState(remote, frame);
        }).catch(() => false);
        const result = await vehicleFeedback(ack, observed);
        signal.throwIfAborted();
        if (result === 'failed') throw new RemoteCommandError('车辆未能执行本次操作。');
        if (result !== 'pending') {
          if (result === 'confirmed') m.showConfirmedControl(remote, receipt.before, receipt.sentAt);
          complete(next, 'confirmed');
          return;
        }
      } while (Date.now() < deadline);
      if (receipt.planPatch) m.refreshChargePlan();
      setMessage('云端已受理，车辆暂未确认。');
      setStep('unconfirmed');
    } catch (error) {
      if (signal.aborted) return;
      if (saved && error instanceof OperationPinRejected) {
        try {
          const prefs = await forgetOperationPin(scope);
          if (!signal.aborted) qc.setQueryData(operationAuthKey(scope), prefs);
        } catch {
          if (!signal.aborted) qc.setQueryData(operationAuthKey(scope), { mode: authMode, saved: false, biometric: false });
        }
        if (signal.aborted) return;
      }
      if (error instanceof CloudSessionExpired) m.expireCloud();
      if (remote.kind === 'prepareSchedule') void qc.invalidateQueries({ queryKey: preparationKey(m.cloudKey) });
      if (remote.kind === 'preheat') void qc.invalidateQueries({ queryKey: preheatSchedulesKey(m.cloudKey) });
      const known = error instanceof RemoteCommandError || error instanceof CloudSessionExpired;
      if (submitted && !accepted && !known) {
        setMessage('连接中断，无法确认零跑是否收到操作。请先查询车况。');
        setStep('unconfirmed');
      } else {
        setMessage(saved && error instanceof OperationPinRejected ? '已保存的操作密码失效，请重新输入。' : known ? error.message : '连接零跑失败，请稍后再试。');
        setStep('failed');
      }
    }
  }
  async function authorizeSend(next: Command, controller: AbortController, method: AuthMethod, authMode: OperationMode) {
    const { signal } = controller;
    setAuthNote('');
    setVerifying(method !== 'password');
    let password: string | null = pin;
    try {
      if (method !== 'password') password = await readOperationPin(scope, method);
    } catch {
      if (!signal.aborted && method !== 'biometrics') setAuthNote('无法读取本机密码，请重新输入。');
      password = null;
    }
    if (signal.aborted || !sameVehicle()) return;
    setVerifying(false);
    if (!password || !validOperationPin(password)) {
      if (method === 'biometrics') setAuthNote('生物识别未通过，可使用操作密码。');
      else setManual(true);
      setStep(null);
      operation.current = null;
      return;
    }
    const blocked = reason(next.kind);
    if (blocked) { setMessage(blocked[0]); setStep('failed'); return; }
    setStep('sending');
    setPin('');
    await sendLive(next, password, method !== 'password', authMode, signal);
  }
  function send(method: AuthMethod = useSaved ? 'saved' : 'password') {
    if (!command || step || operation.current) return;
    if (command.stillRequested && !command.stillRequested()) { close(); return; }
    const blocked = reason(command.kind);
    if (blocked) { setMessage(blocked[0]); setStep('failed'); return; }
    const simulation = latest.current.simulated;
    if (!simulation && (!command.remote || auth.isLoading || method === 'biometrics' && !useBiometrics || method === 'password' && !validOperationPin(pin))) return;
    const controller = new AbortController();
    operation.current = controller;
    if (!simulation) {
      void authorizeSend(command, controller, method, mode);
      return;
    }
    setStep('sending');
    const confirm = () => {
      if (command.stillRequested && !command.stillRequested()) { close(); return; }
      if (latest.current.scenario === 'pending' || reason(command.kind)) { setStep('unconfirmed'); return; }
      command.apply?.();
      complete(command, command.kind === 'prepareSchedule' ? 'preparationSaved' : command.kind === 'preheat' ? 'preheatSaved' : 'confirmed');
    };
    after(450, () => {
      setStep('accepted');
      after(530, () => { setStep('waiting'); after(1070, confirm); });
    });
  }
  async function check() {
    setChecking(true);
    const m = latest.current;
    const signal = operation.current?.signal;
    try {
      if (m.client && !m.simulated) {
        const client = await m.controlClient();
        if (command?.kind === 'prepareSchedule') {
          const plans = await client.getPreparationSchedules(m.vehicleId);
          if (signal?.aborted) return;
          qc.setQueryData(preparationKey(m.cloudKey), plans);
          m.setToast('已重新读取预约备车');
          close();
          return;
        }
        if (command?.kind === 'preheat') {
          const plans = await client.getPreheatSchedules(m.vehicleId);
          if (signal?.aborted) return;
          qc.setQueryData(preheatSchedulesKey(m.cloudKey), plans);
          m.setToast('已重新读取预热预约');
          close();
          return;
        }
        const state = await client.getState(m.vehicleId);
        if (signal?.aborted) return;
        m.showControlState(state);
        m.refreshChargePlan();
      } else {
        await m.refresh();
        if (signal?.aborted || m.scenario === 'pending' || m.scenario === 'offline') return;
      }
      m.setToast('已刷新车况，请核对车辆状态');
      close();
    } catch {
      if (!signal?.aborted) setMessage(command?.kind === 'preheat' ? '暂时无法读取电池预热预约，请稍后再查。' : '暂时无法读取车辆状态，请稍后再查。');
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  }

  return { ask, reason, command, step, send, close, check, checking, pin, setPin, message,
    useSaved, useBiometrics, showPassword: () => { setManual(true); setAuthNote(''); }, authNote, verifying,
    loadingAuth: auth.isLoading || mode === 'verify' && savedBioPin && biometrics.isLoading,
    confirmDisabled: auth.isLoading || verifying || !useSaved && !validOperationPin(pin),
    saveOnVerify: mode !== 'verify' && !savedPin || mode === 'verify' && !!biometrics.data && !savedBioPin };
}

const Context = createContext<ReturnType<typeof useCommandModel> | null>(null);
export function CommandProvider({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const run = useCommandModel(onClose);
  const model = useModelContext();
  const { command: c, step, send, close } = run;
  return <Context.Provider value={run}>{children}{c && (step ?
    <Sheet title={c.title} className="cmd-sheet" decorated={false} state={step === 'saved' || step === 'preheatSaved' || step === 'preparationSaved' ? 'confirmed' : step} close={step === 'unconfirmed' || step === 'failed' ? close : undefined}>
      <div className="cmd-circle" aria-hidden="true"><span className="cmd-track" /><span className="cmd-spin" />
        <span className="cmd-symbol cmd-source"><Icon name={c.icon} size={26} /></span><span className="cmd-symbol cmd-check"><Icon name="check" size={32} /></span>
        <span className="cmd-symbol cmd-alert"><Icon name="alert" size={27} /></span><span className="cmd-symbol cmd-error"><Icon name="x" size={30} /></span>
      </div><h2>{c.title}</h2><p className="cmd-status" role="status">{run.message || status[step]}</p>
      {step === 'unconfirmed' || step === 'failed' ? <div className="confirm-btns"><button className="btn ghost" onClick={close}>关闭</button>
        {step === 'unconfirmed' && <button className="btn accent" onClick={() => void run.check()} disabled={run.checking}>{c.kind === 'preheat' || c.kind === 'prepareSchedule' ? '查询预约' : '查询车况'}</button>}</div> : null}
    </Sheet> :
    <Sheet title={'确认' + c.title + '？'} close={close} decorated={false} className="confirm-sheet">
      <div className="grabber" /><div className="confirm-head"><div className="confirm-ic"><Icon name={c.icon} size={22} /></div>
        <div><h2>确认{c.title}？</h2><div className="sub">{model.name} · {model.simulated ? '模拟控车' : '零跑远程控车'}</div></div>
        {!model.simulated && run.useBiometrics && <button type="button" className="link command-password-entry" disabled={run.verifying}
          onClick={run.showPassword}>输入密码</button>}</div>
      {c.kind === 'trunk' && <div className="trunk-preview" aria-hidden="true"><Icon name={c.icon} size={98} /></div>}
      {c.description && <p className="confirm-desc">{c.description}</p>}
      {!model.simulated && <>
        {run.loadingAuth ? <p className="confirm-desc">读取本机控车设置…</p> :
          run.useBiometrics ? null : run.useSaved ? <p className="confirm-desc">使用本机保存的操作密码。</p> :
            <><div className="field command-pin"><input type="password" inputMode="numeric" autoComplete="off"
              maxLength={6} aria-label="零跑操作密码" placeholder="输入零跑操作密码" value={run.pin}
              onChange={e => run.setPin(e.target.value.replace(/\D/g, ''))} /></div>
              {run.saveOnVerify && <p className="confirm-desc">验证通过后加密保存到本机。</p>}</>}
        {run.authNote && <p className="confirm-desc" role="status">{run.authNote}</p>}
      </>}
      {!model.simulated && run.useBiometrics ? <div className="confirm-btns">
        <button type="button" className="btn ghost" onClick={close}>取消</button>
        <button type="button" className="btn accent" disabled={run.verifying} onClick={() => send('biometrics')}>
          <Icon name="fingerprint" size={17} />{run.verifying ? '验证中…' : '指纹或面容解锁'}
        </button>
      </div> : <SheetButtons cancel={close} action={() => send()} label={run.verifying ? '验证中…' : '确认发送'}
        disabled={!model.simulated && (run.loadingAuth || run.confirmDisabled)} />}
    </Sheet>)}</Context.Provider>;
}
export function useCommands() { return useContext(Context)!; }
export function ControlNotice() {
  const { reason } = useCommands();
  const blocked = reason('climate');
  return blocked ? <Hint kind="warn" icon="alert"><span>{blocked[0]}</span> <Link className="link" to={blocked[1]}>{blocked[2]}</Link></Hint> : null;
}
