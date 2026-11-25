import { failureFacts, failureLabels, type FailureKind } from '../data/serviceFailure.ts';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

const arkNet = registerPlugin<{ request(options: {
  url: string; method: string; headers: Record<string, string>; body?: string; binary?: boolean; probe?: boolean;
}): Promise<{ status: number; data: string }> }>('LeapNet');

export const harmonyRequest = arkNet.request;

export class NetworkError extends Error {
  readonly status: number;
  constructor(status: number, kind?: FailureKind) {
    super(kind ? failureLabels[kind] + '。' : status === 0 ? '服务连接中断，请检查网络或服务地址。'
      : status === 401 || status === 403 ? '授权失效或无权读取。请重新连接。'
      : '服务暂不可用，请稍后重试。');
    this.status = status;
  }
}

export async function request<T>(url: string, options: {
  method?: 'GET' | 'POST';
  token?: string;
  body?: URLSearchParams;
  signal?: AbortSignal;
} = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = 'Bearer ' + options.token;
  if (options.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  try {
    if (Capacitor.getPlatform() === 'openharmony') {
      const response = await arkNet.request({ url, method, headers, body: options.body?.toString() });
      if (response.status < 200 || response.status >= 300) throw new NetworkError(response.status);
      return JSON.parse(response.data) as T;
    }
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.request({
        url, method, headers, data: options.body?.toString(), disableRedirects: true,
        connectTimeout: 10_000, readTimeout: 20_000, responseType: 'json',
      });
      if (response.status < 200 || response.status >= 300) throw new NetworkError(response.status);
      return (typeof response.data === 'string' ? JSON.parse(response.data) : response.data) as T;
    }
    const response = await fetch(url, {
      method, headers, body: options.body, redirect: 'error', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: options.signal ?? AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new NetworkError(response.status);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    if (options.signal?.aborted) throw error;
    const kind = error instanceof SyntaxError ? 'response' : failureFacts(error).kind;
    throw new NetworkError(0, kind === 'unknown' || kind === 'transport' ? undefined : kind);
  }
}
