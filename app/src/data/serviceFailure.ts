export const failureLabels = {
  dns: '域名解析失败', tls: '安全连接或证书校验失败', timeout: '请求超时',
  permission: '应用缺少网络权限', request: '原生网络请求参数无效',
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
const harmonyKinds: Record<number, FailureKind> = {
  201: 'permission', 401: 'request', 2300001: 'request', 2300003: 'request',
  2300005: 'dns', 2300006: 'dns', 2300007: 'connection', 2300028: 'timeout',
  2300035: 'tls', 2300058: 'tls', 2300059: 'tls', 2300060: 'tls', 2300077: 'tls',
};
export function failureFacts(error: unknown): { kind: FailureKind; httpStatus?: number; businessCode?: number; nativeCode?: number } {
  if (error instanceof ServiceFailure) return { kind: error.kind, httpStatus: error.httpStatus, businessCode: error.businessCode };
  const value = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown; code?: unknown } : {};
  const native = [value.code, value.message, error].find(v => typeof v === 'string' && /^HARMONY_HTTP_\d{1,9}$/.test(v));
  if (typeof native === 'string') {
    const nativeCode = Number(native.slice('HARMONY_HTTP_'.length));
    return { kind: harmonyKinds[nativeCode] ?? 'transport', nativeCode };
  }
  const message = String(value.name ?? '') + ' ' + String(value.message ?? error ?? '');
  if (/unknownhost|unable to resolve host|enotfound|name not resolved|域名解析/i.test(message)) return { kind: 'dns' };
  if (/sslhandshake|certificate|certpath|cert_|ssl error|tls handshake/i.test(message)) return { kind: 'tls' };
  if (/timed?\s*out|timeout|超时/i.test(message)) return { kind: 'timeout' };
  if (/connectexception|failed to connect|network is unreachable|connection (?:refused|reset)|offline|not connected to the internet/i.test(message)) return { kind: 'connection' };
  if (/failed to fetch|load failed|networkerror|网络不可用/i.test(message)) return { kind: 'transport' };
  if (/enospc|quotaexceeded|no space left/i.test(message)) return { kind: 'storage' };
  return { kind: 'unknown' };
}

export const loginStages = {
  'sms-send': '发送验证码', 'sms-verify': '验证短信登录', 'vehicle-auth': '获取车辆服务授权',
  'vehicle-list': '读取授权车辆列表', 'session-store': '保存本机登录状态',
} as const;
export type LoginStage = keyof typeof loginStages;
export function loginFailureMessage(stage: LoginStage, facts: ReturnType<typeof failureFacts>) {
  if (stage === 'session-store') return '已通过账号验证，无法保存本机登录状态。';
  const reason = facts.kind === 'auth' && stage === 'sms-verify' ? '账号服务未通过验证，请检查验证码是否有效' : failureLabels[facts.kind];
  return loginStages[stage] + '失败。' + reason + (facts.nativeCode ? '（鸿蒙 ' + facts.nativeCode + '）' : '') + '。';
}
