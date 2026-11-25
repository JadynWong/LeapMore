import { useEffect, useSyncExternalStore } from 'react';
import { readSetting, saveSetting } from '../../data/localDatabase';
import { namedPowertrain, resolvePowertrain } from '../../data/powertrain';
import type { PowertrainPreference } from '../../data/powertrain';
import type { CarState, Vehicle } from '../../data/types';

function subscribe(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener('leapmore-powertrain', notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener('leapmore-powertrain', notify);
  };
}

function persist(key: string, value: true | PowertrainPreference) {
  saveSetting(key, value);
  window.dispatchEvent(new Event('leapmore-powertrain'));
}

export function usePowertrain(scope: string, vehicle?: Vehicle, state?: CarState) {
  const preferenceKey = 'powertrain.preference:' + scope;
  const memoryKey = 'powertrain.knownReev:' + scope;
  const preference = useSyncExternalStore(subscribe, () => scope ? readSetting<PowertrainPreference>(preferenceKey, 'auto') : 'auto');
  const known = useSyncExternalStore(subscribe, () => !!scope && readSetting(memoryKey, false));
  // Older vehicle lists stored 'bev' for every unnamed variant. Only trust an explicit name.
  const named = vehicle?.declaredPowertrain ?? namedPowertrain([vehicle?.model, vehicle?.carType].join(' '));
  const evidence = state?.rangeReadings?.evidence ?? null;
  useEffect(() => {
    if (scope && !known && named !== 'bev' && (evidence || named === 'reev')) persist(memoryKey, true);
  }, [scope, known, named, evidence, memoryKey]);
  return {
    ...resolvePowertrain(preference, named, evidence, known), preference, evidence,
    choose: (value: PowertrainPreference) => { if (scope) persist(preferenceKey, value); },
  };
}
