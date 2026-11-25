import md5 from 'blueimp-md5';
import { readSetting, saveSetting } from './localDatabase.ts';
import { failureFacts } from './serviceFailure.ts';

type Operation = 'list' | 'state' | 'sms' | 'login';
type ReadFailure = ReturnType<typeof failureFacts> & { at: string };
const key = (scope: string, operation: Operation) => 'readFailure.' + md5(scope) + '.' + operation;
export function readFailure(scope: string, operation: Operation) {
  return readSetting<ReadFailure | null>(key(scope, operation), null);
}
export function rememberFailure(scope: string, operation: Operation, error: unknown) {
  if (!scope) return;
  try { saveSetting(key(scope, operation), { at: new Date().toISOString(), ...failureFacts(error) }); }
  catch { /* A diagnostic write must not affect the original request. */ }
}
