import md5 from 'blueimp-md5';
import { readSetting, saveSetting } from './localDatabase.ts';
import { failureFacts, type LoginStage } from './serviceFailure.ts';

type Operation = 'list' | 'state' | 'sms' | 'login';
type LoginNetwork = {
  webViewOnline?: boolean; sampledAt?: string; activeNetwork?: boolean; validated?: boolean; networkInfoError?: number;
};
type ReadFailure = ReturnType<typeof failureFacts> & { at: string; stage?: LoginStage; network?: LoginNetwork };
const key = (scope: string, operation: Operation) => 'readFailure.' + md5(scope) + '.' + operation;
export function readFailure(scope: string, operation: Operation) {
  return readSetting<ReadFailure | null>(key(scope, operation), null);
}
export function rememberFailure(scope: string, operation: Operation, error: unknown, stage?: LoginStage, network?: LoginNetwork) {
  if (!scope) return;
  const entry: ReadFailure = { at: new Date().toISOString(), stage, network, ...failureFacts(error) };
  try { saveSetting(key(scope, operation), entry); return entry; }
  catch { /* A diagnostic write must not affect the original request. */ }
}

export function attachLoginNetwork(scope: string, operation: 'sms' | 'login', entry: ReadFailure, snapshot: LoginNetwork) {
  try {
    if (readFailure(scope, operation)?.at === entry.at) saveSetting(key(scope, operation), { ...entry, network: { ...entry.network, ...snapshot } });
  } catch { /* Keep the original failure if the network snapshot cannot be saved. */ }
}
