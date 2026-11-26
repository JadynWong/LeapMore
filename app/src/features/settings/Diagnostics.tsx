import { useState, useSyncExternalStore } from 'react';
import md5 from 'blueimp-md5';
import { readSetting, saveSetting } from '../../data/localDatabase';
import { RecordingDiagnostics, readRecordingReport, recordingReportFields } from './RecordingDiagnostics';
import { hasBackgroundRecorder } from '../../platform/recorder';
import { failureLabels, loginStages } from '../../data/serviceFailure';
import { readFailure } from '../../data/readDiagnostics';
import { checkNames, probeHost, runtimeFacts, timedCheck, type CheckName, type CheckResult } from '../../platform/diagnostics';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { diagnosticCsv, diagnosticText, diagnosticFamily, diagnosticRuns, diagnosticSteps, diagnosticYear, modelFinding, subscribeDiagnostics } from '../../data/modelDiagnostics';
import { saveTextFile } from '../../platform/settings';
import { Section, stamp } from '../../ui/components';
import { Icon, type IconName } from '../../ui/Icon';
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

function DiagnosticHeading({ icon, title }: { icon: IconName; title: string }) {
  return <h2 className="diagnostic-heading"><span><Icon name={icon} size={19} /></span>{title}</h2>;
}

type NetworkReport = { at: string; environment: Record<string, string>; checks: Record<CheckName, CheckResult> };
const iso = (at: number | undefined) => at ? new Date(at).toISOString() : 'unknown';

