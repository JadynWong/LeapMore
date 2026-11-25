import { useState, useSyncExternalStore } from 'react';
import md5 from 'blueimp-md5';
import { readSetting, saveSetting } from '../../data/localDatabase';
import { readFailure } from '../../data/readDiagnostics';
import { checkNames, probeHost, runtimeFacts, timedCheck, type CheckName, type CheckResult } from '../../platform/diagnostics';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { diagnosticCsv, diagnosticFamily, diagnosticRuns, diagnosticSteps, diagnosticYear, modelFinding, subscribeDiagnostics } from '../../data/modelDiagnostics';
import { saveRecordsCsv } from '../../platform/settings';
import { Hint, Section, stamp } from '../../ui/components';
import { useVehicleVisual, VehicleModel } from '../appearance/VehicleModel';
import { useModelContext } from '../context';

const powertrainReasons = {
  manual: '车主手动指定', model: '车型名称已标明动力类型', 'fuel-range': '燃油续航大于零',
  'combined-range': '同一工况下综合续航大于纯电续航', remembered: '本车此前已识别为增程',
  'no-fuel-range-evidence': '尚无燃油贡献续航的记录',
};
const rangeSources = { live: '表显续航', ev: '纯电续航', total: '综合续航', combined: '电续航与燃油续航之和', missing: '车端尚未提供有效续航' };

function DiagnosticViewer() {
  const visual = useVehicleVisual(false, true, true);
  return <div className="diagnostic-preview"><VehicleModel visual={visual} /></div>;
}

type NetworkReport = { at: string; environment: Record<string, string>; checks: Record<CheckName, CheckResult> };
const iso = (at: number | undefined) => at ? new Date(at).toISOString() : 'unknown';

