import type { Point } from '../../data/ha/measurements';
import type { Favorite } from '../../data/preferences';
import { request } from '../../platform/network';
import { parseAmapPoint } from './amapServices';

export function mapPoint(point: Point): Point {
  if (point.coordinate !== 'wgs84' || point.lon < 72.004 || point.lon > 137.8347 || point.lat < .8293 || point.lat > 55.8271) return point;
  const x = point.lon - 105, y = point.lat - 35;
  const pi = Math.PI, ee = .006693421622965943, base = 6378245;
  const shared = (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
  const deltaLat = -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * Math.sqrt(Math.abs(x)) + shared +
    (20 * Math.sin(y * pi) + 40 * Math.sin(y / 3 * pi) + 160 * Math.sin(y / 12 * pi) + 320 * Math.sin(y / 30 * pi)) * 2 / 3;
  const deltaLon = 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * Math.sqrt(Math.abs(x)) + shared +
    (20 * Math.sin(x * pi) + 40 * Math.sin(x / 3 * pi) + 150 * Math.sin(x / 12 * pi) + 300 * Math.sin(x / 30 * pi)) * 2 / 3;
  const t = point.lat * pi / 180;
  const magic = 1 - ee * Math.sin(t) ** 2;
  return { ...point, coordinate: 'gcj02',
    lat: point.lat + deltaLat * 180 / (base * (1 - ee) / (magic * Math.sqrt(magic)) * pi),
    lon: point.lon + deltaLon * 180 / (base / Math.sqrt(magic) * Math.cos(t) * pi),
  };
}
export async function resolveDestination(fav: Favorite, key: string | undefined, abilities: string[] | undefined, signal: AbortSignal) {
  const reply = fav.point || !key ? null : await request<{ status: string; geocodes?: { location: string; formatted_address?: string }[] }>(
    'https://restapi.amap.com/v3/geocode/geo?' + new URLSearchParams({ address: fav.address, key }), { signal });
  const match = reply?.geocodes?.[0];
  const point = fav.point ?? (reply?.status === '1' ? parseAmapPoint(match?.location) : undefined);
  if (!point) throw new Error('无法解析地址');
  const destination = { name: fav.name, address: match?.formatted_address || fav.address, ...point };
  if (abilities?.includes('39')) {
    for (let i = 0; i < 3; i++) {
      const mapped = mapPoint({ lat: destination.lat, lon: destination.lon, at: 0, coordinate: 'wgs84' });
      destination.lat += point.lat - mapped.lat;
      destination.lon += point.lon - mapped.lon;
    }
  }
  return destination;
}
