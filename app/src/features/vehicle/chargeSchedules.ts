import { useQuery } from '@tanstack/react-query';
import { CloudSessionExpired } from '../../data/cloud/LiveClient';
import { allowsPreheat, preheatSchedulesKey } from '../../data/cloud/preheat';
import { useModelContext } from '../context';

export function useChargingConfig(active = true) {
  const model = useModelContext();
  return useQuery({ queryKey: ['cloud', 'charge-plan', model.cloudKey],
    enabled: active && !!model.client && model.canSee('control'),
    queryFn: async () => (await model.controlClient()).getChargingConfig(model.vehicleId), retry: false, staleTime: 120_000 });
}

export function usePreheatSchedules(active = true) {
  const model = useModelContext();
  const permitted = model.canSee('control') && !!model.vehicle && allowsPreheat(model.vehicle);
  const canRead = permitted && !!model.client && !model.expired;
  const key = preheatSchedulesKey(model.simulated ? 'demo:' + model.vehicleId : model.cloudKey);
  const schedules = useQuery({ queryKey: key, initialData: model.simulated ? [] : undefined, enabled: active && canRead && !model.simulated,
    queryFn: async () => {
      const read = async (force = false) => (await model.controlClient(force)).getPreheatSchedules(model.vehicleId);
      try { return await read(); } catch (error) {
        if (error instanceof CloudSessionExpired) return read(true);
        throw error;
      }
    }, staleTime: 120_000, retry: false });
  return { schedules, permitted, canRead, key };
}
