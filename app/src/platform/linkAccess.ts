import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { failureFacts } from '../data/serviceFailure.ts';
import { harmonyRequest } from './network.ts';

const timeoutMs = 6000;

async function linkStatus(url: string, method: 'HEAD' | 'GET', signal: AbortSignal): Promise<number | 'opaque'> {
  const headers: Record<string, string> = method === 'GET' ? { Range: 'bytes=0-1023' } : {};
  if (Capacitor.getPlatform() === 'openharmony') {
    return (await harmonyRequest({ url, method, headers, probe: true })).status;
  }
  if (Capacitor.isNativePlatform()) {
    return (await CapacitorHttp.request({ url, method, headers, responseType: 'text',
      connectTimeout: timeoutMs, readTimeout: timeoutMs, disableRedirects: false })).status;
  }
  const options: RequestInit = { method, signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' };
  let response;
  try { response = await fetch(url, { ...options, headers }); }
  catch (error) {
    // A cross-origin page can be opened in a browser even when its status is hidden by CORS.
    if (signal.aborted || method !== 'HEAD') throw error;
    response = await fetch(url, { ...options, mode: 'no-cors' });
  }
  if (response.body) void response.body.cancel().catch(() => {});
  return response.type === 'opaque' ? 'opaque' : response.status;
}

export async function checkLinkAccess(url: string, packageFile = false): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    let status = await linkStatus(url, 'HEAD', signal);
    if (!packageFile && (status === 403 || status === 405 || status === 501)) {
      status = await linkStatus(url, 'GET', signal);
    }
    if (status === 'opaque') return '已收到响应，浏览器未提供状态码';
    if (status >= 200 && status < 300) return '可访问 · HTTP ' + status;
    if (status === 401 || status === 403 || status === 429) return '访问受限 · HTTP ' + status;
    if (status === 404 || status === 410) return '链接不存在 · HTTP ' + status;
    if (packageFile && (status === 405 || status === 501)) return '服务不支持预检，可尝试下载';
    return status > 0 ? '访问异常 · HTTP ' + status : '无法连接';
  } catch (error) {
    const kind = failureFacts(error).kind;
    if (kind === 'timeout' || signal.aborted) return '连接超时';
    if (kind === 'dns') return '无法连接 · 域名解析失败';
    if (kind === 'tls') return '无法连接 · 安全连接失败';
    return '无法连接，请检查网络或尝试其他入口';
  }
}
