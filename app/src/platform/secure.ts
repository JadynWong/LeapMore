import { Capacitor, registerPlugin } from '@capacitor/core';
import { deleteLocalSecret, readLocalSecret, writeLocalSecret } from './localVault.ts';

interface VaultPlugin {
  get(options: { key: string }): Promise<{ value?: string } | undefined>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
  biometricsAvailable(): Promise<{ available: boolean }>;
  getWithBiometrics(options: { key: string }): Promise<{ value?: string } | undefined>;
}
const vault = registerPlugin<VaultPlugin>('LeapVault');
const memory = new Map<string, string>();

export const isNative = () => Capacitor.isNativePlatform();

export class LocalSessionStorageError extends Error {
  constructor() { super('无法保存本地会话，请检查浏览器的网站存储设置。'); }
}

export const usesLocalSessionVault = () => import.meta.env?.DEV && typeof location !== 'undefined'
  && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const persistLocally = (key: string) => usesLocalSessionVault()
  && (['leapmotor-session', 'ha-credential'].includes(key) || key.startsWith('remote-control:'));

export async function biometricsAvailable() {
  return isNative() && (await vault.biometricsAvailable().catch(() => ({ available: false }))).available;
}

export async function secureGetWithBiometrics<T>(key: string): Promise<T | null> {
  if (!isNative()) throw new Error('本机不支持系统生物识别。');
  const value = (await vault.getWithBiometrics({ key }))?.value;
  return value ? JSON.parse(value) as T : null;
}

export async function secureGet<T>(key: string): Promise<T | null> {
  const value = isNative() ? (await vault.get({ key }))?.value :
    persistLocally(key) ? await readLocalSecret(key) : memory.get(key);
  return value ? JSON.parse(value) as T : null;
}
export async function secureSet(key: string, value: unknown) {
  const data = JSON.stringify(value);
  if (isNative()) await vault.set({ key, value: data });
  else if (persistLocally(key)) {
    try { await writeLocalSecret(key, data); }
    catch { throw new LocalSessionStorageError(); }
  }
  else memory.set(key, data);
}
export async function secureRemove(key: string) {
  if (isNative()) await vault.remove({ key });
  else if (persistLocally(key)) await deleteLocalSecret(key);
  else memory.delete(key);
}
