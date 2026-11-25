import { request } from '../../platform/network';

export type MarketEnergy = '纯电' | '增程';
export interface MarketColor { color: string; url: string }
export interface MarketVariant {
  id: string;
  year: string;
  trim: string;
  energy: MarketEnergy;
  provider: 'v4' | 'legacy' | 'sale' | 'config';
}
const catalog = 'https://ueapp.oss-cn-hangzhou.aliyuncs.com/nativeApp/loveCar/love_car_default_header.txt';
const mall = 'https://carod-center.leapmotor.cn';
const config = 'https://www-app.leapmotor.com/vehicleMatching/getVehicleConfig';
const imageHosts = new Set([
  'lpmall-dop-prod.oss-cn-hangzhou.aliyuncs.com',
  'ueapp-oss-static.leapmotor.com',
  'ueapp-oss-static.leapmotor.cn',
  'lp-website-oss-static.leapmotor.com',
]);
const bevModels = new Set(['A05', 'A10', 'B01', 'B10', 'T03', 'LAFA5']);
const records = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown) => Array.isArray(value) ? value.map(records) : [];
const string = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const query = (endpoint: string, values: Record<string, string>) => endpoint + '?' + new URLSearchParams(values);
const read = (url: string, signal?: AbortSignal): Promise<Record<string, unknown>> => request<unknown>(url, { signal }).then(records).catch(error => {
  signal?.throwIfAborted();
  if (error instanceof Error) return {};
  throw error;
});

export async function fetchMarketModels(signal?: AbortSignal) {
  const data = await read(catalog, signal);
  const models = new Map<string, string>();
  for (const row of list(data.carIntroduction)) {
    const name = string(row.carName);
    if (!name) continue;
    for (const { jumpUrl } of list(row.actionButtons)) {
      try {
        const url = new URL(string(jumpUrl));
        if (url.origin !== 'https://www-app.leapmotor.cn' || url.pathname !== '/configuration-v4.html') continue;
        const code = url.searchParams.get('carCode');
        if (code) { models.set(name, code); break; }
      } catch { /* This action does not open an official configuration page. */ }
    }
  }
  for (const model of ['C01', 'T03', 'Lafa5', 'S01']) if (!models.has(model)) models.set(model, model);
  return [...models].map(([name, code]) => ({ name, code }));
}

function variant(row: Record<string, unknown>, model: string, provider: MarketVariant['provider'], energyHint = ''): MarketVariant | null {
  const id = string(row.carModel ?? row.skuVersion ?? row.skuCode ?? row.vehicleCode ?? row.carType);
  const year = string(row.vehicleYear ?? row.carYear ?? row.year)
    || /(?:^|\/)(20\d{2})[_-]/.exec(string(row.carTypeImgsDemo ?? row.carTypeImgs))?.[1]
    || /(?:^|\D)(20\d{2})(?:\D|$)/.exec(id)?.[1] || '';
  const trim = string(row.vehicleModel ?? row.carName ?? row.versionName ?? row.editionName ?? row.name);
  const description = [row.vehicleSpecs, row.vehicleType, trim].map(string).join(' ');
  const energy = /增程|REEV/i.test(description) ? '增程' : /纯电|BEV/i.test(description) ? '纯电' :
    energyHint === '增程' ? '增程' : energyHint === '纯电' || bevModels.has(model.toUpperCase()) ? '纯电' : null;
  return id && year && trim && energy ? { id, year, trim, energy, provider } : null;
}

async function historicalC11(signal?: AbortSignal) {
  return records((await read(query(config, { carType: 'C11-230801' }), signal)).data);
}

