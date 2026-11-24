import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useModelContext } from '../context';
import { useSetting } from '../../data/preferences';
import { haEnergy } from '../../data/ha/ledger';
import type { EnergyDay } from '../../data/types';
import { localDay } from '../../data/ha/measurements';
import { AppBar, Hint, Seg, Sheet, value } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { ExpenseCard } from './Expenses';
import { useDailyPlot } from './useDailyPlot';
import { useCardReorder } from './useCardReorder';
import { useChartReveal } from './useChartReveal';

const metrics = [
  { key: 'km', label: '里程', unit: 'km', color: 'var(--accent)' },
  { key: 'kwh', label: '耗电', unit: 'kWh', color: 'var(--success)' },
  { key: 'efficiency', label: '百公里能耗', unit: 'kWh/100km', color: 'var(--warning)' },
] as const;

function Trend({ active, days, setDays, rows, loading }: { active: boolean; days: number; setDays: (days: number) => void; rows: EnergyDay[]; loading: boolean }) {
  const [series, setSeries] = useState(0);
  const [display, setDisplay] = useState<'bar' | 'line'>('bar');
  const metric = metrics[series];
  const values = rows.map(row => row[metric.key]);
  const numbers = values.filter((v): v is number => v !== null);
  const reveal = useChartReveal(active, numbers.length > 0);
  const sum = (key: 'km' | 'kwh') => rows.reduce((total, r) => total + (r[key] ?? 0), 0);
  const totals = rows.filter(r => r.km !== null && r.kwh !== null);
  const knownKm = totals.reduce((s, r) => s + r.km!, 0);
  const totalMetric = !numbers.length ? null : metric.key === 'efficiency' ? knownKm ? 100 * totals.reduce((s, r) => s + r.kwh!, 0) / knownKm : null : sum(metric.key);
  const tick = Math.max(1, Math.ceil(Math.max(0, ...numbers) / 3));
  const left = 29, right = 340, top = 12, bottom = 154;
  const { bindings, guide, index, spacing, x } = useDailyPlot(rows, 350, left, right, active);
  const y = (v: number) => bottom - v * (bottom - top) / (tick * 3);
  const reading = rows[index] ? rows[index].day.slice(5).replace('-', '月') + '日 · ' + value(values[index], 1) + ' ' + metric.unit : '暂无采样';
  let line = '';
  values.forEach((v, i) => {
    if (v !== null) line += (i > 0 && values[i - 1] !== null ? 'L' : 'M') + x(i) + ' ' + y(v) + ' ';
  });
  return <div className="card chart-card trend-card">
    <div className="chart-head"><h3>里程与能耗</h3><div className="trend-controls">
      <Seg options={[[7, '周'], [30, '月']]} current={days} choose={setDays} label="时间范围" />
      <Seg options={[[ 'bar', '柱状'], ['line', '折线']]} current={display} choose={setDisplay} label="图表类型" />
    </div></div>
    <div className="series-chips" role="group" aria-label="趋势指标">{metrics.map((m, i) => <button className="schip" aria-pressed={series === i} key={m.key} onClick={() => setSeries(i)}><i style={{ background: m.color }} />{m.label}</button>)}
      <span className="energy-axis-unit trend-unit">{metric.unit}</span></div>
    <div {...bindings} className={'energy-plot' + (guide ? ' show-guide' : '')} role="group" tabIndex={0}
      aria-label={metric.label + '趋势，左右拖动或按方向键查看日期'}>
      <svg className="chart-svg" viewBox="0 0 350 184" role="img" aria-label={metric.label + ' · ' + metric.unit}>
        {[0, 1, 2, 3].map(i => <Fragment key={i}><line x1={left} x2={right} y1={y(tick * i)} y2={y(tick * i)} stroke="var(--line-strong)" />
          <text x={22} y={y(tick * i) + 4} textAnchor="end" fontSize={13} fill="var(--text2)">{tick * i}</text></Fragment>)}
        {numbers.length > 0 && <g className="plot-series" {...reveal}>
        {display === 'line' && <path d={line} fill="none" strokeWidth={2.5} stroke={metric.color} strokeLinejoin="round" />}
        {values.map((v, i) => v === null ? null : display === 'bar' ?
          <rect key={i} x={x(i) - spacing * .29} y={y(v)} width={Math.min(24, spacing * .58)} height={Math.max(1, bottom - y(v))} rx="3" fill={metric.color} opacity=".85" /> :
          <circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill={metric.color} />)}
        </g>}
        {index >= 0 && <line className="energy-guide" y1={top} y2={bottom} x1={x(index)} x2={x(index)} />}
        {rows.map((r, i) => (rows.length <= 10 || i % 6 === 0 || i === rows.length - 1) &&
          <text key={r.day} x={Math.min(329, x(i))} y="176" textAnchor="middle" fontSize="13" fill="var(--text2)">{r.day.slice(-5)}</text>)}
      </svg>
    </div>
    <div className="energy-trend-footer"><b className="num" role="status" id="energy-day-reading">{reading}</b><span className="energy-unit">
      {metric.key === 'efficiency' ? '平均 ' : '合计 '}{value(totalMetric, 1)} {metric.unit}</span></div>
    {loading && !numbers.length ? <p className="tiny muted" role="status">正在读取统计数据…</p> :
      numbers.length !== rows.length && <p className="tiny muted">空白日期缺少{metric.label}采样，合计仅含已读取的数据。</p>}
  </div>;
}

