export interface Entity {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}
export const fields = {
  soc: '电池电量 (%)', range: '纯电续航 (km)', odometer: '累计里程 (km)',
  speed: '车速 (km/h)', motion: '行驶状态（行驶/驻车）', charge: '充电状态', plug: '充电枪连接',
  power: '充电功率 (kW)', charged: '累计充入电量 (kWh)', used: '累计行驶耗电 (kWh)',
  chargeType: '充电类型（AC/DC）', tracker: '车辆定位（含经纬度属性）',
  latitude: '纬度（单独实体）', longitude: '经度（单独实体）',
  locked: '车门锁状态', trunk: '后备箱开关状态', windows: '车窗开关状态', sunshade: '遮阳帘开关状态',
  inside: '车内温度 (°C)', climate: '空调开关',
  fuel: '油量 (%)', fuelRange: '燃油续航 (km)', energyRank: '能耗排名', rankEfficiency: '排名百公里能耗 (kWh/100km)',
  tireFL: '左前胎压 (kPa)', tireFR: '右前胎压 (kPa)', tireRL: '左后胎压 (kPa)', tireRR: '右后胎压 (kPa)',
} as const;
export type Field = keyof typeof fields;
export type EntityBinding = string | { entity: string; attribute: 'speed' | 'windows_open' | 'climate_on' };
export type Mapping = Partial<Record<Field, EntityBinding>>;
export const entityIdOf = (binding?: EntityBinding) => typeof binding === 'string' ? binding : binding?.entity ?? '';
export interface Sample { entity: string; at: number; state: string; attrs?: Record<string, unknown> }
export interface HAConfig {
  url: string;
  mappings: Record<string, Mapping>;
  days: number;
  auto: boolean;
  auth: 'oauth' | 'manual';
}
export interface Token {
  access: string;
  refresh?: string;
  expiresAt?: number;
  client?: string;
}
export const HA_KEY = 'ha-credential';
export const MS_DAY = 86_400_000;
export function samplesOf(states: Entity[]): Sample[] {
  return states.flatMap(state => {
    const at = Date.parse(state.last_updated ?? state.last_changed ?? '');
    if (!Number.isFinite(at) || !state.entity_id || typeof state.state !== 'string') return [];
    const { latitude, longitude, unit_of_measurement, speed, windows_open, climate_on } = state.attributes ?? {};
    return [{ entity: state.entity_id, at, state: state.state, attrs: { latitude, longitude, unit_of_measurement, speed, windows_open, climate_on } }];
  });
}
