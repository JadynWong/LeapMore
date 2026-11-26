import { useEffect, useState } from 'react';
import { recordingHours, recordingScope, type RecordingHour } from '../../data/recordingDiagnostics';
import { recorder, type RecorderSession } from '../../platform/recorder';
import { nativeSettings } from '../../platform/settings';
import { Icon } from '../../ui/Icon';
import { stamp } from '../../ui/components';

const reasons: Record<string, string> = {
  user: '在 App 中关闭', notification: '从通知关闭', timeout: '系统后台运行时限',
  'scope-change': '车辆、账号或记录条件改变', 'bridge-destroyed': '应用页面容器已销毁',
  'bridge-missing': '与应用页面失去连接', 'service-destroyed': '收到系统服务销毁回调',
  failed: '服务启动失败', stopped: '已停止',
};

export async function readRecordingReport(scope: string) {
  const [service, settings] = await Promise.all([
    recorder.getDiagnostics({ scope: recordingScope(scope) }).catch(() => null),
    nativeSettings.checkBackground().catch(() => null),
  ]);
  const hours = recordingHours(scope);
  const ticks = new Map<number, number>();
  const latest = Math.floor(Date.now() / 3_600_000);
  for (const session of service?.sessions ?? []) {
    for (const bucket of session.hours) {
      const hour = Math.floor(bucket.at / 3_600_000);
      if (hour > latest - 48 && hour <= latest) ticks.set(hour, (ticks.get(hour) ?? 0) + bucket.ticks);
    }
  }
  const timeline = new Map<number, RecordingHour>(hours.map(row => [row.hour, row]));
  for (const hour of ticks.keys()) {
    if (!timeline.has(hour)) timeline.set(hour, { hour, counts: {}, last: {} });
  }
  return { service, settings, hours: [...timeline.values()].sort((a, b) => a.hour - b.hour)
    .map(row => ({ ...row, nativeTicks: ticks.get(row.hour) })) };
}
type Report = Awaited<ReturnType<typeof readRecordingReport>>;
function stateOf(session: RecorderSession, current: boolean) {
  if (session.stoppedAt) return reasons[session.reason ?? ''] ?? '已停止';
  if (current) return '运行中';
  if (session.processExitAt && session.processExitReason !== undefined) {
    const kinds: Record<number, string> = { 2: '进程收到信号', 3: '系统内存不足', 4: '应用崩溃', 5: '原生崩溃',
      6: '应用无响应', 10: '用户请求或系统操作', 16: '应用更新' };
    return stamp(session.processExitAt) + ' 系统记录进程退出（' + (kinds[session.processExitReason] ?? '原因码 ' + session.processExitReason) + '）';
  }
  return '未收到停止回调，结束时间未知';
}
export function recordingReportFields(report: Report): Record<string, string> {
  const { service, settings, hours } = report;
  const fields: Record<string, string> = {
    'recording.serviceRunning': String(service?.running ?? 'unknown'),
    'recording.observedHours': String(hours.length),
    'recording.sessions': service ? String(service.sessions.length) : 'unavailable',
  };
  if (settings) fields['recording.systemAtExport'] = JSON.stringify({
    batteryUnrestricted: settings.batteryUnrestricted, backgroundRestricted: settings.backgroundRestricted,
    powerSave: settings.powerSave, notifications: settings.notifications,
  });
  service?.sessions.forEach((session, i) => {
    fields['recording.service.' + (i + 1)] = JSON.stringify({ ...session,
      observation: stateOf(session, service.running && i === service.sessions.length - 1) });
  });
  for (const { hour, ...evidence } of hours) fields['recording.hour.' + new Date(hour * 3_600_000).toISOString()] = JSON.stringify(evidence);
  return fields;
}

export function RecordingDiagnostics({ scope, eligible }: { scope: string; eligible: boolean }) {
  const [report, setReport] = useState<Report>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    void readRecordingReport(scope).then(result => { if (current) setReport(result); });
    return () => { current = false; };
  }, [scope, refresh]);
  const session = report?.service?.sessions.at(-1);
  const last = (event: 'committed' | 'chargingCommitted') => report?.hours.map(hour => hour.last[event]).filter(t => t !== undefined).at(-1);
  const formatted = (at?: number) => at ? stamp(at) : '暂无记录';
  return <details className="card diagnostic-fold" onToggle={e => { if (e.currentTarget.open) setRefresh(n => n + 1); }}>
    <summary>后台记录诊断<Icon name="chevrond" size={16} /></summary>
    <div className="diagnostic-fold-body">
      <p>{eligible ? '当前车辆已启用手机采样。' : '当前车辆未启用手机采样。'}
        {session && stateOf(session, report?.service?.running === true) + '。'}</p>
      {session && <p>最近服务启动 {formatted(session.startedAt)} · 最后定时触发 {formatted(session.lastTickAt)}</p>}
      <p>最近样本写入 {formatted(last('committed'))} · 最近充电样本写入 {formatted(last('chargingCommitted'))}</p>
      {report?.hours.length ? <details className="diagnostic-results">
        <summary>最近 48 小时采样<Icon name="chevrond" size={15} /></summary>
        <dl>{[...report.hours].reverse().map(({ hour, counts: c, nativeTicks }) =>
          <div key={hour}><dt>{stamp(hour * 3_600_000)}</dt><dd>{nativeTicks !== undefined && '服务触发 ' + nativeTicks + ' · '}后台回调 {c.backgroundPoll ?? 0} · 车况返回 {c.reply ?? 0} · 写入 {c.committed ?? 0} · 充电写入 {c.chargingCommitted ?? 0}
            {!!c.disableForCleanup && ' · 清理操作关闭记录'}{!!c.storageRestored && ' · 记录库恢复读取'}
            {!!c.foregroundSkip && ' · 交给前台轮询 ' + c.foregroundSkip}{!!c.rateCooldown && ' · 限流等待 ' + c.rateCooldown}
            {!!c.unknownCharge && ' · 充电状态未知 ' + c.unknownCharge}{!!c.storageReadFailed && ' · 本机记录读取失败 ' + c.storageReadFailed}
            {!!c.readFailed && ' · 读取失败 ' + c.readFailed}{!!c.invalidTime && ' · 时间无效或过旧 ' + c.invalidTime}
            {!!c.repeat && ' · 重复或倒序 ' + c.repeat}{!!c.writeFailed && ' · 写入失败 ' + c.writeFailed}</dd></div>)}</dl>
      </details> : <p>最近 48 小时暂无新版采样诊断。</p>}
      <button className="btn ghost sm" onClick={() => setRefresh(n => n + 1)}>刷新记录诊断</button>
    </div>
  </details>;
}
