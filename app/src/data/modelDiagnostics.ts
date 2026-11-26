import { failureLabels, type FailureKind } from './serviceFailure.ts';
import md5 from 'blueimp-md5';
import { readSetting, saveSetting } from './localDatabase.ts';

export const diagnosticSteps = {
  cache: '检查本机缓存', hit: '使用已缓存素材', key: '请求素材清单', fallback: '改用备用参数请求清单',
  manifest: '收到素材清单', unavailable: '清单缺少 3D 素材参数',
  h5: '下载查看器包', src: '下载本车模型包', received: '收到素材包',
  unpackH5: '解压查看器包', unpackSrc: '解压本车模型包', files: '检查模型目录与文件',
  store: '写入素材缓存', viewerBuild: '识别查看器版本', prepared: '素材准备就绪', failed: '素材准备失败', cancelled: '加载已取消',
  manifestCheckError: '缓存命中，在线清单复查失败', boot: '查看器脚本已启动',
  glCreate: 'WebGL 上下文创建失败', glLost: 'WebGL 上下文已丢失',
  viewer: '启动查看器', first: '收到首帧', full: '收到完整模型回执', ready: '完整车模已显示',
  simplified: '仅收到简化模型', firstTimeout: '查看器等待首帧超时', timeout: '等待完整车模就绪超时',
  moduleError: '查看器缺少 CarModelModules', scriptError: '查看器运行异常', transferError: '向查看器传送素材失败',
} as const;
type Step = keyof typeof diagnosticSteps;
type Facts = {
  kind?: FailureKind; businessCode?: number; modelType?: number; modelVersion?: string; hasH5Key?: boolean; hasSrcKey?: boolean; hasCarType?: boolean; hasYear?: boolean;
  family?: string; year?: number; bytes?: number; format?: 'zip' | 'gzip' | 'other';
  hasViewer?: boolean; hasWorker?: boolean; hasStarter?: boolean; hasFull?: boolean; matchesDirectory?: boolean;
  viewerSha256?: string; c01Compat?: boolean; httpStatus?: number; elapsedMs?: number;
};
export type DiagnosticEvent = { step: Step; at: number; facts?: Facts };
export type DiagnosticRun = { id: string; at: number; events: DiagnosticEvent[] };
export type ModelTrace = (step: Step, facts?: Facts) => void;
export function viewerDiagnosticStep(data: { t?: unknown; full?: unknown; kind?: unknown; msg?: unknown }): Step | undefined {
  switch (data.t) {
    case 'viewer-boot': return 'boot';
    case 'first': return 'first';
    case 'full': return 'full';
    case 'ready': return data.full === true ? 'ready' : undefined;
    case 'runtime-error':
      if (data.kind === 'webgl-create') return 'glCreate';
      if (data.kind === 'webgl-lost') return 'glLost';
      return data.kind === 'missing-modules' ? 'moduleError' : 'scriptError';
    case 'err':
      if (data.msg === '完整模型未就绪，当前显示简化车模') return 'simplified';
      if (data.msg === '车模加载超时，请导出诊断检查素材完整性') return 'firstTimeout';
      return 'scriptError';
    default: return undefined;
  }
}

