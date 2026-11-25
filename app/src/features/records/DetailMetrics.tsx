import { Icon, type IconName } from '../../ui/Icon';

export type DetailMetric = { label: string; icon: IconName; reading: string; unit?: string };

export function DetailMetrics({ items }: { items: DetailMetric[] }) {
  return <dl className="trip-metrics">{items.map(({ label, icon, reading, unit }) =>
    <div className="tm" key={label}>
      <dt className="metric-label"><Icon name={icon} size={13} />{label}</dt>
      <dd><b className="num">{reading}</b>{unit && <> <small>{unit}</small></>}</dd>
    </div>)}</dl>;
}
