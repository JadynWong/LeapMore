import { useMemo } from 'react';
import { usePlotScrub } from './usePlotScrub';
import { kmBetween } from '../../data/ha/measurements';
import type { MetricSample, TrackSample, Trip } from '../../data/ha/measurements';
import { clock, value } from '../../ui/components';

const timeWithSeconds = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const plot = { width: 340, left: 36, right: 304, top: 13, bottom: 100 };
const divisions = 4;

function axisStep(peak: number) {
  const interval = peak / divisions;
  const base = 10 ** Math.floor(Math.log10(interval));
  return base * ([1, 2, 2.5, 5, 10].find(step => step * base >= interval) ?? 10);
}

export function tripTimeline(trip: Trip | undefined, readings?: TrackSample[]) {
  if (!trip) return [];
  const byTime = new Map<number, TrackSample>();
  if (readings?.length) readings.forEach(sample => byTime.set(sample.at, sample));
  else {
    trip.route.forEach(position => byTime.set(position.at, { at: position.at, value: null, position }));
    trip.speeds.forEach(({ at, value }) => byTime.set(at, { ...byTime.get(at), at, value }));
  }
  let previous: TrackSample['position'];
  let distanceKm = 0;
  return [...byTime.values()].sort((a, b) => a.at - b.at).map(sample => {
    const point = sample.position;
    if (!point || point.coordinate === 'unknown') { previous = undefined; return sample; }
    if (previous && previous.coordinate === point.coordinate && point.at - previous.at <= 180_000) {
      const step = kmBetween(previous, point);
      if (step <= 2) distanceKm += step;
    }
    previous = point;
    return { ...sample, distanceKm };
  });
}

function closest(samples: MetricSample[], at: number) {
  let low = 0, high = samples.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].at < at) low = mid + 1;
    else high = mid;
  }
  return low > 0 && at - samples[low - 1].at <= samples[low].at - at ? low - 1 : low;
}

export function Timeline({ title, unit, samples, selectedAt, onSelect, extra, maxGap = 180_000 }: {
  title: string; unit: string; samples: MetricSample[]; selectedAt: number | null; onSelect: (at: number) => void;
  extra?: string; maxGap?: number;
}) {
  const start = samples[0]?.at ?? 0;
  const end = samples.at(-1)?.at ?? start;
  const span = Math.max(1, end - start);
  const x = (time: number) => plot.left + (end === start ? .5 : (time - start) / span) * (plot.right - plot.left);
  const graph = useMemo(() => {
    const peak = samples.reduce((high, sample) => sample.value === null ? high : Math.max(high, sample.value), -Infinity);
    const hasPrimary = Number.isFinite(peak);
    const step = axisStep(Math.max(1, peak));
    const top = step * divisions;
    let hasSoc = false;
    const line = (key: 'value' | 'soc', max: number) => {
      let path = '', previous: number | undefined;
      for (const sample of samples) {
        const reading = sample[key];
        if (reading == null) { previous = undefined; continue; }
        if (key === 'soc') hasSoc = true;
        const position = plot.left + (end === start ? .5 : (sample.at - start) / span) * (plot.right - plot.left);
        const height = plot.bottom - reading / max * (plot.bottom - plot.top);
        path += (previous !== undefined && sample.at - previous <= maxGap ? 'L' : 'M') +
          position.toFixed(2) + ' ' + height.toFixed(2) + 'l.01 0';
        previous = sample.at;
      }
      return path;
    };
    const primary = line('value', top), soc = line('soc', 100);
    return { primary, soc, hasSoc, hasPrimary, step, top };
  }, [samples, start, end, span, maxGap]);
  const index = selectedAt === null ? -1 : samples.findIndex(sample => sample.at === selectedAt);
  const current = samples[index];
  const plotY = (reading: number, max: number) => plot.bottom - reading / max * (plot.bottom - plot.top);
  const readout = current ? [
    timeWithSeconds.format(current.at),
    unit && (current.value === null ? '暂无' + (unit === 'kW' ? '功率' : '车速') : value(current.value, 1) + ' ' + unit),
    graph.hasSoc && (current.soc == null ? '暂无 SOC' : 'SOC ' + value(current.soc, 0) + '%'),
    extra,
  ].filter(Boolean).join(' · ') : '左右拖动查看采样';
  function pickAt(el: HTMLElement, clientX: number) {
    const rect = el.getBoundingClientRect();
    if (!samples.length || !rect.width) return;
    const px = (clientX - rect.left) / rect.width * plot.width;
    const fraction = Math.max(0, Math.min(1, (px - plot.left) / (plot.right - plot.left)));
    onSelect(samples[closest(samples, start + span * fraction)].at);
  }
  const scrub = usePlotScrub(pickAt);
  return <div className="card chart-card">
    <div className="chart-head"><h3>{title}</h3><span>{[unit, graph.hasSoc && 'SOC %'].filter(Boolean).join(' · ')}</span></div>
    {!samples.length ? <p className="tiny muted">当前来源缺少采样。</p> : <>
      <div className="sample-timeline" role="slider" tabIndex={0} aria-label={title + '时间轴'}
        aria-valuemin={1} aria-valuemax={samples.length} aria-valuenow={Math.max(1, index + 1)}
        aria-valuetext={current ? readout : '尚未选择采样'}
        {...scrub}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? samples.length - 1 :
            Math.min(samples.length - 1, Math.max(0, index + (event.key === 'ArrowLeft' ? -1 : 1)));
          onSelect(samples[next].at);
        }}>
        <svg className="chart-svg" viewBox="0 0 340 122" preserveAspectRatio="none" aria-hidden="true">
          {Array.from({ length: divisions + 1 }, (_, tick) => {
            const y = plotY(tick, divisions);
            return <g key={tick}>
              <line x1={plot.left} x2={plot.right} y1={y} y2={y} stroke="var(--line-strong)" />
              {graph.hasPrimary && <text className="sample-axis-primary" x={plot.left - 6} y={y + 3} textAnchor="end" fill="var(--text2)" fontSize="10">{Number((tick * graph.step).toFixed(2))}</text>}
              {graph.hasSoc && <text className="sample-axis-soc" x={plot.right + 6} y={y + 3} fill="var(--text2)" fontSize="10">{tick * 100 / divisions}</text>}
            </g>;
          })}
          {graph.hasPrimary && <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} stroke="var(--line-strong)" />}
          {graph.hasSoc && <line x1={plot.right} x2={plot.right} y1={plot.top} y2={plot.bottom} stroke="var(--line-strong)" />}
          <path d={graph.primary} stroke="var(--accent)" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {graph.hasSoc && <path d={graph.soc} stroke="var(--success)" fill="none" strokeWidth="1.8" strokeDasharray="4 3" strokeLinecap="round" />}
          {current && <g>
            <line x1={x(current.at)} x2={x(current.at)} y1={plot.top} y2={plot.bottom} stroke="var(--text2)" opacity=".55" />
            {current.value !== null && <circle cx={x(current.at)} cy={plotY(current.value, graph.top)} r="3" fill="var(--accent)" />}
            {current.soc != null && <circle cx={x(current.at)} cy={plotY(current.soc, 100)} r="3" fill="var(--success)" />}
          </g>}
          <text x={plot.left} y="117" fill="var(--text2)" fontSize="11">{clock(start)}</text>
          {end !== start && <text x={plot.right} y="117" textAnchor="end" fill="var(--text2)" fontSize="11">{clock(end)}</text>}
        </svg>
      </div>
      <div className="sample-readout tiny" data-sample-at={current?.at}>{readout}</div>
    </>}
  </div>;
}
