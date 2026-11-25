import { failureFacts } from '../serviceFailure';
import { unzipSync } from 'fflate';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { LiveVehicleClient } from './LiveClient';
import { bytesToHex, sha256Hex } from './liveCrypto';
import { correctedC01Viewer, needsC01Viewer } from './c01Viewer';
import { diagnosticFamily, diagnosticYear } from '../modelDiagnostics';
import type { ModelTrace } from '../modelDiagnostics';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function writeAsset(base: string, name: string, bytes: Uint8Array): Promise<void> {
  const path = base + '/' + name;
  await Filesystem.writeFile({ path, data: toBase64(bytes), directory: Directory.Data, recursive: true });
}

async function exists(path: string): Promise<boolean> {
  try { await Filesystem.stat({ path, directory: Directory.Data }); return true; } catch { return false; }
}

export interface PaintColor { tsp: string; name: string; hex: string }
type ModelMeta = { colors: PaintColor[]; defaultColor: string; params: string; viewerSha256?: string };
export interface Cloud3DResult extends ModelMeta { url: string; webId?: string; document?: string }
const cacheVersion = 'cloud3d-v6';
const assetRoot = () => new URL(import.meta.env.BASE_URL + 'viewer/', location.href);
const viewerFiles = [['view.js', 'text/javascript']] as const;
const cacheId = async (vehicleId: string) => (await sha256Hex(vehicleId)).slice(0, 24);

function parsePaintColors(csv: string): PaintColor[] {
  const lines = csv.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim());
  if (!lines.length) return [];
  const head = lines[0]!.split(',').map((cell) => cell.trim().replace(/^\uFEFF/, ''));
  const nameIdx = head.indexOf('Desc');
  const tspIdx = head.indexOf('id_TSP');
  const hexIdx = head.indexOf('ColorValue');
  if (nameIdx < 0 || tspIdx < 0 || hexIdx < 0) return [];
  const out: PaintColor[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    if (cols.length <= Math.max(nameIdx, tspIdx, hexIdx)) continue;
    const tsp = cols[tspIdx]!.trim();
    const name = cols[nameIdx]!.trim();
    const hex = cols[hexIdx]!.trim();
    if (!tsp || !name || !/^#[0-9a-f]{6}$/i.test(hex)) continue;
    out.push({ tsp, name, hex: hex.toUpperCase() });
  }
  return out;
}

function zipName(name: string) {
  if (/[\x80-\xff]/.test(name) && [...name].every(char => char.charCodeAt(0) <= 255)) {
    const bytes = Uint8Array.from(name, char => char.charCodeAt(0));
    for (const encoding of ['utf-8', 'gb18030']) {
      try { return new TextDecoder(encoding, { fatal: true }).decode(bytes).replaceAll('\\', '/'); } catch { /* try the next encoding */ }
    }
  }
  return name.replaceAll('\\', '/');
}

