import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readDataset, updateDataset } from '../../data/localDatabase';
import type { Charge } from '../../data/ha/measurements';

type ChargeKey = Pick<Charge, 'id' | 'sampledId'>;
type SavedFee = { ids: string[]; amount: number };

export function useChargeFees(scope: string, aliases?: Map<string, string[]>, ownedLegacyScope = '') {
  const client = useQueryClient();
  const storageKey = 'charge-fees:' + scope;
  const query = useQuery({ queryKey: [storageKey], enabled: !!scope, staleTime: Infinity, networkMode: 'always',
    queryFn: async () => {
      const current = await readDataset<SavedFee[]>(storageKey);
      if (current !== undefined || !ownedLegacyScope) return current ?? [];
      const legacy = await readDataset<SavedFee[]>('charge-fees:' + ownedLegacyScope);
      return legacy ? updateDataset<SavedFee[]>(storageKey, prior => prior ?? legacy) : [];
    } });
  const byId = useMemo(() => {
    const amounts = new Map<string, number>();
    for (const fee of query.data ?? []) for (const id of fee.ids) amounts.set(id, fee.amount);
    return amounts;
  }, [query.data]);
  const idsFor = useCallback((charge: ChargeKey) => [
    charge.id, ...(charge.sampledId ? [charge.sampledId] : []), ...(aliases?.get(charge.id) ?? []),
  ], [aliases]);
  const get = useCallback((charge: ChargeKey) => {
    if (byId.size) for (const id of idsFor(charge)) {
      const amount = byId.get(id);
      if (amount !== undefined) return amount;
    }
  }, [byId, idsFor]);
  async function save(charge: ChargeKey, amount: number | null) {
    if (!scope || (amount !== null && (!Number.isFinite(amount) || amount < 0))) throw new Error('无法保存本次电费。');
    await client.cancelQueries({ queryKey: [storageKey], exact: true });
    const saved = await updateDataset<SavedFee[]>(storageKey, prior => {
      const ids = new Set(idsFor(charge));
      const other = (prior ?? []).filter(fee => {
        if (!fee.ids.some(id => ids.has(id))) return true;
        for (const id of fee.ids) ids.add(id);
        return false;
      });
      if (amount !== null) other.push({ ids: [...ids], amount });
      return other;
    });
    client.setQueryData([storageKey], saved);
  }
  return { scope, get, save, ready: !!scope && query.isSuccess, readError: query.isError, retry: query.refetch };
}
