import { request } from '../../platform/network';

export type MarketEnergy = '纯电' | '增程';
export interface MarketColor { color: string; url: string }
export interface MarketVariant {
  id: string;
  year: string;
  trim: string;
  energy: MarketEnergy;
  image?: string;
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
// Some releases are only published by one of the catalogue services.
function catalogueReader(signal?: AbortSignal) {
  let failure: unknown;
  return {
    async read(url: string) {
      try {
        const data = await request<unknown>(url, { signal });
        signal?.throwIfAborted();
        return records(data);
      } catch (error) {
        signal?.throwIfAborted();
        failure = error;
        return {};
      }
    },
    checkEmpty(count: number) { if (!count && failure) throw failure; },
  };
}

export async function fetchMarketModels(signal?: AbortSignal) {
  const data = await catalogueReader(signal).read(catalog);
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
  for (const model of ['C01', 'C10', 'C11', 'C16', 'B01', 'B10', 'A10', 'A05', 'T03', 'Lafa5', 'S01']) if (!models.has(model)) models.set(model, model);
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
  const image = trustedImage(row.carTypeImgsDemo) ?? trustedImage(row.carTypeImgs);
  return id && year && trim && energy ? { id, year, trim, energy, provider, image } : null;
}

const historicalC11 = query(config, { carType: 'C11-230801' });

export async function fetchMarketVariants(model: string, code: string, signal?: AbortSignal, year?: string): Promise<MarketVariant[]> {
  const { read, checkEmpty } = catalogueReader(signal);
  const variants = new Map<string, MarketVariant>();
  const resource = records((await read(query(mall + '/mallResourceConfig/getByCode', { code }))).data);
  const fallback = resource.carType ? {} : records((await read(query('https://apptec.leapmotor.cn/app-community/resourceConfig/getByCode', { code }))).data);
  const carType = string(resource.carType ?? fallback.carType);
  function add(row: Record<string, unknown>, provider: MarketVariant['provider'], hint?: string) {
    const item = variant(row, model, provider, hint);
    if (item && (!year || item.year === year) && !variants.has(item.id)) variants.set(item.id, item);
  }
  if (carType) {
    const [current, previous] = await Promise.all([
      read(query(mall + '/vehicleProduct/getVehicleModelSeatListV4', { carType, platform: '3' })),
      read(query(mall + '/vehicleProduct/getVehicleModelSeatList', { carType })),
    ]);
    for (const row of list(records(current.data).modelList)) add(row, 'v4');
    for (const group of list(previous.data)) {
      for (const [field, rows] of Object.entries(group)) {
        const hint = /extend|reev/i.test(field) ? '增程' : /pure|bev/i.test(field) ? '纯电' : '';
        for (const row of list(rows)) add(row, 'legacy', hint);
      }
    }
  }
  if (!variants.size) {
    const sale = await read(query(mall + '/vehicleSaleConfig/getSaleVehicleEdition', { carType: carType || code }));
    function collect(value: unknown, hint = '') {
      if (Array.isArray(value)) { for (const item of value) collect(item, hint); return; }
      const row = records(value);
      add(row, 'sale', hint);
      for (const [field, nested] of Object.entries(row)) collect(nested, /extend|reev/i.test(field) ? '增程' : /pure|bev/i.test(field) ? '纯电' : hint);
    }
    collect(sale.data);
  }
  if (!year && model.toUpperCase() === 'C11') {
    for (const item of Object.values(records((await read(historicalC11)).data))) {
      const row = records(item);
      const entry = variant({ ...row, vehicleYear: row.vehicleYear ?? row.carYear ?? row.year ?? '2023', vehicleModel: string(row.carName).replace(/^C11\s+/i, '') }, model, 'config', '纯电');
      if (entry && !variants.has(entry.id)) variants.set(entry.id, entry);
    }
  }
  checkEmpty(variants.size);
  return [...variants.values()].sort((a, b) => b.year.localeCompare(a.year));
}

export async function fetchMarketColors(variant: MarketVariant, signal?: AbortSignal): Promise<MarketColor[]> {
  const { read, checkEmpty } = catalogueReader(signal);
  const { provider, id, year, trim, energy } = variant;
  const endpoints = provider === 'legacy' ? ['getVehicleProductConfig', 'getVehicleProductConfigV4'] :
    ['getVehicleProductConfigV4', 'getVehicleProductConfig'];
  const urls = endpoints.map(endpoint => query(mall + '/vehicleProduct/' + endpoint, { carType: id }));
  if (provider === 'sale') urls.unshift(query(mall + '/vehicleSaleConfig/getSaleVehicleConfig', { carType: id }));
  if (provider === 'config') {
    const rows = records((await read(historicalC11)).data);
    const row = records(rows[id] ?? Object.values(rows).find(value => string(records(value).carType) === id));
    const palette = colors(row);
    if (palette.length) return palette;
  }
  for (const url of urls) {
    const product = records((await read(url)).data);
    if (product.vehicleYear && string(product.vehicleYear) !== year || product.vehicleModel && string(product.vehicleModel) !== trim) continue;
    const description = [product.vehicleSpecs, product.vehicleType].map(string).join(' ');
    if (/增程|REEV/i.test(description) && energy !== '增程' || /纯电|BEV/i.test(description) && energy !== '纯电') continue;
    const available = colors(product);
    if (available.length) return available;
  }
  if (variant.image) return [{ color: '车型外观', url: variant.image }];
  checkEmpty(0);
  return [];
}

function colors(product: Record<string, unknown>) {
  const out = new Map<string, MarketColor>();
  for (const row of list(product.outColor)) {
    const color = string(row.color);
    if (!color || out.has(color)) continue;
    for (const value of [row.appearanceCarImgs, row.slideshowImgsPc, row.slideshowImgsH5, row.image]) {
      const url = trustedImage(value);
      if (url) { out.set(color, { color, url }); break; }
    }
  }
  return [...out.values()];
}

function trustedImage(value: unknown) {
  try {
    const url = new URL(string(value));
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && imageHosts.has(url.hostname)) return url.href;
  } catch { /* Missing or unpublished image. */ }
  return undefined;
}
