import { vehicleTimestamp } from './records';

const signals = {
  '1204': ['soc'], '100003': ['socPrecise'], '1318': ['totalMileage'], '1319': ['speed'],
  '3260': ['expectedMileage'], '2188': ['liveRemainingRange'], '1010': ['gearStatus'],
  '2': ['longitude'], '3': ['latitude'], '1298': ['driverDoorLockStatus'], '1281': ['bbcmBackDoorStatus'],
  '2646': ['leftFrontTirePressure'], '2653': ['rightFrontTirePressure'],
  '2660': ['leftRearTirePressure'], '2667': ['rightRearTirePressure'],
  '644': ['leftFrontWindowPercent'], '645': ['leftRearWindowPercent'],
  '865': ['rightFrontWindowPercent'], '866': ['rightRearWindowPercent'],
  '1693': ['driverWindowStatus'], '1694': ['rightFrontWindowStatus'],
  '1695': ['leftRearWindowStatus'], '1696': ['rightRearWindowStatus'],
  '1938': ['acSwitch'], '2183': ['acSetting'], '1941': ['acAirVolume'],
  '1816': ['steeringWheelHeating'], '49': ['leftMirrorHeating'], '50': ['rightMirrorHeating'],
  '1349': ['indoorTemp', 'interiorTemp'], '1177': ['batteryVoltage'],
  '1178': ['batteryCurrent'], '1200': ['chargeRemainTime'], '1149': ['chargeState'],
  '1197': ['dcInputFastCharge'],
} as const;
const booleanSignals = new Set(['1298', '1281', '1693', '1694', '1695', '1696', '1938', '1197', '1816', '49', '50']);

export function normalizeT03(source: Record<string, unknown>) {
  // A named frame can include placeholder numeric fields. Prefer the named schema as a whole.
  const named = Object.values(signals).some(names => names.some(name => name in source));
  const raw: Record<string, unknown> = { sts: source.sts };
  const fields = named ? Object.entries(signals) : Object.keys(source).filter(key => /^\d+$/.test(key)).map(key => [key, [key]] as const);
  for (const [id, names] of fields) {
    for (const name of names) {
      let value = source[name];
      if (booleanSignals.has(id) && (typeof value === 'boolean' || typeof value === 'string')) {
        if (String(value).trim().toLowerCase() === 'true') value = 1;
        if (String(value).trim().toLowerCase() === 'false') value = 0;
      }
      if ((typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value))) {
        raw[id] = Number(value);
        break;
      }
    }
  }
  return raw;
}

export function t03Timestamp(value: unknown) {
  const n = vehicleTimestamp(value);
  if (n !== null || typeof value !== 'string') return n;
  const iso = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d(?:\.\d+)?)(Z|[+-]\d\d:\d\d)?$/i.exec(value.trim());
  return iso ? vehicleTimestamp(Date.parse(iso[1] + 'T' + iso[2] + (iso[3] || '+08:00'))) : null;
}

export function hasT03Telemetry(raw: Record<string, unknown>) {
  return [...Object.keys(signals), '100003', '47', '48', '1724', '2100', '2101', '3724', '3725', '2190', '2191']
    .some(id => (typeof raw[id] === 'number' || typeof raw[id] === 'string' && String(raw[id]).trim()) && Number.isFinite(Number(raw[id])));
}