export function Diagnostics() {
  const m = useModelContext();
  const [search, setSearch] = useSearchParams();
  const qc = useQueryClient();
  const runs = useSyncExternalStore(subscribeDiagnostics, () => diagnosticRuns(m.cloudKey));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const storageKey = 'networkDiagnostic.' + md5(JSON.stringify([m.profileScope, m.cloudKey]));
  const [networkReport, setNetworkReport] = useState(() => readSetting<NetworkReport | null>(storageKey, null));
  const [testing, setTesting] = useState(false);
  const canCheck = !!m.client && !!m.vehicle && !m.expired;
  const checking = canCheck && search.get('check') === '3d';
  async function checkNetwork() {
    if (testing) return;
    setTesting(true);
    setNotice('');
    const at = new Date().toISOString();
    const skip = (result: string): CheckResult => ({ result, at, durationMs: 0 });
    const reason = m.mode !== 'cloud' ? '跳过 · 未使用零跑账号登录' : m.expired ? '跳过 · 会话失效' : !m.client ? '跳过 · 账号未就绪' : '';
    try {
      const [environment, account, listHost, carHost, list, state] = await Promise.all([
        runtimeFacts(), probeHost('account'), probeHost('listHost'), probeHost('carHost'),
        reason ? skip(reason) : timedCheck(m.cloudDiagnostics.readList),
        reason || !m.vehicle ? skip(reason || '跳过 · 未选择车辆') : timedCheck(m.cloudDiagnostics.readState),
      ]);
      const report = { at, environment, checks: { account, listHost, carHost, list, state } };
      setNetworkReport(report);
      try { saveSetting(storageKey, report); } catch { /* Keep the report exportable in memory. */ }
    } catch { setNotice('检测中断，可重试或导出已有记录。'); }
    finally { setTesting(false); }
  }
  async function start() {
    setNotice('');
    await qc.resetQueries({ queryKey: ['cloud', '3d', m.cloudKey], exact: true });
    setSearch({ check: '3d' }, { replace: true });
  }
  async function save() {
    if (saving) return;
    setSaving(true);
    setNotice('');
    try {
      const captured = new Date();
      const report = diagnosticCsv({
        schema: '2', exportedAt: captured.toISOString(), ...await runtimeFacts(),
        mode: m.mode ?? 'signed-out', session: m.mode !== 'cloud' ? 'not-applicable' : m.expired ? 'expired' : m.client ? 'active' : 'unavailable',
        networkCheckAt: networkReport?.at ?? 'not-run',
        ...(networkReport ? { checkedEnvironment: JSON.stringify(networkReport.environment),
          ...Object.fromEntries(Object.entries(networkReport.checks).map(([key, value]) => ['check.' + key, JSON.stringify(value)])) } : {}),
        ...(m.mode === 'cloud' ? { vehicleSelected: String(!!m.vehicle), selectedRole: m.vehicle ? m.vehicle.shared ? 'shared' : 'owner' : 'none',
          vehicleCount: String(m.vehicles.length), vehicleListQuery: m.cloudDiagnostics.listStatus,
          vehicleListLastSuccess: iso(m.cloudDiagnostics.listLastSuccess), vehicleStateQuery: m.cloudDiagnostics.stateStatus,
          vehicleStateLastSuccess: iso(m.cloudDiagnostics.stateLastSuccess), vehicleReportedAt: iso(m.current.reportedAt),
          lastListFailure: JSON.stringify(m.cloudDiagnostics.listFailure()), lastStateFailure: JSON.stringify(m.cloudDiagnostics.stateFailure()) } : {}),
        lastSmsFailure: JSON.stringify(readFailure(m.profileScope, 'sms')), lastLoginFailure: JSON.stringify(readFailure(m.profileScope, 'login')),
        family: m.mode === 'cloud' ? diagnosticFamily(m.vehicle?.carType) ?? diagnosticFamily(m.vehicle?.model) ?? 'unknown' : 'not-applicable',
        year: m.mode === 'cloud' ? String(diagnosticYear(m.vehicle?.year) ?? 'unknown') : 'not-applicable', vehicleData: m.mode === 'cloud' ? m.cloudDiagnostics.stateStatus : 'not-applicable',
        ...(m.mode === 'cloud' && m.vehicle ? {
          powertrain: m.powertrainInfo.type, powertrainPreference: m.powertrainInfo.preference,
          powertrainReason: m.powertrainInfo.reason, currentRangeEvidence: m.powertrainInfo.evidence ?? 'none',
          rangeSource: m.rangeSource, displayedRangeKm: String(m.current.range ?? 'unknown'),
          rangeReadingsKm: JSON.stringify(m.rangeReadings ?? null),
          climateTargetC: String(m.current.climateTemp ?? 'unknown'),
        } : {}),
        ha: m.ha.expired ? 'expired' : m.ha.error ? 'error' : m.ha.connected ? 'connected' : 'disconnected',
      }, runs);
      const name = 'leapmore-diagnostics-' + captured.toISOString().replace(/[^0-9]/g, '').slice(0, 17) + '.csv';
      setNotice(await saveRecordsCsv(name, report) ? '诊断报告已导出。' : '已取消导出。');
    } catch { setNotice('无法保存诊断报告，请重新选择保存位置。'); }
    finally { setSaving(false); }
  }
  const explanation = m.expired ? '会话已失效。仍可导出已有记录，重新登录后可检测车模。' :
    m.mode === 'ha' ? '当前使用 HA 登录。检测零跑云车模需要登录零跑账号并选车。' :
    m.mode === 'demo' ? '演示模式使用样例数据。登录零跑账号并选车后可检测本车。' :
    '请选择一辆已授权车辆。';
  return <><Section title="网络与车辆诊断">
    <p className="small">检测账号服务、车辆列表和车况服务的连接。登录零跑账号后，还会实际读取授权车辆列表和所选车辆的车况。</p>
    <button className="btn secondary sm" disabled={testing} onClick={() => void checkNetwork()}>{testing ? '正在检测网络与车辆…' : '检测网络与车辆'}</button>
    {networkReport && <div aria-live="polite"><p className="small">上次检测 · {stamp(Date.parse(networkReport.at))}</p>
      <p className="tiny muted">{networkReport.environment.os} · LeapMore {networkReport.environment.version}
        {networkReport.environment.webViewVersion && ' · WebView ' + networkReport.environment.webViewVersion}</p>
      {(Object.keys(checkNames) as CheckName[]).map(key => <p key={key} className="small">{checkNames[key]} · {networkReport.checks[key].result}
        {networkReport.checks[key].httpStatus && '（HTTP ' + networkReport.checks[key].httpStatus + '）'}</p>)}
      <p className="tiny muted">连接检测仅确认服务是否返回 HTTP 响应。授权和车况结果分别列在最后两项。</p>
    </div>}
  </Section>{m.mode === 'cloud' && m.vehicle && <Section title="动力类型与续航诊断">
    <p className="small">当前按{m.powertrainInfo.type === 'reev' ? '增程' : '纯电'}显示。{powertrainReasons[m.powertrainInfo.reason]}。</p>
    <p className="small">{rangeSources[m.rangeSource]}{m.current.range !== null && ' · ' + m.current.range + ' km'}</p>
    <Link className="link" to="/vehicle-manage">管理本车动力类型</Link>
  </Section>}<Section title="3D 车模诊断">
    {checking && <DiagnosticViewer />}
    <p className="small" role="status">{runs[0] ? modelFinding(runs[0]) : '尚无本车的加载记录。'}</p>
    {runs.map(run => <details key={run.id} className="diagnostic-run">
      <summary>{stamp(run.at)} · {modelFinding(run)}</summary>
      <ol>{run.events.map((event, index) => <li key={index}>
        <span>{diagnosticSteps[event.step]}</span> <small>+{((event.at - run.at) / 1000).toFixed(1)} 秒</small>
        {event.facts?.modelType !== undefined && <small> · modelType {event.facts.modelType}</small>}
        {event.facts?.format && <small> · {event.facts.format.toUpperCase()} · {event.facts.bytes} 字节</small>}
        {event.facts?.c01Compat && <small> · 已应用 C01 兼容修复</small>}
      </li>)}</ol>
    </details>)}
    {canCheck ? checking ? <Link className="btn secondary sm" to="/states" replace>结束检测</Link> :
      <button className="btn secondary sm" onClick={() => void start()}>检测本车 3D 车模</button> : <Hint>{explanation}</Hint>}
    <p className="tiny muted">报告包含系统、应用和浏览器内核版本、网络检测结果、车辆读取记录及最近三次车模加载过程。账号、车架号、位置、Wi-Fi 名称和素材密钥均已排除。</p>
    <button className="btn accent" disabled={saving || testing} onClick={() => void save()}>{saving ? '正在导出…' : '导出诊断报告（CSV）'}</button>
    {notice && <p role="status" className="small">{notice}</p>}
  </Section></>;
}
