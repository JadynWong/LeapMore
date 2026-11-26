import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { ACCOUNT_BASE, CAR_BASE, GLOBAL_HOST } from '../data/cloud/liveCrypto';
import { requestJson } from '../data/cloud/liveHttp';
import { attachLoginNetwork, rememberFailure } from '../data/readDiagnostics';
import { failureFacts, failureLabels, type LoginStage } from '../data/serviceFailure';
import { abortCompatibility } from './abortCompatibility';
import { nativeSettings } from './settings';

export function recordLoginFailure(scope: string, operation: 'sms' | 'login', error: unknown, stage: LoginStage) {
  const harmony = Capacitor.getPlatform() === 'openharmony';
  const entry = rememberFailure(scope, operation, error, stage, harmony ? { webViewOnline: navigator.onLine } : undefined);
  if (harmony && entry) {
    void nativeSettings.diagnosticEnvironment().then(({ activeNetwork, validated, networkInfoError }) => {
      attachLoginNetwork(scope, operation, entry, { sampledAt: new Date().toISOString(), activeNetwork, validated, networkInfoError });
    }).catch(() => {});
  }
}

export async function runtimeFacts(): Promise<Record<string, string>> {
  const platform = Capacitor.getPlatform();
  const ua = navigator.userAgent;
  const facts: Record<string, string> = {
    platform, version: __LEAPMORE_VERSION__, build: __LEAPMORE_BUILD__, versionSource: 'bundle',
    os: ua.match(/(?:Android |(?:iPhone |CPU )OS |Windows NT |Mac OS X )\d+(?:[._]\d+){0,3}/)?.[0] ?? 'unknown',
    osSource: 'userAgent', browserEngine: ua.match(/(?:Chrome|Firefox|AppleWebKit)\/\d+(?:\.\d+){0,3}/g)?.at(-1) ?? 'unknown',
    networkSource: 'webview', webViewOnline: String(navigator.onLine ?? 'unknown'),
    network: typeof navigator.onLine !== 'boolean' ? 'unknown' : navigator.onLine ? 'online' : 'offline',
    abortCheckFallback: String(abortCompatibility.check), abortTimeoutFallback: String(abortCompatibility.timeout),
    webGLApi: String(typeof WebGLRenderingContext !== 'undefined'), webGL2Api: String(typeof WebGL2RenderingContext !== 'undefined'),
    webCrypto: String(!!globalThis.crypto?.subtle), secureContext: String(globalThis.isSecureContext),
    workerApi: String(typeof Worker !== 'undefined'), wasmApi: String(typeof WebAssembly !== 'undefined'),
  };
  if (Capacitor.isNativePlatform()) {
    const [app, system] = await Promise.all([
      App.getInfo().catch(() => null),
      platform === 'android' || platform === 'openharmony' ? nativeSettings.diagnosticEnvironment().catch(() => null) : null,
    ]);
    if (app?.version && app.build) Object.assign(facts, { version: app.version, build: app.build, versionSource: 'native' });
    if (platform === 'openharmony' && typeof system?.activeNetwork !== 'boolean') {
      Object.assign(facts, { network: 'unknown', networkSource: 'native-unavailable' });
    }
    if (system) {
      facts.os = system.os;
      facts.osSource = 'native';
      if (typeof system.activeNetwork === 'boolean') {
        facts.network = system.activeNetwork ? 'connected' : 'offline';
        facts.networkSource = 'native-default-network';
      }
      for (const key of ['sdk', 'webViewVersion', 'internetPermission', 'activeNetwork', 'wifi', 'cellular', 'ethernet', 'vpn', 'validated', 'captivePortal', 'networkInfoError'] as const) {
        if (system[key] !== undefined) facts[key] = String(system[key]);
      }
    }
  }
  return facts;
}

export const checkNames = { account: '账号服务连接', listHost: '车辆列表服务连接', carHost: '车况与素材服务连接', list: '读取授权车辆列表', state: '读取所选车辆车况' } as const;
export type CheckName = keyof typeof checkNames;
export type CheckResult = { result: string; at: string; durationMs: number; httpStatus?: number; businessCode?: number; nativeCode?: number };
export async function timedCheck(action: () => Promise<{ result: string; httpStatus?: number }>): Promise<CheckResult> {
  const started = Date.now();
  let result;
  try { result = await action(); }
  catch (error) {
    const { kind, ...codes } = failureFacts(error);
    result = { result: failureLabels[kind], ...codes };
  }
  return { ...result, at: new Date(started).toISOString(), durationMs: Math.max(0, Date.now() - started) };
}
const origins = { account: new URL(ACCOUNT_BASE).origin, listHost: GLOBAL_HOST, carHost: CAR_BASE };
export function probeHost(key: keyof typeof origins) {
  return timedCheck(async () => {
    const reply = await requestJson('GET', origins[key] + '/', { timeoutMs: 8000, probe: true });
    const httpStatus = Number(reply._status);
    return httpStatus >= 100 && httpStatus <= 599 ? { result: '已收到 HTTP 响应', httpStatus } : { result: '未收到 HTTP 状态码' };
  });
}
