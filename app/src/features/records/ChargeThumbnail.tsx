import type { Charge } from '../../data/ha/measurements';
import { Icon } from '../../ui/Icon';

export function ChargeThumbnail({ charge }: { charge: Charge }) {
  const points = charge.powers;
  if (points.length < 2) {
    const soc = charge.socStart != null && charge.socEnd != null
      ? Math.round(charge.socStart) + '→' + Math.round(charge.socEnd) + '%' : '';
    return <div className="charge-thumbnail" role="img" aria-label={soc ? '充电电量 ' + soc : '充电记录'}>
      <Icon name="plug" size={18} />{soc && <small>{soc}</small>}</div>;
  }
  const peak = points.reduce((max, p) => Math.max(max, p.value), 1);
  const start = points[0].at, duration = Math.max(1, points[points.length - 1].at - start);
  const stride = Math.max(1, Math.ceil(points.length / 72));
  const path = points.filter((_, i) => i % stride === 0 || i === points.length - 1).map(p =>
    (4 + 80 * (p.at - start) / duration).toFixed(1) + ',' + (33 - p.value * 27 / peak).toFixed(1)).join(' ');
  return <div className="charge-thumbnail" role="img" aria-label="充电功率缩略图"><svg viewBox="0 0 88 38" aria-hidden="true">
    <polyline points={path} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
  </svg></div>;
}
