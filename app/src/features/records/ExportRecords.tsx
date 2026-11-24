import { useMemo, useState } from 'react';
import type { Charge, Trip } from '../../data/ha/measurements';
import { localDay } from '../../data/ha/measurements';
import { saveRecordsCsv } from '../../platform/settings';
import { Seg, Sheet, SheetButtons } from '../../ui/components';

export function ExportRecords({ trips, charges, close, saved }: {
  trips: Trip[]; charges: Charge[]; close: () => void; saved: () => void;
}) {
  const rows = useMemo(() => [
    ...trips.map(r => ({ at: r.startedAt, fields: ['trip', r.source, localDay(r.startedAt), r.distanceKm, r.energyKwh, r.complete ? 'complete' : 'partial'] })),
    ...charges.map(r => ({ at: r.startedAt, fields: ['charge', r.source, localDay(r.startedAt), '', r.kwh, r.partial || r.active ? 'partial' : 'complete'] })),
  ].sort((a, b) => b.at - a.at), [trips, charges]);
  const [mode, setMode] = useState<'all' | 'range'>('all');
  const [start, setStart] = useState(() => localDay(rows.at(-1)?.at ?? Date.now()));
  const [end, setEnd] = useState(() => localDay(rows[0]?.at ?? Date.now()));
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const validRange = !!start && !!end && start <= end;
  const selected = mode === 'all' ? rows : validRange ? rows.filter(row => {
    const day = localDay(row.at);
    return day >= start && day <= end;
  }) : [];
  const tripCount = selected.filter(row => row.fields[0] === 'trip').length;
  function dismiss() { if (!busy) close(); }
  async function save() {
    if (!selected.length || busy) return;
    setBusy(true);
    setIssue('');
    const name = 'leapmore-records-' + (mode === 'all' ? 'all' : `${start}_${end}`) + '.csv';
    const csv = ['type,source,date,distance_km,energy_kwh,coverage', ...selected.map(row => row.fields.join(','))].join('\r\n') + '\r\n';
    try {
      if (await saveRecordsCsv(name, csv)) saved();
    } catch {
      setIssue('无法保存 CSV，请重试或选择其他保存位置。');
    } finally { setBusy(false); }
  }
  return <Sheet title="导出记录" close={dismiss} className="record-export-sheet">
    <Seg label="导出范围" current={mode} choose={setMode} options={[['all', '全部记录'], ['range', '日期范围']]} disabled={busy} />
    {mode === 'range' && <div className="record-export-dates">
      <label className="tiny muted">开始日期<input type="date" value={start} max={end || undefined} disabled={busy} onChange={event => setStart(event.target.value)} /></label>
      <label className="tiny muted">结束日期<input type="date" value={end} min={start || undefined} disabled={busy} onChange={event => setEnd(event.target.value)} /></label>
    </div>}
    <p className="small muted" role="status">{mode === 'range' && !validRange ? '请选择有效的开始和结束日期。' : selected.length ?
      `${tripCount} 段行程 · ${selected.length - tripCount} 次充电` : '此范围内没有可导出的记录。'}</p>
    {issue && <p className="small error" role="alert">{issue}</p>}
    <SheetButtons cancel={dismiss} action={() => void save()} label={busy ? '正在导出…' : '导出 CSV'} disabled={!selected.length || busy} />
  </Sheet>;
}