const labels = { stats: '本周统计', rank: '近 6 周能耗排名', trend: '里程与能耗', breakdown: '上周能耗构成' };
type Card = keyof typeof labels;
const initialCards: Card[] = ['stats', 'rank', 'trend', 'breakdown'];
export function EnergyPage({ active }: { active: boolean }) {
  const m = useModelContext();
  const [search] = useSearchParams();
  const jumpToExpense = search.get('section') === 'cost';
  const [days, setDays] = useState(7);
  const [byVehicle, updateCards] = useSetting<Record<string, (Card | 'cost')[]>>('energyCards', {});
  const cards = (byVehicle[m.vehicleId] ?? initialCards).filter((key): key is Card => Object.hasOwn(labels, key));
  const setCards = (next: Card[]) => updateCards(current => ({ ...current, [m.vehicleId]: next }));
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const mileage = m.canSee('mileage');
  useEffect(() => {
    if (!active) { setAdding(false); return; }
    if (jumpToExpense && mileage) document.getElementById('expense-statistics')?.scrollIntoView({ block: 'start' });
  }, [active, jumpToExpense, mileage]);
  const useCloud = mileage && !!m.client;
  const cloud = useQuery({ queryKey: ['cloud', 'energy', m.cloudKey, days], queryFn: ({ signal }) => m.client!.getEnergy(m.vehicleId, days, signal),
    enabled: active && useCloud, retry: false, staleTime: 5 * 60_000 });
  const history = useQuery({ queryKey: ['ha', 'energy', m.ha.config?.url, m.ha.vin, days],
    queryFn: ({ signal }) => haEnergy(m.ha.config!, m.ha.vin, days, signal),
    enabled: active && mileage && (m.mode === 'ha' || m.source === 'hybrid') && m.ha.connected && !!m.ha.vin,
    retry: false, staleTime: 120_000, refetchInterval: query => query.state.data?.pending ? 60_000 : false });
  const facts = useQuery({
    queryKey: ['cloud', 'energy-facts', m.cloudKey, m.current.powertrain],
    enabled: active && useCloud,
    queryFn: () => m.client!.getEnergyFacts(m.vehicleId, m.current.powertrain === 'reev'), retry: false, staleTime: 300_000,
  });
  const rank = useQuery({
    queryKey: ['cloud', 'energy-rank', m.cloudKey], queryFn: () => m.client!.getEnergyRank(m.vehicleId),
    enabled: active && useCloud, retry: false, staleTime: 300_000,
  });
  const percentile = m.simulated ? '1%' : rank.data?.rank;
  const fallback = m.energyPlaceholder(days);
  let rows = useCloud && cloud.data?.length ? cloud.data : m.mode === 'ha' && history.data?.daily.length ?
    history.data.daily.map(row => {
      const alternate = fallback.find(r => r.day === row.day);
      const km = row.km ?? alternate?.km ?? null, kwh = row.kwh ?? alternate?.kwh ?? null;
      return { ...row, km, kwh, efficiency: km !== null && km > 0 && kwh !== null ? kwh * 100 / km : null };
    }) : fallback;
  if (m.source === 'hybrid') {
    const local = new Map<string, { km: number | null; kwh: number | null }>();
    for (const trip of m.records.trips) {
      const day = localDay(trip.startedAt), total = local.get(day) ?? { km: null, kwh: null };
      if (trip.distanceKm !== null) total.km = (total.km ?? 0) + trip.distanceKm;
      if (trip.energyKwh !== null) total.kwh = (total.kwh ?? 0) + trip.energyKwh;
      local.set(day, total);
    }
    const ha = new Map(history.data?.daily.map(row => [row.day, row]));
    rows = rows.map(row => {
      const remote = ha.get(row.day), cached = local.get(row.day);
      const km = row.km ?? remote?.km ?? cached?.km ?? null;
      const kwh = row.kwh ?? remote?.kwh ?? cached?.kwh ?? null;
      return { ...row, km, kwh, efficiency: km !== null && km > 0 && kwh !== null ? 100 * kwh / km : null };
    });
  }
  const weekly = rows.slice(-7), weeklyKm = weekly.filter(r => r.km !== null), paired = weekly.filter(r => r.km !== null && r.kwh !== null);
  const sumKm = (data: EnergyDay[]) => data.reduce((s, r) => s + r.km!, 0);
  const eff = sumKm(paired) ? paired.reduce((s, r) => s + r.kwh!, 0) * 100 / sumKm(paired) : null;
  function move(from: Card, to: Card) {
    if (from === to) return;
    const next = cards.filter(key => key !== from);
    next.splice(cards.indexOf(to), 0, from);
    setCards(next);
  }
  const page = useCardReorder(active && editing, move);
  const breakdown = m.mode === 'ha' ? history.data?.breakdown : facts.data?.breakdown;
  const parts = [
    ['驱动', m.simulated ? 86.9 : breakdown?.drive ?? null, 'var(--accent)'],
    ['空调', m.simulated ? 8.6 : breakdown?.climate ?? null, 'var(--success)'],
    ['其它', m.simulated ? 6.2 : breakdown?.other ?? null, 'var(--warning)'],
  ] as const;
  const total = parts.every(([, n]) => n !== null) ? parts.reduce((sum, [, n]) => sum + (n ?? 0), 0) : null;
  const revealBreakdown = useChartReveal(active && mileage && cards.includes('breakdown'), total !== null && total > 0);
  function content(key: Card) {
    if (key === 'trend') return <Trend active={active} days={days} setDays={setDays} rows={rows} loading={cloud.isFetching || history.isFetching} />;
    if (key === 'stats') return <div className="statrow"><div className="card stat"><div className="k">本周行驶</div><div className="v num">{weeklyKm.length ? value(sumKm(weeklyKm), 1) : '—'} <span className="energy-unit">km</span></div></div>
      <div className="card stat"><div className="k">{m.current.powertrain === 'reev' ? '平均油耗' : '平均能耗'}</div><div className="v num">
      {m.current.powertrain === 'reev' ? m.simulated ? '6.8' : value(facts.data?.fuel, 1) : value(eff, 1)} <span className="energy-unit">{m.current.powertrain === 'reev' ? 'L/100km' : 'kWh/100km'}</span></div></div></div>;
    if (key === 'rank') return <div className="card"><div className="chart-head"><h3>{labels.rank}</h3></div><div className="rank-row"><div className="rank-big">{percentile ? '超过 ' + percentile : '—'}</div><div className="rank-body">
      <div className="rank-value"><span>百公里能耗</span><div><b className="num">{m.simulated ? '14.6' : value(rank.data?.efficiency, 1)}</b> <span className="energy-unit">kWh/100km</span></div></div>
      {!percentile && <div className="tiny muted" role="status">{rank.isFetching ? '正在读取排名…' : rank.isError ? '暂时无法读取零跑排名。' : m.mode === 'ha' ? '请登录零跑账号查看排名。' : '零跑暂未返回排名。'}</div>}</div></div></div>;
    return <div className="card chart-card"><div className="chart-head"><h3>{labels.breakdown}</h3><b className="num">{value(total, 1)} kWh</b></div>
        {total !== null && total > 0 && <div className="stackbar" {...revealBreakdown}>{parts.map(([name, n, color]) => <i key={name} style={{ width: (n ?? 0) / total * 100 + '%', background: color }} />)}</div>}
        <div className="energy-readings">{parts.map(([name, n, color]) => <div key={name}><span className="energy-reading-label"><i style={{ background: color }} />{name}</span><b className="energy-reading-value">{value(n, 1)} kWh</b></div>)}</div></div>;
  }
  return <div className="energy-screen" hidden={!active}><AppBar title="统计" back="/home" action={mileage ? <button className="appbar-action icon-action" aria-label={editing ? '完成' : '编辑'}
    title={editing ? '完成' : '编辑'} onClick={() => setEditing(!editing)}><Icon name={editing ? 'check' : 'edit'} size={18} /></button> : undefined} />
    <div className="page energy-page" ref={page}>{!mileage ? <MileageNotice /> : <>
      {editing && <p className="tiny muted">长按卡片后拖动排序，点右上角移除。</p>}
      {cards.map((key, i) => <article key={key} data-energy-card={key} className={'energy-card' + (editing ? ' editing' : '')}>
        {editing && <><button className="card-del" aria-label={'删除' + labels[key]} onClick={() => setCards(cards.filter(item => item !== key))}>×</button>
          <button className="sr-only" disabled={i === 0} onClick={() => move(key, cards[i - 1])}>向上移动{labels[key]}</button>
          <button className="sr-only" disabled={i === cards.length - 1} onClick={() => move(key, cards[i + 1])}>向下移动{labels[key]}</button></>}
        {content(key)}
      </article>)}
      {editing && <button className="btn ghost" onClick={() => setAdding(true)}>+ 添加卡片</button>}
      <ExpenseCard active={active} />
    </>}
    {active && adding && <Sheet title="添加统计卡片" close={() => setAdding(false)}>
      {(Object.keys(labels) as Card[]).map(key => <button key={key} className="btn ghost" disabled={cards.includes(key)} onClick={() => { setCards([...cards, key]); setAdding(false); }}>{labels[key]}</button>)}
    </Sheet>}
    </div></div>;
}
export function MileageNotice() {
  return <div className="card grant-card"><div className="confirm-ic"><Icon name="chart" /></div><b>里程能耗未授权</b><Link className="link" to="/vehicle-access">查看车辆授权</Link></div>;
}
