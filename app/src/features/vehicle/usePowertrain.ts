import { useEffect, useSyncExternalStore } from 'react';
import { readSetting, saveSetting } from '../../data/localDatabase';
import { namedPowertrain, resolvePowertrain } from '../../data/powertrain';
import type { PowertrainPreference, RangeReadings } from '../../data/powertrain';
import type { CarState, Vehicle } from '../../data/types';

function subscribe(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener('leapmore-powertrain', notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener('leapmore-powertrain', notify);
  };
}

function persist(key: string, value: PowertrainPreference | RangeReadings['evidence']) {
  saveSetting(key, value);
  window.dispatchEvent(new Event('leapmore-powertrain'));
}

export function usePowertrain(scope: string, vehicle?: Vehicle, state?: CarState) {
  const preferenceKey = 'powertrain.preference:' + scope;
  const memoryKey = 'powertrain.knownReev:' + scope;
  const preference = useSyncExternalStore(subscribe, () => scope ? readSetting<PowertrainPreference>(preferenceKey, 'auto') : 'auto');
  // A legacy boolean did not record whether a model label or actual fuel range set it.
  const known = useSyncExternalStore(subscribe, () => {
    const saved = scope && readSetting<unknown>(memoryKey, null);
    return saved === 'fuel-range' || saved === 'combined-range';
  });
  const named = namedPowertrain([vehicle?.model, vehicle?.carType, vehicle?.declaredPowertrain].join(' '));
  const evidence = state && state.vehicleId === vehicle?.id ? state.rangeReadings?.evidence ?? null : null;
  useEffect(() => {
    if (!scope) return;
    if (preference === 'bev' || named === 'bev') {
      if (known) persist(memoryKey, null);
    } else if (preference === 'auto' && !known && evidence) persist(memoryKey, evidence);
  }, [scope, preference, known, named, evidence, memoryKey]);
  return {
    ...resolvePowertrain(preference, named, evidence, known), preference, evidence,
    choose: (value: PowertrainPreference) => {
      if (!scope) return;
      if (value === 'bev') saveSetting(memoryKey, null);
      persist(preferenceKey, value);
    },
  };
}