async function unpack(blob: ArrayBuffer) {
  let bytes = new Uint8Array(blob);
  if (bytes[0] === 31 && bytes[1] === 139) {
    bytes = new Uint8Array(await new Response(new Blob([blob]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error('零跑云没有返回有效的 3D 素材包。');
  let size = 0;
  const files = unzipSync(bytes, { filter: entry => {
    const path = zipName(entry.name);
    if (path.startsWith('/') || path.endsWith('/') || path.startsWith('__MACOSX/') || path.includes(':') || path.split('/').some(part => !part || part === '..' || part === '.')) return false;
    size += entry.originalSize;
    if (size > 180_000_000) throw new Error('3D 素材包过大。');
    return true;
  } });
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [zipName(name), data]));
}

function viewerParameters(model: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [source, target] of Object.entries({ carType: 'car', year: 'year', carTypeCode: 'trim', colorCode: 'color',
    seat: 'seat', roofColor: 'roof', sdkVersion: 'sdk', theme: 'theme', alias: 'alias', radius: 'radius', offset: 'offset' })) {
    const value = model[source];
    if (typeof value === 'string' || typeof value === 'number') params.set(target, String(value));
  }
  if (model.carType === 'B05' && !params.has('alias')) params.set('alias', /ultra/i.test(String(model.carTypeCode)) ? 'Lafa5Ultra' : 'Lafa5');
  return params;
}

async function webCache(id: string) {
  if (!globalThis.caches) throw new Error('当前浏览器无法缓存 3D 素材。');
  const root = assetRoot();
  const base = new URL('cloud/' + id + '/', root);
  const cache = await caches.open(cacheVersion + '-' + id);
  const urlFor = (file: string) => new URL(file.split('/').map(encodeURIComponent).join('/'), base);
  return { base, cache, urlFor };
}

export async function dropCloud3D(vehicleId: string) {
  const id = await cacheId(vehicleId);
  if (Capacitor.isNativePlatform()) {
    const base = cacheVersion + '/' + id;
    if (await exists(base)) await Filesystem.rmdir({ path: base, directory: Directory.Data, recursive: true });
  } else if (globalThis.caches) await caches.delete(cacheVersion + '-' + id);
}

export async function sendViewerAssets(target: Window, id: string, params: string) {
  const { cache, urlFor } = await webCache(id);
  const unusedViewer = new URLSearchParams(params).get('c01Compat') === '1' ? 'index.js' : 'index.c01-v1.js';
  const overrides = new Set(['view.html', 'manifest.json', unusedViewer, ...viewerFiles.map(([file]) => file)].map(file => urlFor(file).pathname));
  const assets = (await cache.keys()).filter(request => !overrides.has(new URL(request.url).pathname));
  const stored = assets.map(async request => {
    const response = await cache.match(request);
    if (!response) throw new Error('缓存车模不完整。');
    return [new URL(request.url).pathname, await response.arrayBuffer(), response.headers.get('Content-Type')] as const;
  });
  const shipped = viewerFiles.map(async ([file, type]) => {
    const response = await fetch(new URL(file, assetRoot()), { cache: 'no-cache' });
    if (!response.ok) throw new Error('无法读取 3D 查看器。');
    return [urlFor(file).pathname, await response.arrayBuffer(), type] as const;
  });
  const files = await Promise.all([...stored, ...shipped]);
  target.postMessage({ t: 'viewer-assets', files, params }, '*', files.map(([, buffer]) => buffer));
}

export async function prepareCloud3D(client: LiveVehicleClient, vehicleId: string, onProgress?: (text: string) => void, signal?: AbortSignal, trace?: ModelTrace, checkCachedManifest = false): Promise<Cloud3DResult> {
  trace?.('cache');
  const id = await cacheId(vehicleId);
  const web = Capacitor.isNativePlatform() ? null : await webCache(id);
  const nativeBase = cacheVersion + '/' + id;
  const uri = web ? web.urlFor('view.html').href : Capacitor.convertFileSrc((await Filesystem.getUri({ path: nativeBase + '/view.html', directory: Directory.Data })).uri);
  const metaPath = nativeBase + '/manifest.json';
  const asset = async (file: string) => {
    const response = await fetch(new URL(file, assetRoot()), { signal });
    if (!response.ok) throw new Error('无法读取 3D 查看器。');
    return response;
  };
  const type = (name: string) => ({ js: 'text/javascript', html: 'text/html', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    svg: 'image/svg+xml', css: 'text/css', json: 'application/json', wasm: 'application/wasm', csv: 'text/csv' })[name.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream';
  const write = async (name: string, data: Uint8Array) => {
    signal?.throwIfAborted();
    if (web) await web.cache.put(web.urlFor(name), new Response(new Blob([Uint8Array.from(data)], { type: type(name) })));
    else await writeAsset(nativeBase, name, data);
  };
  const readViewer = async () => {
    if (web) {
      const response = await web.cache.match(web.urlFor('index.js'));
      if (!response) throw new Error('缓存车模缺少查看器。');
      return new Uint8Array(await response.arrayBuffer());
    }
    const { data } = await Filesystem.readFile({ path: nativeBase + '/index.js', directory: Directory.Data });
    return typeof data === 'string' ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : new Uint8Array(await data.arrayBuffer());
  };
  const result = async (meta: ModelMeta, downloadedViewer?: Uint8Array): Promise<Cloud3DResult> => {
    const query = new URLSearchParams(meta.params);
    const car = query.get('car');
    let original = downloadedViewer;
    if (!meta.viewerSha256 || !/^[0-9a-f]{64}$/.test(meta.viewerSha256)) {
      original ??= await readViewer();
      meta.viewerSha256 = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(original))));
    }
    const compatible = needsC01Viewer(car, meta.viewerSha256);
    if (compatible) {
      const name = 'index.c01-v1.js';
      if (downloadedViewer || !(web ? await web.cache.match(web.urlFor(name)) : await exists(nativeBase + '/' + name))) {
        const corrected = correctedC01Viewer(original ?? await readViewer());
        await write(name, corrected);
      }
      query.set('c01Compat', '1');
    }
    trace?.('viewerBuild', { viewerSha256: meta.viewerSha256, c01Compat: compatible, family: diagnosticFamily(car), year: diagnosticYear(query.get('year')) });
    const params = query.toString();
    const base = { ...meta, params, url: uri + '?' + params };
    if (!web) {
      await Promise.all(['view.html', ...viewerFiles.map(([file]) => file)].map(async file => {
        const wrapper = await (await asset(file)).arrayBuffer();
        signal?.throwIfAborted();
        await writeAsset(nativeBase, file, new Uint8Array(wrapper));
      }));
      return base;
    }
    const [html, bootstrap] = await Promise.all(['view.html', 'isolated.js'].map(file => asset(file).then(response => response.text())));
    const document = html
      .replace('<meta charset="utf-8">', '<meta charset="utf-8"><base href="' + web.base.href + '"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' blob: \'unsafe-eval\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data: blob:; connect-src data: blob:; worker-src blob:">')
      .replace(/<script type="module"[^>]*><\/script>/, () => '<script>' + bootstrap + '</script>');
    return { ...base, webId: id, document };
  };
  const cached = web ? await web.cache.match(web.urlFor('manifest.json')).then(response => response?.json()) :
    await Filesystem.readFile({ path: metaPath, directory: Directory.Data, encoding: Encoding.UTF8 }).then(value => JSON.parse(String(value.data))).catch(() => null);
  if (cached?.params && typeof cached.params === 'string' && (web || await exists(nativeBase + '/view.html'))) {
    trace?.('hit');
    if (checkCachedManifest) {
      await client.get3DManifest(vehicleId, trace).catch(error => trace?.('manifestCheckError', failureFacts(error)));
      signal?.throwIfAborted();
    }
    return result(cached);
  }
  onProgress?.('下载 3D 素材包…');
  const { h5, src, modelParam } = await client.get3DPackages(vehicleId, trace);
  signal?.throwIfAborted();
  onProgress?.('解压 3D 素材…');
  trace?.('unpackH5');
  const viewerEntries = await unpack(h5);
  trace?.('unpackSrc');
  const files = { ...viewerEntries, ...await unpack(src) };
  const params = viewerParameters(modelParam);
  const modelDir = `${params.get('alias') || params.get('car')}_${params.get('year')}/`;
  const modelFiles = Object.keys(files).filter(name => name.startsWith(modelDir) && name.endsWith('_car.fbx'));
  trace?.('files', { hasViewer: !!files['index.js'], hasWorker: !!files['FBX.worker.js'], matchesDirectory: modelFiles.length > 0,
    hasStarter: modelFiles.some(name => name.endsWith('_starter_car.fbx')), hasFull: modelFiles.some(name => name.endsWith('_full_car.fbx')) });
  if (!files['index.js'] || !modelFiles.length) {
    throw new Error('下载的 3D 素材缺少本车模型或查看器。');
  }
  const csv = Object.entries(files).find(([name]) => name.startsWith(modelDir) && name.endsWith('CarPaintConfig.csv'))?.[1];
  const colors = csv ? parsePaintColors(new TextDecoder().decode(csv)) : [];
  const defaultColor = colors.find(c => c.tsp === params.get('color'))?.hex ?? '';
  const meta: ModelMeta = { colors, defaultColor, params: params.toString() };
  delete files['manifest.json'];
  delete files['view.js'];
  delete files['view.html'];
  delete files['index.c01-v1.js'];
  trace?.('store');
  for (const [name, data] of Object.entries(files)) await write(name, data);
  const prepared = await result(meta, files['index.js']);
  await write('manifest.json', new TextEncoder().encode(JSON.stringify(meta)));
  return prepared;
}