export async function fetchMarketVariants(model: string, code: string, signal?: AbortSignal, preferredYear?: number): Promise<MarketVariant[]> {
  const variants = new Map<string, MarketVariant>();
  async function collectVariants(code: string, year?: string) {
    const resource = records((await read(query(mall + '/mallResourceConfig/getByCode', { code }), signal)).data);
    const fallback = resource.carType ? {} : records((await read(query('https://apptec.leapmotor.cn/app-community/resourceConfig/getByCode', { code }), signal)).data);
    const carType = string(resource.carType ?? fallback.carType);
    const before = variants.size;
    function add(row: Record<string, unknown>, provider: MarketVariant['provider'], hint?: string) {
      const item = variant(row, model, provider, hint);
      if (item && (!year || item.year === year) && !variants.has(item.id)) variants.set(item.id, item);
    }
    if (carType) {
      const [current, previous] = await Promise.all([
        read(query(mall + '/vehicleProduct/getVehicleModelSeatListV4', { carType, platform: '3' }), signal),
        read(query(mall + '/vehicleProduct/getVehicleModelSeatList', { carType }), signal),
      ]);
      for (const row of list(records(current.data).modelList)) add(row, 'v4');
      for (const group of list(previous.data)) {
        for (const [field, rows] of Object.entries(group)) {
          const hint = /extend|reev/i.test(field) ? '增程' : /pure|bev/i.test(field) ? '纯电' : '';
          for (const row of list(rows)) add(row, 'legacy', hint);
        }
      }
    }
    if (before === variants.size) {
      const sale = await read(query(mall + '/vehicleSaleConfig/getSaleVehicleEdition', { carType: carType || code }), signal);
      function collect(value: unknown, hint = '') {
        if (Array.isArray(value)) { for (const item of value) collect(item, hint); return; }
        const row = records(value);
        add(row, 'sale', hint);
        for (const [field, nested] of Object.entries(row)) collect(nested, /extend|reev/i.test(field) ? '增程' : /pure|bev/i.test(field) ? '纯电' : hint);
      }
      collect(sale.data);
    }
  }
  await collectVariants(code);
  if (model.toUpperCase() === 'C11') {
    for (const item of Object.values(await historicalC11(signal))) {
      const row = records(item);
      const entry = variant({ ...row, vehicleYear: row.vehicleYear ?? row.carYear ?? row.year ?? '2023', vehicleModel: string(row.carName).replace(/^C11\s+/i, '') }, model, 'config', '纯电');
      if (entry && !variants.has(entry.id)) variants.set(entry.id, entry);
    }
  }
  const year = String(preferredYear ?? '');
  if (preferredYear && Number.isInteger(preferredYear) && ![...variants.values()].some(item => item.year === year)) await collectVariants(year + model, year);
  return [...variants.values()].sort((a, b) => b.year.localeCompare(a.year));
}

export async function fetchMarketColors(variant: MarketVariant, signal?: AbortSignal): Promise<MarketColor[]> {
  const { provider, id, year, trim, energy } = variant;
  const endpoints = provider === 'legacy' ? ['getVehicleProductConfig', 'getVehicleProductConfigV4'] :
    ['getVehicleProductConfigV4', 'getVehicleProductConfig'];
  const urls = endpoints.map(endpoint => query(mall + '/vehicleProduct/' + endpoint, { carType: id }));
  if (provider === 'sale') urls.unshift(query(mall + '/vehicleSaleConfig/getSaleVehicleConfig', { carType: id }));
  if (provider === 'config') {
    const rows = await historicalC11(signal);
    const row = records(rows[id] ?? Object.values(rows).find(value => string(records(value).carType) === id));
    return colors(row);
  }
  for (const url of urls) {
    const product = records((await read(url, signal)).data);
    if (product.vehicleYear && string(product.vehicleYear) !== year || product.vehicleModel && string(product.vehicleModel) !== trim) continue;
    const description = [product.vehicleSpecs, product.vehicleType].map(string).join(' ');
    if (/增程|REEV/i.test(description) && energy !== '增程' || /纯电|BEV/i.test(description) && energy !== '纯电') continue;
    const available = colors(product);
    if (available.length) return available;
  }
  return [];
}

function colors(product: Record<string, unknown>) {
  const out = new Map<string, MarketColor>();
  for (const row of list(product.outColor)) {
    const color = string(row.color);
    if (!color || out.has(color)) continue;
    for (const value of [row.appearanceCarImgs, row.slideshowImgsPc, row.slideshowImgsH5, row.image]) {
      try {
        const url = new URL(string(value));
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !imageHosts.has(url.hostname)) continue;
        out.set(color, { color, url: url.href });
        break;
      } catch { /* A color image may be unpublished. */ }
    }
  }
  return [...out.values()];
}
