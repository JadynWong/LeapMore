import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentEntities, invalidateHAWork, testConnection } from './ha/client';
import { historyKey, syncHistory } from './ha/history';
import { archivePointer, archiveVehicles, entityRegistry, syncArchive } from './ha/archive';
import { ledgerKeys, readLedger, syncLedger } from './ha/ledger';
import { candidateVehicles, discoverVehicles, normalizedVin, permittedFields, targetVin, vehicleByVin } from './ha/discovery';
import { framesOf, numberOf } from './ha/measurements';
import { HA_KEY, samplesOf } from './ha/schema';
import { secureGet, secureRemove, secureSet } from '../platform/secure';
import { NetworkError } from '../platform/network';
import { deleteDataset, readDataset } from './localDatabase';
import { useSetting } from './preferences';
import type { HAConfig, Mapping, Token } from './ha/schema';
import type { History } from './ha/history';

const emptyMapping: Mapping = {};
const emptyRecords = { trips: [], charges: [] };
interface Binding { vin: string; mapping: Mapping; archiveId: string }
interface HATarget { vehicleId: string; cloudVin?: string; standalone: boolean; location: boolean; mileage: boolean; enabled: boolean; viewingRecords: boolean; suspended?: boolean }
export function useHA({ vehicleId, cloudVin = '', standalone, location, mileage, enabled, viewingRecords, suspended }: HATarget) {
  const qc = useQueryClient();
  const [config, setConfig] = useSetting<HAConfig | null>('haSettings', null);
  const [legacyArchiveIds] = useSetting<Record<string, string>>('archiveMapping', {});
  const [selectedCars, setSelectedCars] = useSetting<Record<string, string>>('haSelectedCars', {});
  const [bindings, setBindings] = useSetting<Record<string, Binding>>('haAutoBindings', {});
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  useEffect(() => {
    if (suspended) return;
    secureGet<Token>(HA_KEY).then(token => setHasToken(!!token)).catch(() => {}).finally(() => setReady(true));
  }, [suspended]);
  const url = config?.url ?? '';
  const bindingKey = JSON.stringify([url, vehicleId]);
  const cachedBinding = bindings[bindingKey];
  const active = ready && hasToken && !!config;
  const refreshInterval = enabled && config?.auto ? 30_000 : false;
  const liveInterval = viewingRecords && mileage && refreshInterval;
  const retry = (count: number, error: unknown) => count < 2 && !(error instanceof NetworkError && [401, 403].includes(error.status));
  const states = useQuery({
    queryKey: ['ha', 'states', config?.url],
    enabled: active, queryFn: ({ signal }) => currentEntities(config!, signal),
    staleTime: 120_000, refetchInterval: liveInterval || (refreshInterval && !standalone && 120_000), retry,
  });
  const registry = useQuery({
    queryKey: ['ha', 'entity-registry', url], enabled: active,
    queryFn: ({ signal }) => entityRegistry(config!, signal), retry: false,
    refetchInterval: refreshInterval && 120_000,
  });
  const archives = useQuery({
    queryKey: ['ha', 'archive-vehicles', url], enabled: active && mileage,
    queryFn: ({ signal }) => archiveVehicles(config!, signal), retry: false,
    refetchInterval: refreshInterval && 120_000,
  });
  const archivesAvailable = mileage && !archives.isError ? archives.data : undefined;
  const discovered = useMemo(() => registry.data && states.data ? discoverVehicles(registry.data.entries, registry.data.catalog, states.data) : [],
    [registry.data, states.data]);
  const candidates = candidateVehicles(discovered, [...(registry.data?.catalog ?? []), ...(archivesAvailable ?? [])]);
  const legacyArchive = legacyArchiveIds[url + ':' + vehicleId];
  const legacyVin = archivesAvailable?.find(row => row.vehicle_id === legacyArchive)?.vin;
  const selectedVin = selectedCars[url] || legacyVin || '';
  const canChooseDefault = !!registry.data && (registry.data.catalog.length > 0 ||
    registry.data.registryReadable && !!states.data && (!mileage || !archives.isPending));
  const liveVin = standalone && !selectedVin && !canChooseDefault ? '' : targetVin(candidates, cloudVin, standalone, selectedVin);
  const metadataPending = !registry.data && !archivesAvailable;
  const canUseBinding = active && !!cachedBinding && (standalone ? !selectedVin || normalizedVin(selectedVin) === cachedBinding.vin : normalizedVin(cloudVin) === cachedBinding.vin);
  const vin = active ? liveVin || (metadataPending && canUseBinding ? cachedBinding.vin : '') : '';
  const readableRegistry = !!registry.data?.registryReadable && !!states.data;
  const found = readableRegistry ? vehicleByVin(discovered, vin)?.mapping ?? emptyMapping :
    metadataPending && canUseBinding && cachedBinding.vin === vin ? cachedBinding.mapping : emptyMapping;
  const visibleFields = useMemo(() => permittedFields(location, mileage), [location, mileage]);
  const mapping = useMemo<Mapping>(() => Object.fromEntries(visibleFields.flatMap(field => found[field] ? [[field, found[field]]] : [])), [found, visibleFields]);
  const hasMapping = Object.values(mapping).some(Boolean);
  const matchingArchives = vin ? archivesAvailable?.filter(row => normalizedVin(row.vin) === vin) : undefined;
  const archiveId = !mileage || !vin ? '' : matchingArchives?.length === 1 ? matchingArchives[0].vehicle_id :
    !archivesAvailable && !archives.isError && canUseBinding && cachedBinding.vin === vin ? cachedBinding.archiveId : '';
  useEffect(() => {
    if (!vin || !readableRegistry || mileage && archives.isPending) return;
    const entry = { vin, mapping, archiveId };
    setBindings(current => JSON.stringify(current[bindingKey]) === JSON.stringify(entry) ? current : { ...current, [bindingKey]: entry });
  }, [archiveId, archives.isPending, bindingKey, mapping, mileage, readableRegistry, setBindings, vin]);
  const recordsEnabled = active && enabled && mileage && !!vin;
  const history = useQuery({
    queryKey: ['ha', 'history', url, vehicleId, vin, mapping, config?.days],
    enabled: active && enabled && !!vin && hasMapping && (mileage || location),
    queryFn: ({ signal }) => syncHistory(config!, vehicleId, vin, mapping, signal),
    refetchInterval: refreshInterval && 120_000, retry,
  });
  const cachedHistory = useQuery({
    queryKey: ['ha', 'cached', url, vehicleId, vin, mapping],
    enabled: !!config && !!vin && hasMapping,
    queryFn: async () => (await readDataset<History>(historyKey(config!, vehicleId, vin))) ?? null,
  });
  const archive = useQuery({
    queryKey: ['ha', 'archive', config?.url, archiveId],
    enabled: recordsEnabled && !!archiveId && !!archivesAvailable,
    queryFn: ({ signal }) => syncArchive(config!, archiveId!, signal),
    refetchInterval: refreshInterval && 120_000, retry,
  });
  const ledger = useQuery({
    queryKey: ['ha', 'ledger', url, vin, config?.days],
    enabled: recordsEnabled,
    queryFn: ({ signal }) => syncLedger(config!, vin, signal),
    refetchInterval: refreshInterval && (liveInterval || 120_000), retry,
  });
  const cachedLedger = useQuery({
    queryKey: ['ha', 'cached-ledger', url, vin, config?.days], enabled: recordsEnabled,
    queryFn: async () => await readLedger(config!, vin) ?? null,
  });

  const frames = useMemo(() => framesOf(history.data?.entries ?? cachedHistory.data?.entries ?? [], mapping),
    [history.data, cachedHistory.data, mapping]);
  const current = useMemo(() => framesOf(samplesOf(states.data ?? []).sort((a, b) => a.at - b.at), mapping).at(-1),
    [states.data, mapping]);
  const records = ledger.data ?? cachedLedger.data ?? emptyRecords;
  const trip = ledger.data?.tripsRead && !ledger.isError ? ledger.data.activeTrip : null;
  const currentReading = states.isError ? undefined : current?.data;
  const odometer = numberOf(currentReading?.odometer);
  const startOdometer = trip?.startOdometerKm ?? null;
  const activeTrip = trip && { speedKmh: numberOf(currentReading?.speed),
    distanceKm: odometer !== null && startOdometer !== null && odometer >= startOdometer ? odometer - startOdometer : trip.distanceKm };
  const session = ledger.data?.chargesRead && !ledger.isError ? ledger.data.charges.find(charge => charge.active) : undefined;
  const activeCharge = session && { soc: session.socEnd, kwh: session.kwh, powerKw: session.powerTimeline?.at(-1)?.value };

  async function connect(url: string, token: Token, auth: HAConfig['auth']) {
    await testConnection(url, token);
    await qc.cancelQueries({ queryKey: ['ha'] });
    invalidateHAWork();
    await secureSet(HA_KEY, token);
    qc.removeQueries({ queryKey: ['ha'] });
    setConfig(config?.url === url ? { ...config, auth } : { url, mappings: {}, days: 30, auto: true, auth });
    setHasToken(true);
  }
  async function disconnect() {
    invalidateHAWork();
    await qc.cancelQueries({ queryKey: ['ha'] });
    await secureRemove(HA_KEY);
    setHasToken(false);
    qc.removeQueries({ queryKey: ['ha', 'states'] });
    qc.removeQueries({ queryKey: ['ha', 'entity-registry'] });
    qc.removeQueries({ queryKey: ['ha', 'archive-vehicles'] });
  }
  async function clearHistory() {
    await qc.cancelQueries({ queryKey: ['ha'] });
    if (config) {
      await deleteDataset(historyKey(config, vehicleId));
      const cacheVin = vin || cachedBinding?.vin;
      if (cacheVin) await Promise.all([historyKey(config, vehicleId, cacheVin), ...ledgerKeys(config, cacheVin)].map(deleteDataset));
      const linkedId = archiveId || cachedBinding?.archiveId || legacyArchive;
      if (linkedId) {
        const pointer = archivePointer(config, linkedId);
        const archiveKey = await readDataset<string>(pointer);
        if (archiveKey) await deleteDataset(archiveKey);
        await deleteDataset(pointer);
      }
    }
    qc.removeQueries({ queryKey: ['ha'], predicate: q => q.queryKey[1] !== 'states' });
  }
  async function refresh() {
    const options = { cancelRefetch: false };
    return Promise.all([
      states.refetch(options), registry.refetch(options), ...(mileage ? [archives.refetch(options)] : []),
      ...(vin && enabled && hasMapping && (mileage || location) ? [history.refetch(options)] : []),
      ...(recordsEnabled ? [ledger.refetch(options), qc.invalidateQueries({ queryKey: ['ha', 'energy', url, vin] })] : []),
      ...(recordsEnabled && archiveId && archivesAvailable ? [archive.refetch(options)] : []),
    ]);
  }
  const fields = visibleFields.map(field => ({ field, available: (field === 'tracker' ? current?.data.position : current?.data[field]) != null }));
  const lastSync = Math.max(history.data?.cursor ?? cachedHistory.data?.cursor ?? 0, archive.dataUpdatedAt, ledger.data?.lastSync ?? cachedLedger.data?.lastSync ?? 0);
  const identifying = registry.isFetching || (mileage && archives.isFetching);
  const recordSyncing = history.isFetching || archive.isFetching || ledger.isFetching;
  const tripUnavailable = ledger.isError || ledger.data?.tripsRead === false;
  const chargeUnavailable = ledger.isError || ledger.data?.chargesRead === false;
  const error = states.error;
  return {
    config, setConfig, ready, connected: active, hasToken, connect, disconnect, clearHistory, refresh, vin, candidates, fields,
    selectVehicle: (vin: string) => setSelectedCars(cars => ({ ...cars, [url]: vin })),
    frames, records, activeTrip, activeCharge, recordSyncing, ledgerSyncing: ledger.isFetching, identifying, tripUnavailable, chargeUnavailable,
    registryUnavailable: registry.isError || registry.data?.registryReadable === false,
    archiveUnavailable: archives.isError || archive.isError, historyUnavailable: history.isError,
    lastSync, syncing: states.isFetching || identifying || ledger.isFetching,
    error: error instanceof Error ? error.message : '',
    expired: error instanceof NetworkError && [401, 403].includes(error.status),
  };
}
