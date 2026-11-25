import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useModelContext } from '../context';
import { entityHistory } from '../../data/ha/client';
import { framesOf, lowestBatteryTemperature, type Charge } from '../../data/ha/measurements';
import { MS_DAY, samplesOf } from '../../data/ha/schema';

export function useChargeTemperature(charge?: Charge) {
  const m = useModelContext();
  const { ha } = m;
  const start = charge?.startedAt;
  const end = charge?.endedAt;
  const permitted = m.canSee('mileage');
  const includeHA = m.usesHA && !!ha.vin && permitted && !m.simulated;
  // Older ledger sessions can outlive the entity-history window stored on this phone.
  const older = useQuery({
    queryKey: ['ha', 'charge-temperature', ha.config?.url, ha.vin, ha.batteryEntity, start, end],
    enabled: includeHA && !!ha.config && !!ha.batteryEntity && start != null && end != null && start < Date.now() - ha.config.days * MS_DAY,
    staleTime: 24 * 3_600_000, retry: false,
    queryFn: async ({ signal }) => {
      const states = await entityHistory(ha.config!, [ha.batteryEntity], start!, end!, signal);
      const history = framesOf(samplesOf(states), { batteryMinTemp: { entity: ha.batteryEntity, attribute: 'battery_min_temp' } });
      return lowestBatteryTemperature(history, start!, end!);
    },
  });
  return useMemo(() => {
    if (!charge || !permitted) return null;
    const until = charge.endedAt ?? (charge.active ? Date.now() : charge.powerTimeline?.at(-1)?.at ?? charge.startedAt);
    const values = [charge.minRecordedBatteryTempC, lowestBatteryTemperature(m.cloudRecords.frames, charge.startedAt, until)];
    if (includeHA) values.push(lowestBatteryTemperature(ha.frames, charge.startedAt, until), older.data);
    const recorded = values.filter((v): v is number => v != null);
    return recorded.length ? Math.min(...recorded) : null;
  }, [charge, permitted, m.cloudRecords.frames, ha.frames, includeHA, older.data]);
}
