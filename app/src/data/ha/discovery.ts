import { fields } from './schema.ts';
import type { Entity, EntityBinding, Field, Mapping } from './schema.ts';

export interface RegisteredEntity {
  entity_id: string;
  platform: string;
  device_id?: string | null;
  disabled_by?: string | null;
  translation_key?: string | null;
  unique_id?: string | null;
}

export interface RegisteredVehicle { device_id: string; vin: string; name?: string }
export interface DiscoveredVehicle { deviceId: string; vin: string; name?: string; mapping: Mapping }

const roles = {
  battery: { domain: 'sensor', fields: { soc: null, batteryMinTemp: 'battery_min_temp' } },
  range: { domain: 'sensor', fields: { range: null } },
  total_mileage: { domain: 'sensor', fields: { odometer: null } },
  delivery_days: { domain: 'sensor', fields: { deliveryDays: null } },
  vehicle_state: { domain: 'sensor', fields: { motion: null, speed: 'speed', windows: 'windows_open' } },
  charging_state: { domain: 'sensor', fields: { charge: null } },
  tracker: { domain: 'device_tracker', fields: { tracker: null } },
  lock: { domain: 'lock', fields: { locked: null } },
  trunk: { domain: 'switch', fields: { trunk: null } },
  sunshade: { domain: 'switch', fields: { sunshade: null } },
  interior_temp: { domain: 'sensor', fields: { inside: null, climate: 'climate_on' } },
  fuel_level: { domain: 'sensor', fields: { fuel: null } },
  fuel_range: { domain: 'sensor', fields: { fuelRange: null } },
  energy_rank: { domain: 'sensor', fields: { energyRank: null } },
  hundred_km_ec: { domain: 'sensor', fields: { rankEfficiency: null } },
  tire_fl: { domain: 'sensor', fields: { tireFL: null } },
  tire_fr: { domain: 'sensor', fields: { tireFR: null } },
  tire_rl: { domain: 'sensor', fields: { tireRL: null } },
  tire_rr: { domain: 'sensor', fields: { tireRR: null } },
} satisfies Record<string, { domain: string; fields: Partial<Record<Field, Exclude<EntityBinding, string>['attribute'] | null>> }>;

export const normalizedVin = (value?: string | null) => typeof value === 'string' ? value.trim().toUpperCase() : '';
const vinPattern = '[A-HJ-NPR-Z0-9]{17}';
const uniqueId = new RegExp(`^(${vinPattern})_(.+)$`, 'i');
const validVin = new RegExp(`^${vinPattern}$`);
export const isVehicleVin = (value?: string | null) => validVin.test(normalizedVin(value));
const stableId = (entry: RegisteredEntity) => typeof entry.unique_id === 'string' ? entry.unique_id.match(uniqueId) : null;
const roleOf = (entry: RegisteredEntity) => entry.translation_key || stableId(entry)?.[2];

export function discoverVehicles(entries: RegisteredEntity[], catalog: RegisteredVehicle[], states: Entity[]): DiscoveredVehicle[] {
  const stateById = new Map(states.map(state => [state.entity_id, state]));
  const devices = new Map<string, { vins: Set<string>; name?: string; entries: RegisteredEntity[] }>();
  for (const entry of catalog) {
    const vin = normalizedVin(entry?.vin);
    if (!entry?.device_id || !validVin.test(vin)) continue;
    const device = devices.get(entry.device_id);
    if (device) device.vins.add(vin);
    else devices.set(entry.device_id, { vins: new Set([vin]), name: entry.name, entries: [] });
  }
  for (const entry of entries) {
    if (entry?.platform !== 'leapmotor' || !entry.device_id || typeof entry.entity_id !== 'string') continue;
    const device = devices.get(entry.device_id) ?? { vins: new Set<string>(), entries: [] };
    const vin = stableId(entry)?.[1];
    if (vin) device.vins.add(normalizedVin(vin));
    device.entries.push(entry);
    devices.set(entry.device_id, device);
  }
  return Array.from(devices, ([deviceId, { vins, name, entries }]) => {
    const vin = vins.size === 1 ? [...vins][0] : '';
    const mapping: Mapping = {};
    const ambiguous = new Set<Field>();
    const isReev = entries.some(entry => {
      const key = roleOf(entry);
      return key === 'fuel_level' || key === 'fuel_range' || stateById.get(entry.entity_id)?.attributes?.reev === true;
    });
    for (const entry of entries) {
      const key = roleOf(entry);
      if (!vin || !key || !Object.hasOwn(roles, key) || entry.disabled_by || !stateById.has(entry.entity_id)) continue;
      if (key === 'range' && isReev) continue;
      const { domain, fields } = roles[key as keyof typeof roles];
      if (!entry.entity_id.startsWith(domain + '.')) continue;
      for (const [field, attribute] of Object.entries(fields) as [Field, Exclude<EntityBinding, string>['attribute'] | null][]) {
        if (mapping[field] !== undefined) ambiguous.add(field);
        else mapping[field] = attribute ? { entity: entry.entity_id, attribute } : entry.entity_id;
      }
    }
    for (const field of ambiguous) delete mapping[field];
    return { deviceId, vin, name, mapping };
  });
}

export function vehicleByVin(vehicles: DiscoveredVehicle[], vin: string) {
  const normalized = normalizedVin(vin);
  if (!validVin.test(normalized)) return undefined;
  const matches = vehicles.filter(row => row.vin === normalized);
  return matches.length === 1 ? matches[0] : undefined;
}

const locationFields = new Set<Field>(['tracker', 'latitude', 'longitude']);
const mileageFields = new Set<Field>(['odometer', 'deliveryDays', 'speed', 'motion', 'charged', 'used', 'chargeType', 'energyRank', 'rankEfficiency']);
export function permittedFields(location: boolean, mileage: boolean) {
  return (Object.keys(fields) as Field[]).filter(field =>
    (!locationFields.has(field) || location) && (!mileageFields.has(field) || mileage));
}

export function candidateVehicles(discovered: DiscoveredVehicle[], catalog: { vin?: string; name?: string }[]) {
  const byVin = new Map<string, { vin: string; name?: string }>();
  for (const item of [...discovered, ...catalog]) {
    const vin = normalizedVin(item?.vin);
    if (isVehicleVin(vin) && (!byVin.has(vin) || item.name)) byVin.set(vin, { vin, name: item.name });
  }
  return [...byVin.values()];
}

export function targetVin(vehicles: { vin: string }[], cloudVin: string, standalone: boolean, preferredVin: string) {
  if (!standalone) return isVehicleVin(cloudVin) ? normalizedVin(cloudVin) : '';
  if (preferredVin) return vehicles.find(row => row.vin === normalizedVin(preferredVin))?.vin ?? '';
  return vehicles.length === 1 ? vehicles[0].vin : '';
}
