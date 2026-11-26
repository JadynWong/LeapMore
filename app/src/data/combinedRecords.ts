import type { Charge, Trip } from './ha/measurements.ts';

type Interval = { id: string; startedAt: number; endedAt: number | null };
const newest = (a: Interval, b: Interval) => b.startedAt - a.startedAt;
const tripEnd = (trip: Trip) => trip.endedAt ?? Math.max(trip.startedAt,
  trip.speeds.at(-1)?.at ?? 0, trip.route.at(-1)?.at ?? 0);
const chargeEnd = (charge: Charge) => charge.endedAt ?? charge.powerTimeline?.at(-1)?.at ?? charge.startedAt;

function matchRecords<T extends Interval>(local: T[], remote: T[], endOf: (record: T) => number, drift: number) {
  const matches = new Map<string, T[]>();
  const unmatched: T[] = [];
  const intervals = remote.map(row => ({ row, end: endOf(row) })).sort((a, b) => a.row.startedAt - b.row.startedAt);
  for (const row of local) {
    const end = endOf(row);
    let best: { row: T; score: number } | undefined;
    for (const { row: candidate, end: candidateEnd } of intervals) {
      if (candidate.startedAt > end + drift) break;
      if (candidateEnd < row.startedAt - drift) continue;
      const startDelta = Math.abs(row.startedAt - candidate.startedAt);
      const endDelta = Math.abs(end - candidateEnd);
      const overlap = Math.min(end, candidateEnd) - Math.max(row.startedAt, candidate.startedAt);
      const shorter = Math.min(end - row.startedAt, candidateEnd - candidate.startedAt);
      // Nearby boundaries alone cannot merge two records separated by a stop.
      const sameInstant = shorter === 0 && (overlap === 0 || startDelta <= 10_000);
      if (!sameInstant && (overlap <= 0 || overlap < shorter * .75)) continue;
      const score = overlap / Math.max(1, shorter) + Math.max(0, 1 - (startDelta + endDelta) / (2 * drift));
      if (!best || score > best.score) best = { row: candidate, score };
    }
    if (!best) { unmatched.push(row); continue; }
    const group = matches.get(best.row.id);
    if (group) group.push(row);
    else matches.set(best.row.id, [row]);
  }
  return { matches, unmatched };
}

export function combineTrips(local: Trip[], remote: Trip[]) {
  const { matches, unmatched } = matchRecords(local, remote, tripEnd, 2 * 60_000);
  const aliases = new Map([...matches].map(([id, rows]) => [id, rows.map(row => row.id)]));
  const primary = remote.map(row => {
    const equivalent = matches.get(row.id)?.find(record => Math.abs(record.startedAt - row.startedAt) <= 120_000 &&
      Math.abs(tripEnd(record) - tripEnd(row)) <= 120_000 && record.route.length >= 2);
    return !equivalent || row.route.length ? row : { ...row, route: equivalent.route, speeds: equivalent.speeds };
  });
  return { trips: [...primary, ...unmatched].sort(newest), aliases };
}

export function combineCharges(local: Charge[], remote: Charge[]) {
  const { matches, unmatched } = matchRecords(local, remote, chargeEnd, 15 * 60_000);
  const aliases = new Map<string, string[]>();
  const primary = remote.map(row => {
    const matched = matches.get(row.id);
    if (!matched?.length) return row;
    const active = matched.find(record => record.active);
    const end = chargeEnd(row);
    const point = matched.map(record => record.position).find(p => p && p.at >= row.startedAt &&
      (p.at < end || p.at === end && (row.active || end === row.startedAt)));
    const position = row.position && row.position.coordinate !== 'unknown' ? row.position : point ?? row.position;
    const ids = matched.flatMap(record => record.sampledId ? [record.id, record.sampledId] : [record.id]);
    if (row.active && active) {
      aliases.set(active.id, [row.id, ...ids.filter(id => id !== active.id)]);
      return active.position || !position ? active : { ...active, position };
    }
    aliases.set(row.id, ids);
    const equivalent = matched.find(record => Math.abs(record.startedAt - row.startedAt) < 120_000 &&
      Math.abs(chargeEnd(record) - chargeEnd(row)) < 120_000);
    if (!equivalent) return position === row.position ? row : { ...row, position };
    return { ...row, position, kwh: row.kwh ?? equivalent.kwh, gridKwh: row.gridKwh ?? equivalent.gridKwh,
      socStart: row.socStart ?? equivalent.socStart, socEnd: row.socEnd ?? equivalent.socEnd,
      powers: row.powers.length ? row.powers : equivalent.powers,
      powerTimeline: row.powerTimeline?.length ? row.powerTimeline : equivalent.powerTimeline };
  });
  return { charges: [...primary, ...unmatched].sort(newest), aliases };
}
