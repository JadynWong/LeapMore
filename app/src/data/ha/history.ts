import { entityHistory } from './client.ts';
import { entityIdOf, MS_DAY, samplesOf } from './schema.ts';
import type { HAConfig, Mapping, Sample } from './schema.ts';
import { readDataset, saveDataset } from '../localDatabase.ts';

export interface History { entries: Sample[]; cursor: number }
export function mergeSamples(existing: Sample[], incoming: Sample[], since: number) {
  const merged = new Map<string, Sample>();
  for (const sample of [...existing, ...incoming]) {
    if (sample.at >= since) merged.set(JSON.stringify([sample.entity, sample.at, sample.state, sample.attrs]), sample);
  }
  return [...merged.values()].sort((a, b) => a.at - b.at);
}
import { historyKey } from './cacheKeys.ts';
export { historyKey } from './cacheKeys.ts';
export async function syncHistory(config: HAConfig, vehicle: string, vin: string, mapping: Mapping, signal: AbortSignal) {
  const { energyRank, rankEfficiency, ...historyMapping } = mapping;
  const bindings = Object.values(historyMapping);
  const entities = Array.from(new Set(bindings.map(entityIdOf))).filter(Boolean);
  const key = historyKey(config, vehicle, vin);
  const end = Date.now();
  const since = end - config.days * MS_DAY;
  const withAttributes = bindings.some(binding => typeof binding === 'object');
  const signature = JSON.stringify([entities.slice().sort(), config.days, ...(withAttributes ? [mapping.batteryMinTemp ? 'attributes:v2' : 'attributes:v1'] : [])]);
  const prior = await readDataset<History & { signature: string }>(key);
  const cached = prior?.signature === signature ? prior : undefined;
  let current: History = cached ?? { entries: [], cursor: since };
  let start = Math.max(since, current.cursor - 60_000);
  // Each complete time window is committed with its cursor. An interrupted window is retried.
  while (start < end && entities.length) {
    signal.throwIfAborted();
    const next = Math.min(start + 5 * MS_DAY, end);
    const batch = await entityHistory(config, entities, start, next, signal);
    signal.throwIfAborted();
    current = { entries: mergeSamples(current.entries, samplesOf(batch), since), cursor: next };
    await saveDataset(key, { ...current, signature });
    start = next;
  }
  return current;
}