export function Diagnostics() {
  const m = useModelContext();
  const recording = m.mode === 'cloud' && !!m.cloudKey && hasBackgroundRecorder();
  const eligible = m.usesPhone && !m.expired && m.grants.mileage;
  const loginFailure = [readFailure(m.profileScope, 'sms'), readFailure(m.profileScope, 'login')]
    .filter(f => f != null).sort((a, b) => b.at.localeCompare(a.at))[0];
  const [search, setSearch] = useSearchParams();
  const qc = useQueryClient();
  const runs = useSyncExternalStore(subscribeDiagnostics, () => diagnosticRuns(m.cloudKey));
  const [saving, setSaving] = useState<'csv' | 'txt'>();
  const [notice, setNotice] = useState('');
  const storageKey = 'networkDiagnostic.' + md5(JSON.stringify([m.profileScope, m.cloudKey]));
  const [networkReport, setNetworkReport] = useState(() => readSetting<NetworkReport | null>(storageKey, null));
  const [testing, setTesting] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const [showResults, setShowResults] = useState(false);
  const canCheck = !!m.client && !!m.vehicle && !m.expired;
  const checking = canCheck && search.get('check') === '3d';
  async function checkNetwork() {
    if (testing) return;
    setTesting(true);
    setNetworkError('');
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
      setShowResults(true);
      try { saveSetting(storageKey, report); } catch { /* Keep the report exportable in memory. */ }
    } catch { setNetworkError('检测中断，可重试或导出已有记录。'); }
    finally { setTesting(false); }
  }
  async function start() {
    setNotice('');
    await qc.resetQueries({ queryKey: ['cloud', '3d', m.cloudKey], exact: true });
    setSearch({ check: '3d' }, { replace: true });
  }
  async function save(format: 'csv' | 'txt') {
    if (saving) return;
    setSaving(format);
    setNotice('');
    try {
      const captured = new Date();
      const serialize = format === 'txt' ? diagnosticText : diagnosticCsv;
      const report = serialize({
        schema: '3', exportedAt: captured.toISOString(), ...await runtimeFacts(),
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
        ...(recording ? { 'recording.source': m.source, 'recording.phoneEligible': String(eligible),
          'recording.mileageGranted': String(m.grants.mileage), ...recordingReportFields(await readRecordingReport(m.cloudKey)) } : {}),
        ha: m.ha.expired ? 'expired' : m.ha.error ? 'error' : m.ha.connected ? 'connected' : 'disconnected',
      }, runs);
      const name = 'leapmore-diagnostics-' + captured.toISOString().replace(/[^0-9]/g, '').slice(0, 17) + '.' + format;
      setNotice(await saveTextFile(name, report) ? '诊断报告已导出。' : '已取消导出。');
    } catch { setNotice('无法保存诊断报告，请重新选择保存位置。'); }
    finally { setSaving(undefined); }
  }
  const explanation = m.expired ? '重新登录后可检测本车车模。' :
    m.mode === 'cloud' ? '选择已授权车辆后可检测本车车模。' : '登录零跑账号并选车后可检测本车车模。';
  return <>
    <Section className="diagnostic-card">
      <DiagnosticHeading icon="wifi" title="网络与车辆诊断" />
      <p>检查零跑服务连接。登录后可同时检测车辆授权和车况读取。</p>
      <button className="btn accent sm" disabled={testing} onClick={() => void checkNetwork()}>{testing ? '正在检测网络与车辆…' : '检测网络与车辆'}</button>
      {loginFailure && <p>最近失败 · {stamp(Date.parse(loginFailure.at))} · {loginFailure.stage ? loginStages[loginFailure.stage] : '账号请求'}
        {' · ' + failureLabels[loginFailure.kind]}{loginFailure.nativeCode ? '（鸿蒙 ' + loginFailure.nativeCode + '）' : ''}</p>}
      {networkError && <p role="status">{networkError}</p>}
      {networkReport && <details className="diagnostic-results" open={showResults} onToggle={e => setShowResults(e.currentTarget.open)}>
        <summary>检测结果<time dateTime={networkReport.at}>{stamp(Date.parse(networkReport.at))}</time><Icon name="chevrond" size={15} /></summary>
        <dl>{(Object.keys(checkNames) as CheckName[]).map(key => <div key={key}>
          <dt>{checkNames[key]}</dt><dd>{networkReport.checks[key].result}
            {networkReport.checks[key].nativeCode ? '（鸿蒙 ' + networkReport.checks[key].nativeCode + '）' : ''}
            {networkReport.checks[key].httpStatus && '（HTTP ' + networkReport.checks[key].httpStatus + '）'}</dd>
        </div>)}</dl>
        <p className="tiny muted">{networkReport.environment.os} · LeapMore {networkReport.environment.version}
          {networkReport.environment.webViewVersion && ' · WebView ' + networkReport.environment.webViewVersion}</p>
      </details>}
    </Section>
    {recording && <RecordingDiagnostics scope={m.cloudKey} eligible={eligible} />}
    <Section className="diagnostic-card">
      <DiagnosticHeading icon="car" title="3D 车模诊断" />
      {checking && <DiagnosticViewer />}
      {canCheck && !runs.length && <p>检测本车素材获取和模型加载过程。</p>}
      {!canCheck && <p>{explanation}</p>}
      {canCheck && (checking ? <Link className="btn ghost sm" to="/states" replace>结束检测</Link> :
        <button className="btn ghost sm" onClick={() => void start()}>检测本车 3D 车模</button>)}
      {runs.map(run => <details key={run.id} className="diagnostic-run">
        <summary>{stamp(run.at)} · {modelFinding(run)}</summary>
        <ol>{run.events.map((event, index) => <li key={index}>
          <span>{diagnosticSteps[event.step]}</span> <small>+{((event.at - run.at) / 1000).toFixed(1)} 秒</small>
          {event.facts?.modelType !== undefined && <small> · modelType {event.facts.modelType}</small>}
          {event.facts?.format && <small> · {event.facts.format.toUpperCase()} · {event.facts.bytes} 字节</small>}
          {event.facts?.c01Compat && <small> · 已应用 C01 兼容修复</small>}
        </li>)}</ol>
      </details>)}
    </Section>
    <Section className="diagnostic-card">
      <DiagnosticHeading icon="file" title="诊断报告" />
      <p>包含设备版本、网络检测、车辆读取{recording ? "、后台采样" : ""}和最近三次车模加载记录。已排除账号、车架号、位置、Wi-Fi 名称和素材密钥。</p>
      <p>分享前请留意报告中的时间和车况信息。</p>
      <div className="diagnostic-exports">{(['txt', 'csv'] as const).map(format =>
        <button key={format} className="btn ghost sm" aria-label={'导出诊断报告（' + format.toUpperCase() + '）'} disabled={!!saving || testing} onClick={() => void save(format)}>
          <Icon name="download" size={16} />{saving === format ? '正在导出…' : '导出 ' + format.toUpperCase()}
        </button>)}</div>
      {notice && <p role="status">{notice}</p>}
    </Section>
    {m.mode === 'cloud' && m.vehicle && <details className="card diagnostic-fold">
      <summary>动力类型与续航<Icon name="chevrond" size={16} /></summary>
      <div className="diagnostic-fold-body">
        <p>当前按{m.powertrainInfo.type === 'reev' ? '增程' : '纯电'}显示。{powertrainReasons[m.powertrainInfo.reason]}。</p>
        <p>{rangeSources[m.rangeSource]}{m.current.range !== null && ' · ' + m.current.range + ' km'}</p>
        <Link className="link" to="/vehicle-manage">管理本车动力类型</Link>
      </div>
    </details>}
  </>;
}
