import type { QuickHost } from './worker';
import { vehicleServiceOrigin } from '../../src/data/cloud/vehicleOrigin';
export { vehicleServiceOrigin };
declare const QuickHost: QuickHost;

export async function requestJson(method: string, url: string, init: {headers?: Record<string,string>; body?: string; timeoutMs?: number} = {}) {
  if (!vehicleServiceOrigin(new URL(url).origin)) throw new Error('车辆服务地址无效');
  const raw = QuickHost.http(JSON.stringify({ method, url, headers: init.headers ?? {}, body: init.body, timeout: Math.min(init.timeoutMs ?? 6000, 6000) }));
  const reply = JSON.parse(raw) as {status:number; body:string};
  if (!reply.status) throw new Error('网络不可用');
  try { return { ...JSON.parse(reply.body), _status: reply.status }; }
  catch { return { _raw: true, _status: reply.status }; }
}
export async function requestBinary(): Promise<ArrayBuffer> { throw new Error('快捷控制不读取文件'); }
