import { JSEncrypt } from 'jsencrypt';

export const ACCOUNT_BASE = 'https://appuser.leapmotor.cn/app-user';
export const GLOBAL_HOST = 'https://app-gw-global-master.leapmotor.com';
export const GLOBAL_BASE = GLOBAL_HOST + '/app/app-global-service/';
export const CAR_BASE = 'https://appgateway.leapmotor.com';
export const APP_VERSION = '1.22.98';
export const APP_SUBVERSION = '3.21.3-2';
export const RSA_PUBLIC_KEY = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDHUIQKhkwNqJFTZPe98mC1lmpbY9r/+7PEWZg8ebqYXT3sumKRaQ0zcoTx42x0iybmCRXy4CcZrgGAbwKzwqwNw0rFquJ6c7mgQA6k3lZU3p96qBlzK7DSkoFR6mO9pjcd2hlJ8wH+IwI5b8IWWZhwVN/4cM7npG0S0zeRn3soEwIDAQAB';

export function randomDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function rsaEncryptPhone(phone: string): string {
  const enc = new JSEncrypt();
  enc.setPublicKey('-----BEGIN PUBLIC KEY-----\n' + RSA_PUBLIC_KEY + '\n-----END PUBLIC KEY-----');
  const out = enc.encrypt(phone);
  if (!out) throw new Error('手机号加密失败');
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function b64urlToBytes(text: string): Uint8Array {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function sortAndConcat(values: Record<string, unknown>): string {
  return Object.keys(values).sort().map((k) => String(values[k])).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(keyHex: string, text: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  const raw = await crypto.subtle.importKey('raw', keyBytes.buffer.slice(0) as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', raw, new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(sig));
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function deriveHkdfKeyHex(carToken: string, signParam: { r2?: string; r3?: string }): string {
  const parts = carToken.split('.');
  const sigPart = parts[2];
  if (parts.length !== 3 || !sigPart) throw new Error('车端 token 不是 JWT');
  const r2 = signParam.r2 ? b64urlToBytes(signParam.r2) : new Uint8Array();
  const r3 = signParam.r3 ? b64urlToBytes(signParam.r3) : new Uint8Array();
  const sig = b64urlToBytes(sigPart);
  const n = Math.min(r2.length, r3.length, sig.length);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = r2[i]! ^ r3[i]! ^ sig[i]!;
  return bytesToHex(out);
}

export function getOrCreateDeviceId(): string {
  try {
    const saved = localStorage.getItem('leapmore.deviceId');
    if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
    const id = randomDeviceId();
    localStorage.setItem('leapmore.deviceId', id);
    return id;
  } catch {
    return randomDeviceId();
  }
}
