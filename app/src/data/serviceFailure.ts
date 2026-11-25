export const failureLabels = {
  dns: '域名解析失败', tls: '安全连接或证书校验失败', timeout: '请求超时',
  connection: '未能连接服务', transport: '未收到可读取的网络响应',
  auth: '零跑会话已失效', forbidden: '服务拒绝访问', rate: '零跑云限制查询频率',
  response: '服务返回的数据格式异常', service: '服务返回错误',
  empty: '云端本次未返回车况', mismatch: '云端返回的车况与所选车辆不匹配',
  storage: '本机存储空间不足', unknown: '读取失败，原因待确认',
} as const;
export type FailureKind = keyof typeof failureLabels;
export class ServiceFailure extends Error {
  readonly kind: FailureKind;
  readonly httpStatus?: number;
  readonly businessCode?: number;
  constructor(kind: FailureKind, httpStatus?: number, businessCode?: number) {
    super(failureLabels[kind]);
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.businessCode = businessCode;
  }
}
// Native errors can include credentials or a complete request URL. Only export these categories.
export function failureFacts(error: unknown): { kind: FailureKind; httpStatus?: number; businessCode?: number } {
  if (error instanceof ServiceFailure) return { kind: error.kind, httpStatus: error.httpStatus, businessCode: error.businessCode };
  const value = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown } : {};
  const message = String(value.name ?? '') + ' ' + String(value.message ?? error ?? '');
  if (/unknownhost|unable to resolve host|enotfound|name not resolved|域名解析/i.test(message)) return { kind: 'dns' };
  if (/sslhandshake|certificate|certpath|cert_|ssl error|tls handshake/i.test(message)) return { kind: 'tls' };
  if (/timed?\s*out|timeout|超时/i.test(message)) return { kind: 'timeout' };
  if (/connectexception|failed to connect|network is unreachable|connection (?:refused|reset)|offline|not connected to the internet/i.test(message)) return { kind: 'connection' };
  if (/failed to fetch|load failed|networkerror|网络不可用/i.test(message)) return { kind: 'transport' };
  if (/enospc|quotaexceeded|no space left/i.test(message)) return { kind: 'storage' };
  return { kind: 'unknown' };
}
