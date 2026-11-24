import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { exchange, normalizeAddress } from './client.ts';

interface AuthBridge {
  begin(options: { state: string }): Promise<{ redirect: string }>;
  take(): Promise<{ url?: string }>;
  open(options: { url: string }): Promise<void>;
}
const bridge = registerPlugin<AuthBridge>('LeapAuth');
const key = 'leapmore.auth.pending';
const nativeCallback = 'com.leapmore.app://ha-auth';
interface Pending { server: string; client: string; redirect: string; state: string; verifier: string; at: number }
let pendingNative: Pending | null = null;

function randomString() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
}
function base64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function beginAuth(address: string) {
  const server = normalizeAddress(address);
  const state = randomString();
  const verifier = randomString();
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const native = Capacitor.isNativePlatform();
  const clientOverride = import.meta.env.VITE_HA_CLIENT_ID;
  const redirect = native
    ? clientOverride ? nativeCallback : (await bridge.begin({ state })).redirect
    : new URL('ha-callback.html', document.baseURI).href;
  const client = native && clientOverride ? clientOverride : new URL('/', redirect).href;
  const pending = { server, state, verifier, redirect, client, at: Date.now() };
  if (native) pendingNative = pending;
  else sessionStorage.setItem(key, JSON.stringify(pending));
  const url = new URL(server + '/auth/authorize');
  url.search = new URLSearchParams({
    client_id: client, redirect_uri: redirect, response_type: 'code', state,
    code_challenge_method: 'S256', code_challenge: challenge,
  }).toString();
  if (Capacitor.getPlatform() === 'openharmony') await bridge.open({ url: url.href });
  else if (native) await Browser.open({ url: url.href });
  else location.assign(url.href);
}

export async function consumeAuth(callback: URL) {
  const native = Capacitor.isNativePlatform();
  const pending: Pending | null = native ? pendingNative : JSON.parse(sessionStorage.getItem(key) ?? 'null');
  const callbackBase = callback.protocol + '//' + callback.host + callback.pathname;
  if (!pending || pending.redirect !== callbackBase || callback.searchParams.get('state') !== pending.state
    || Date.now() - pending.at > 600_000) throw new Error('授权回调无法校验，请重新发起登录。');
  if (native) pendingNative = null;
  else sessionStorage.removeItem(key);
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('授权已取消，请重新连接。');
  const token = await exchange(pending.server, new URLSearchParams({
    grant_type: 'authorization_code', code, client_id: pending.client, redirect_uri: pending.redirect,
    code_verifier: pending.verifier,
  }));
  return { token, server: pending.server };
}

export async function observeNativeCallback(onCallback: (url: URL) => void) {
  if (Capacitor.getPlatform() === 'openharmony') {
    let active = true, reading = false;
    const take = async () => {
      if (!pendingNative || reading || document.hidden) return;
      reading = true;
      try {
        const result = await bridge.take();
        if (result.url && active) onCallback(new URL(result.url));
      } catch { /* 浏览器仍在前台或授权已取消。 */ }
      finally { reading = false; }
    };
    const timer = setInterval(() => void take(), 1000);
    document.addEventListener('visibilitychange', take);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', take); };
  }
  let taking = false;
  const take = async () => {
    if (!pendingNative || taking || import.meta.env.VITE_HA_CLIENT_ID) return;
    taking = true;
    try {
      const result = await bridge.take();
      if (result.url && pendingNative) onCallback(new URL(result.url));
    } catch { /* The authorization browser can still be open. */ }
    finally { taking = false; }
  };
  const listeners = await Promise.all([
    App.addListener('appUrlOpen', event => {
      if (!pendingNative) return;
      const callback = new URL(event.url);
      if (callback.protocol !== 'com.leapmore.app:' || callback.hostname !== 'ha-auth') return;
      if (import.meta.env.VITE_HA_CLIENT_ID) onCallback(callback);
      else void take();
    }),
    App.addListener('appStateChange', state => { if (state.isActive) void take(); }),
    Browser.addListener('browserFinished', take),
  ]);
  return () => Promise.all(listeners.map(listener => listener.remove()));
}