export function modelFinding(run: DiagnosticRun) {
  const last = run.events.at(-1);
  if (!last) return '准备检测';
  const viewerStart = run.events.map(event => event.step).lastIndexOf('viewer');
  const rendering = run.events.slice(Math.max(0, viewerStart));
  if (last.step === 'ready') return diagnosticSteps.ready;
  if (viewerStart >= 0 && ['timeout', 'firstTimeout', 'scriptError', 'simplified'].includes(last.step)) {
    const evidence = rendering.find(e => ['glCreate', 'glLost', 'moduleError', 'scriptError'].includes(e.step));
    if (evidence) return diagnosticSteps[evidence.step];
  }
  if (last.step === 'timeout') {
    const first = rendering.some(e => e.step === 'first'), full = rendering.some(e => e.step === 'full');
    if (first && !full) return '已收到首帧，缺少完整模型回执';
    if (full && !first) return '已收到完整模型回执，缺少首帧';
  }
  if (last.step === 'failed') {
    const previous = run.events.at(-2);
    const manifest = [...run.events].reverse().find(e => e.step === 'manifest')?.facts;
    if (previous?.step === 'unavailable' && manifest?.modelType === 2) return '云端本次仅返回 2D 素材';
    if (previous?.step === 'unavailable' && manifest?.modelType === 1) return '云端本次未提供车模素材';
    if (previous?.step === 'unavailable' && manifest) return '云端清单缺少' + [
      !manifest.hasCarType && '车型', !manifest.hasYear && '年款', !manifest.hasH5Key && '查看器包参数', !manifest.hasSrcKey && '模型包参数',
    ].filter(Boolean).join('、');
    if (last.facts?.kind && last.facts.kind !== 'unknown') return (previous ? diagnosticSteps[previous.step] + ' · ' : '') + failureLabels[last.facts.kind];
    if (previous?.step === 'files') return previous.facts?.hasViewer ? '素材包内缺少对应车型的模型文件' : '素材包内缺少查看器';
    if (previous?.step === 'received' && previous.facts?.httpStatus) return '素材下载失败（HTTP ' + previous.facts.httpStatus + '）';
    if (previous) return diagnosticSteps[previous.step] + ' · 失败';
  }
  return diagnosticSteps[last.step];
}
export function diagnosticFamily(value: unknown) {
  return typeof value === 'string' ? /(?:^|[^A-Z0-9])([ABCDT]\d{2}|S01|LAFA5(?:ULTRA)?)(?=$|[^A-Z0-9])/i.exec(value.trim())?.[1].toUpperCase() : undefined;
}
export function diagnosticYear(value: unknown) {
  return /^\d{4}$/.test(String(value)) ? Number(value) : undefined;
}

const memory = new Map<string, DiagnosticRun[]>();
const listeners = new Set<() => void>();
const empty: DiagnosticRun[] = [];
const storageKey = (scope: string) => 'modelDiagnostic.v1.' + md5(scope);
export function diagnosticRuns(scope: string) {
  if (!scope) return empty;
  let runs = memory.get(scope);
  if (!runs) {
    const saved = readSetting<DiagnosticRun[]>(storageKey(scope), []);
    runs = Array.isArray(saved) ? saved.filter(run => run && Array.isArray(run.events)).slice(0, 3) : [];
    memory.set(scope, runs);
  }
  return runs;
}
export function subscribeDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function save(scope: string, runs: DiagnosticRun[]) {
  memory.set(scope, runs);
  try { saveSetting(storageKey(scope), runs); } catch { /* Keep diagnostics available for export in this session. */ }
  for (const listener of listeners) listener();
}
export function startModelTrace(scope: string) {
  const at = Date.now();
  const id = at.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  save(scope, [{ id, at, events: [] }, ...diagnosticRuns(scope)].slice(0, 3));
  const record: ModelTrace = (step, facts) => {
    const runs = diagnosticRuns(scope);
    const run = runs.find(row => row.id === id);
    if (!run) return;
    const event = { step, at: Date.now(), facts };
    // Preserve the initial manifest and package checks even after multiple viewer mounts.
    const events = run.events.length < 48 ? [...run.events, event] : [...run.events.slice(0, 20), ...run.events.slice(-27), event];
    save(scope, runs.map(row => row === run ? { ...run, events } : row));
  };
  return Object.assign(record, { id });
}

export function diagnosticCsv(environment: Record<string, string>, runs: DiagnosticRun[]) {
  const rows: (string | number)[][] = [['section', 'time', 'elapsed_ms', 'event', 'details']];
  for (const [key, value] of Object.entries(environment)) rows.push(['environment', '', '', key, value]);
  for (const [index, run] of runs.entries()) {
    for (const event of run.events) rows.push(['load_' + (index + 1), new Date(event.at).toISOString(),
      Math.max(0, event.at - run.at), event.step, JSON.stringify(event.facts ?? {})]);
  }
  const cell = (value: string | number) => '"' + String(value).replaceAll('"', '""') + '"';
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function diagnosticText(environment: Record<string, string>, runs: DiagnosticRun[]) {
  const lines = ['LeapMore 诊断报告', '', '设备与服务'];
  for (const [key, value] of Object.entries(environment)) lines.push(key + '  ' + value);
  runs.forEach((run, index) => {
    lines.push('', '车模检测 ' + (index + 1) + '  ' + new Date(run.at).toISOString(), modelFinding(run));
    for (const event of run.events) {
      const elapsed = Math.max(0, event.at - run.at);
      lines.push('  +' + elapsed + ' ms  ' + diagnosticSteps[event.step] + (event.facts ? '  ' + JSON.stringify(event.facts) : ''));
    }
  });
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
