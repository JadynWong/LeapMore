import { useModelContext } from '../context';
import { Icon } from '../../ui/Icon';

const phases = { idle: '待记录', starting: '等待采样', recording: '记录中', interrupted: '已中断', ended: '已结束' };
function sampleTime(at: number) {
  if (!at) return '暂无';
  const date = new Date(at);
  const time = date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return date.toDateString() === new Date().toDateString() ? time : date.toLocaleDateString('zh-CN') + ' ' + time;
}
export function ManualTripCard({ charging = false, metrics = [] }: { charging?: boolean; metrics?: [string, string][] }) {
  const m = useModelContext();
  const { available, busy, active, state, issue, toggle } = m.manualTrip;
  if (!available) return null;
  const phase = state?.phase ?? 'idle';
  const label = active ? '结束记录' : phase === 'interrupted' ? '继续记录' : '开始记录';
  const note = issue || state?.note;
  const title = charging ? '充电记录' : '行程记录';
  const trip = !charging && active && state?.vehicleId === m.vehicleId ? m.cloudRecords.activeTrip : null;
  const readings = trip ? [
    ['实时车速', trip.speedKmh == null ? '—' : Math.round(trip.speedKmh) + ' km/h'],
    ['本段里程', trip.distanceKm == null ? '—' : trip.distanceKm.toFixed(1) + ' km'],
  ] : metrics;
  return <section className="card manual-trip" aria-label={'手机' + title} data-phase={phase}>
    <div className="manual-trip-header"><span className="manual-trip-icon"><Icon name={charging ? 'plug' : 'route'} size={21} /></span>
      <div className="manual-trip-name"><b>{title}</b><span>{state?.vehicle || m.name}</span></div>
      <span className="manual-trip-state" role="status"><i />{state ? phases[phase] : '读取中'}</span>
    </div>
    {readings.length > 0 && <div className="manual-trip-metrics">
      {readings.map(([label, reading]) => <span key={label}>{label} <b>{reading}</b></span>)}
    </div>}
    <div className="manual-trip-footer">
      <div className="manual-trip-time"><span>最近成功采样</span><time dateTime={state?.lastSample ? new Date(state.lastSample).toISOString() : undefined}>{sampleTime(state?.lastSample ?? 0)}</time></div>
      <button type="button" className={'btn sm ' + (active ? 'secondary' : 'accent')} disabled={!state || busy} onClick={() => void toggle()}>{label}</button>
    </div>
    {note && <p className="manual-trip-note" role="status">{note}</p>}
  </section>;
}
