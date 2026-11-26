import md5 from 'blueimp-md5';
import { readSetting, saveSetting } from './localDatabase.ts';
import { failureFacts } from './serviceFailure.ts';

const hourMs = 3_600_000;
const slots = 48;
export const recordingScope = (scope: string) => md5(scope);
const slotKey = (scope: string, hour: number) => 'recordDiag.' + recordingScope(scope) + '.' + (hour % slots);
export type RecordingEvent = 'backgroundPoll' | 'foregroundSkip' | 'attempt' | 'rateCooldown' | 'reply' | 'readFailed' |
  'invalidTime' | 'repeat' | 'charging' | 'unknownCharge' | 'committed' | 'chargingCommitted' |
  'storageReadFailed' | 'storageRestored' | 'disableForCleanup' | 'historyCleared' | 'writeFailed' | 'officialRead' | 'officialFailed';

export type RecordingHour = {
  hour: number; counts: Partial<Record<RecordingEvent, number>>; last: Partial<Record<RecordingEvent, number>>;
  lastFailure?: ReturnType<typeof failureFacts>; lastReportAt?: number;
};

// One small fixed-size slot per UTC hour and vehicle. Never store a URL, identifier, or vehicle payload.
export function noteRecording(scope: string, events: RecordingEvent[], options: { error?: unknown; reportedAt?: number; now?: number } = {}) {
  if (!scope) return;
  try {
    const now = options.now ?? Date.now();
    const hour = Math.floor(now / hourMs);
    const key = slotKey(scope, hour);
    const saved = readSetting<RecordingHour | null>(key, null);
    const entry: RecordingHour = saved?.hour === hour ? saved : { hour, counts: {}, last: {} };
    for (const event of events) {
      entry.counts[event] = (entry.counts[event] ?? 0) + 1;
      entry.last[event] = now;
    }
    if (options.error !== undefined) entry.lastFailure = failureFacts(options.error);
    if (Number.isSafeInteger(options.reportedAt) && options.reportedAt! > 0) entry.lastReportAt = options.reportedAt;
    saveSetting(key, entry);
  } catch { /* Recording takes precedence when diagnostic storage is unavailable. */ }
}

export function recordingHours(scope: string, now = Date.now()) {
  const latest = Math.floor(now / hourMs);
  const rows: RecordingHour[] = [];
  for (let hour = latest - slots + 1; hour <= latest; hour++) {
    const row = readSetting<RecordingHour | null>(slotKey(scope, hour), null);
    if (row?.hour === hour) rows.push(row);
  }
  return rows;
}
