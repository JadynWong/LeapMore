import { biometricsAvailable, secureGet, secureGetWithBiometrics, secureRemove, secureSet } from './secure';

export type OperationMode = 'reuse' | 'verify' | 'instant';
export type OperationAuth = { mode: OperationMode; saved: boolean; biometric: boolean };
type StoredOperationAuth = { mode: OperationMode | 'password' | 'biometrics'; saved: boolean; biometric?: boolean };
export const defaultOperationAuth: OperationAuth = { mode: 'reuse', saved: false, biometric: false };
export const operationAuthKey = (scope: string) => ['operation-auth', scope] as const;
export const biometricAvailabilityKey = ['system-biometrics'] as const;
export const validOperationPin = (pin: string) => /^\d{4,6}$/.test(pin);

async function keys(scope: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
  const id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return { prefs: 'remote-control:mode:' + id, reuse: 'remote-control:pin:' + id, biometrics: 'remote-control-biometric:' + id };
}

export async function operationAuth(scope: string): Promise<OperationAuth> {
  const prefs = await secureGet<StoredOperationAuth>((await keys(scope)).prefs);
  if (!prefs) return defaultOperationAuth;
  const mode = prefs.mode === 'reuse' || prefs.mode === 'instant' ? prefs.mode : 'verify';
  return { mode, saved: mode !== 'verify' && prefs.saved,
    biometric: prefs.biometric ?? (prefs.mode === 'biometrics' && prefs.saved) };
}

export async function setOperationAuth(scope: string, mode: OperationMode): Promise<OperationAuth> {
  const id = await keys(scope);
  const before = await operationAuth(scope);
  if (before.mode === mode) return before;
  let biometric = before.biometric;
  if (mode === 'verify' && before.saved && await biometricsAvailable()) {
    const pin = await secureGet<string>(id.reuse).catch(() => null);
    if (pin && validOperationPin(pin)) biometric = await secureSet(id.biometrics, pin).then(() => true).catch(() => before.biometric);
  }
  const keepPin = mode !== 'verify' && before.mode !== 'verify';
  if (!keepPin) await secureRemove(id.reuse);
  const current = { mode, saved: keepPin && before.saved, biometric };
  await secureSet(id.prefs, current);
  return current;
}

export async function rememberOperationPin(scope: string, mode: OperationMode, pin: string): Promise<OperationAuth> {
  const id = await keys(scope);
  const before = await operationAuth(scope);
  if (before.mode !== mode || !validOperationPin(pin)) return before;
  const saved = mode !== 'verify';
  let biometric = before.biometric;
  if (saved) await secureSet(id.reuse, pin);
  if ((mode === 'verify' || biometric) && await biometricsAvailable()) {
    await secureSet(id.biometrics, pin);
    biometric = true;
  }
  const current = { mode, saved, biometric };
  await secureSet(id.prefs, current);
  return current;
}

export async function readOperationPin(scope: string, method: 'saved' | 'biometrics'): Promise<string | null> {
  const id = await keys(scope);
  return method === 'biometrics' ? secureGetWithBiometrics<string>(id.biometrics) : secureGet<string>(id.reuse);
}

export async function forgetOperationPin(scope: string): Promise<OperationAuth> {
  const id = await keys(scope);
  const { mode } = await operationAuth(scope);
  await secureRemove(id.reuse);
  await secureRemove(id.biometrics);
  const current = { mode, saved: false, biometric: false };
  await secureSet(id.prefs, current);
  return current;
}
