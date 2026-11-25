import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { demoEnergy, demoLocation, demoRecords, demoTires, demoVehicles, haVehicle } from '../data/demo';
import { dailyEnergy } from '../data/ha/measurements';
import { isVehicleVin, normalizedVin } from '../data/ha/discovery';
import { combineCharges, combineTrips } from '../data/combinedRecords';
import { allGrants, defaultRecordSource, defaultTariff, sourceUsesHA, sourceUsesPhone, themeAccents, themeModes, useSetting } from '../data/preferences';
import type { Favorite, Grant, Source, ThemeAccent, ThemeMode } from '../data/preferences';
import { CloudSessionExpired } from '../data/cloud/LiveClient';
import type { LiveVehicles } from '../data/cloud/LiveClient';
import { applyConfirmedControls, awaitingControlEcho, confirmedStatePatch, controlEchoWindow } from '../data/cloud/remote';
import type { ConfirmedControl, RemoteCommand } from '../data/cloud/remote';
import { CloudRateLimited, VehiclePolling } from '../data/cloud/polling';
import { useCloudRecords } from '../data/cloud/useRecords';
import type { CarState, Powertrain, Vehicle } from '../data/types';
import { useHA } from '../data/useHA';
import { useBackgroundVehicleRecorder } from '../data/phone';
import { deleteDataset, readDataset, updateDataset } from '../data/localDatabase';
import { clearLegacyPhoneRecording } from '../platform/recorder';
import { failureFacts, failureLabels } from '../data/serviceFailure';
import { readFailure, rememberFailure } from '../data/readDiagnostics';
import { clearCloud, cloudClient, loadCloudSession, rememberCloudVehicles } from './account/session';
import { widgetBridge } from '../platform/widgets';
import { forgetOperationPin } from '../platform/operationAuth';
import { defaultVehicleEnergy } from '../data/vehicleEnergy';
import { vehicleBatteryPacks } from '../data/batteryPacks';
import { usePowertrain } from './vehicle/usePowertrain';
import { displayedRange } from '../data/powertrain';
import type { VehicleEnergySettings } from '../data/vehicleEnergy';

export type Mode = 'demo' | 'cloud' | 'ha';
export type Scenario = 'normal' | 'stale' | 'offline' | 'pending';
export type ChargeState = CarState['charging'];
type Demobar = { scenario: Scenario; driving: boolean; charging: ChargeState; powertrain: Powertrain; account: 'normal' | 'expired' | 'empty'; grants: Record<Grant, boolean> };
const normalDemo: Demobar = { scenario: 'normal', charging: 'unplugged', driving: false, powertrain: 'bev', account: 'normal', grants: allGrants };
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const subscribeToSystemTheme = (onChange: () => void) => {
  systemTheme.addEventListener('change', onChange);
  return () => systemTheme.removeEventListener('change', onChange);
};
const readSystemTheme = () => systemTheme.matches ? 'dark' : 'light';

function useDeletedTrips(scope: string) {
  return useQuery({ queryKey: ['deleted-trips', scope], enabled: !!scope, staleTime: Infinity, networkMode: 'always',
    queryFn: async () => await readDataset<string[]>('deleted-trips:' + scope) ?? [] });
}

function useModel(widgetControl: boolean) {
  const viewingRecords = useLocation().pathname === '/records';
  const qc = useQueryClient();
  const [mode, setMode] = useSetting<Mode | null>('mode', null);
  const [cloud, setCloud] = useState<LiveVehicles | null>(null);
  const [booted, setBooted] = useState(mode !== 'cloud');
  const [cloudExpired, setCloudExpired] = useState(false);
  const [vehicleId, setVehicleId] = useSetting('activeVehicle', '');
  const [names, setNames] = useSetting<Record<string, string>>('names', {});
  const [source, setSource] = useSetting<Source>('source', defaultRecordSource);
  const [savedTheme, setTheme] = useSetting<ThemeMode>('theme', 'system');
  const [savedAccent, setThemeAccent] = useSetting<ThemeAccent>('themeAccent', 'blue');
  const theme = Object.hasOwn(themeModes, savedTheme) ? savedTheme : 'system';
  const themeAccent = Object.hasOwn(themeAccents, savedAccent) ? savedAccent : 'blue';
  const preferredTheme = useSyncExternalStore(subscribeToSystemTheme, readSystemTheme);
  const colorScheme = theme === 'system' ? preferredTheme : theme;
  const [baseTariff, setTariff] = useSetting('tariff', defaultTariff);
  // A null entry records an explicit skip without fixing a calculated default.
  const [vehicleEnergySettings, setVehicleEnergySettings] = useSetting<Record<string, VehicleEnergySettings | null>>('vehicleEnergy', {});
  const [favoriteSets, setFavoriteSets] = useSetting<Record<string, Favorite[]>>('favorites', {});
  const [paintSets, setPaintSets] = useSetting<Record<string, { hex: string; name: string }>>('paint', {});
  const [tireRanges, setTireRanges] = useSetting<Record<string, { min: number; max: number }>>('tireRanges', {});
  const defaultPaint = { hex: '#C4C4BC', name: '苔原灰' };
  const [debug, setDebug] = useState(normalDemo);
  const [toast, setToast] = useState('');
  const [localRecords, setLocalRecords] = useState(true);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(timer);
  }, [toast]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = colorScheme;
    if (themeAccent === 'blue') {
      for (const property of ['--accent', '--accent-rgb', '--icon-outline', '--on-accent']) root.style.removeProperty(property);
    } else {
      const accent = themeAccents[themeAccent][colorScheme];
      const rgb = [1, 3, 5].map(offset => Number.parseInt(accent.slice(offset, offset + 2), 16)).join(', ');
      root.style.setProperty('--accent', accent);
      root.style.setProperty('--accent-rgb', rgb);
      root.style.setProperty('--icon-outline', accent);
      root.style.setProperty('--on-accent', colorScheme === 'dark' ? '#101820' : '#ffffff');
    }
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', colorScheme === 'dark' ? '#0e1114' : '#f4f6f8');
  }, [colorScheme, themeAccent]);
  useEffect(() => {
    if (mode !== 'cloud' || cloud) { setBooted(true); return; }
    let live = true;
    loadCloudSession().then(session => {
      if (live) { setCloud(session); setCloudExpired(!session); }
    }).catch(() => { if (live) setCloudExpired(true); }).finally(() => { if (live) setBooted(true); });
    return () => { live = false; };
  }, [mode, cloud]);
  const client = useMemo(() => mode === 'cloud' && cloud ? cloudClient(cloud) : null, [mode, cloud]);
  const profileScope = mode === 'cloud' && cloud ? 'cloud:' + cloud.account.userId : mode ?? 'local';
  const cloudVehicles = useQuery({
    queryKey: ['cloud', 'vehicles', cloud?.deviceId, cloud?.account.userId],
    enabled: !!client, networkMode: 'always', queryFn: async ({ signal }) => {
      try { return await client!.getVehicles(); }
      catch (error) { if (!signal.aborted) rememberFailure(profileScope, 'list', error); throw error; }
    }, staleTime: 60_000,
  });
  useEffect(() => {
    if (mode === 'cloud' && cloud && cloudVehicles.data) void rememberCloudVehicles(cloud, cloudVehicles.data).catch(() => {});
  }, [mode, cloud, cloudVehicles.data]);
  const vehicles = mode === 'cloud' ? cloudVehicles.data ?? cloud?.vehicles ?? [] : mode === 'ha' ? [haVehicle] : debug.account === 'empty' ? [] : demoVehicles;
  const vehicle = vehicles.find(v => v.id === vehicleId);
  const currentId = vehicle?.id ?? '';
  const sharedBase = vehicle?.shared === true;
  const grants = mode === 'demo' ? debug.grants : sharedBase ? vehicle.grants ?? { control: false, location: false, mileage: false } : allGrants;
  const expired = mode === 'cloud' ? cloudExpired : mode === 'demo' && debug.account === 'expired';
  const cloudKey = cloud && currentId ? cloud.account.userId + ':' + currentId : '';
  const [controlFeedback, setControlFeedback] = useState<{ key: string; items: ConfirmedControl[] }>();
  const vinScope = (car: Vehicle | undefined) => cloud && car?.vin ? JSON.stringify([cloud.account.userId, car.vin.toUpperCase()]) : '';
  const operationScope = vinScope(vehicle);
  const usesPhone = sourceUsesPhone(source);
  const usesHA = sourceUsesHA(source);
  const recordCloud = !widgetControl && !!client && !!cloudKey && usesPhone && grants.mileage && !expired;
  const vehiclePolling = useMemo(() => new VehiclePolling(), [cloudKey]);
  const ha = useHA({ vehicleId: currentId || haVehicle.id, cloudVin: mode === 'cloud' ? vehicle?.vin : undefined,
    standalone: mode === 'ha', enabled: !!currentId && usesHA, viewingRecords, suspended: widgetControl,
    location: !expired && !!vehicle && grants.location, mileage: !expired && !!vehicle && grants.mileage });
  async function readCloudState(signal: AbortSignal) {
    const session = cloud!;
    let stateClient = client!;
    const renew = async (force: boolean) => {
      const next = await loadCloudSession(force);
      signal.throwIfAborted();
      if (!next) throw new CloudSessionExpired();
      if (next.car.accessToken !== session.car.accessToken) {
        setCloud(current => current === session ? next : current);
        stateClient = cloudClient(next);
      }
    };
    if (session.car.expiresAt <= Date.now() + 60_000) await renew(false);
    try { return await stateClient.getState(currentId); }
    catch (error) {
      signal.throwIfAborted();
      if (error instanceof CloudRateLimited) throw error;
      if (error instanceof CloudSessionExpired) await renew(true);
      return stateClient.getState(currentId);
    }
  }
  async function controlClient(force = false) {
    const session = await loadCloudSession(force);
    if (!session || !cloud || session.account.userId !== cloud.account.userId || session.deviceId !== cloud.deviceId) throw new CloudSessionExpired();
    if (session.car.accessToken === cloud.car.accessToken && client) return client;
    setCloud(current => current === cloud ? session : current);
    return cloudClient(session);
  }
  function showControlState(state: CarState) {
    if (state.vehicleId !== currentId) return;
    qc.setQueryData<CarState>(['cloud', 'state', cloudKey], existing =>
      (existing?.reportedAt ?? 0) > (state.reportedAt ?? 0) ? existing : state);
  }
  function showConfirmedControl(command: RemoteCommand, before: CarState, sentAt: number) {
    const patch = confirmedStatePatch(command);
    if (!patch || !cloudKey || before.vehicleId !== currentId) return;
    if (!qc.getQueryData(['cloud', 'state', cloudKey])) showControlState(before);
    const confirmedAt = Date.now();
    setControlFeedback(previous => {
      const items = previous?.key === cloudKey ? previous.items.filter(item => awaitingControlEcho(undefined, item, confirmedAt) &&
        !Object.keys(confirmedStatePatch(item.command) ?? {}).some(field => Object.hasOwn(patch, field))) : [];
      return { key: cloudKey, items: [...items, { command, sentAt, confirmedAt }] };
    });
  }
  function refreshChargePlan() {
    void qc.invalidateQueries({ queryKey: ['cloud', 'charge-plan', cloudKey] });
  }
  const cloudState = useQuery({
    queryKey: ['cloud', 'state', cloudKey], enabled: !!currentId && mode === 'cloud' && !!client && !expired,
    queryFn: async ({ signal }) => {
      vehiclePolling.beforeRequest();
      const next = await readCloudState(signal).catch(error => {
        if (!signal.aborted) rememberFailure(cloudKey, 'state', error);
        if (error instanceof CloudRateLimited) vehiclePolling.rateLimit();
        throw error;
      });
      signal.throwIfAborted();
      vehiclePolling.observe(next);
      const previous = qc.getQueryData<CarState>(['cloud', 'state', cloudKey]);
      return previous && (previous.reportedAt ?? 0) > (next.reportedAt ?? 0) ? previous : next;
    }, refetchOnWindowFocus: 'always', networkMode: 'always', retry: false,
    refetchInterval: query => {
      if (query.state.error instanceof CloudSessionExpired) return false;
      return recordCloud || vehiclePolling.limited() ? vehiclePolling.delay() : 30_000;
    },
  });
  const powertrainInfo = usePowertrain(mode === 'cloud' ? operationScope : '', vehicle, mode === 'cloud' ? cloudState.data : undefined);
  const batteryType = mode === 'cloud' && powertrainInfo.reason !== 'no-fuel-range-evidence' ? powertrainInfo.type : undefined;
  const batteryPacks = useMemo(() => vehicleBatteryPacks(vehicle, batteryType), [vehicle, batteryType]);
  function vehicleEnergyScope(car: Vehicle | undefined) {
    if (!car) return '';
    if (mode === 'demo') return 'demo:' + car.id;
    return cloud ? vinScope(car) || cloud.account.userId + ':' + car.id : '';
  }
  const energyScope = vehicleEnergyScope(vehicle);
  const energySettings = useMemo(() => vehicleEnergySettings[energyScope] ?? defaultVehicleEnergy(batteryPacks.preset, baseTariff),
    [vehicleEnergySettings, energyScope, batteryPacks.preset, baseTariff]);
  const tariff = useMemo(() => usesPhone && mode !== 'ha' ? {
    ac: { ...baseTariff.ac, efficiency: energySettings.acEfficiency },
    dc: { ...baseTariff.dc, efficiency: energySettings.dcEfficiency },
  } : baseTariff, [usesPhone, mode, baseTariff, energySettings]);
  const cloudRecords = useCloudRecords(cloudKey, currentId, client, recordCloud, grants.location, cloudState.data, energySettings,
    cloudState.dataUpdatedAt);
  const stateExpired = cloudState.error instanceof CloudSessionExpired;
  useEffect(() => { if (stateExpired && mode === 'cloud') setCloudExpired(true); }, [mode, stateExpired]);
  const sessionError = [cloudVehicles.error, recordCloud ? cloudRecords.error : null].find(error => error instanceof CloudSessionExpired);
  useEffect(() => {
    if (mode !== 'cloud' || !sessionError) return;
    let live = true;
    void loadCloudSession(true).then(session => {
      if (!live) return;
      if (session) { setCloud(session); setCloudExpired(false); void qc.invalidateQueries({ queryKey: ['cloud'] }); }
      else setCloudExpired(true);
    }).catch(error => { if (live && error instanceof CloudSessionExpired) setCloudExpired(true); });
    return () => { live = false; };
  }, [mode, sessionError]);
  const lastHABackgroundCheck = useRef({ url: '', at: 0 });
  const background = useBackgroundVehicleRecorder(recordCloud && !stateExpired ? cloudKey : '', vehiclePolling.delay(), async () => {
    if (source === 'hybrid' && ha.connected && ha.config?.auto && !ha.expired) {
      const now = Date.now(), url = ha.config.url;
      if (lastHABackgroundCheck.current.url !== url || now - lastHABackgroundCheck.current.at >= 120_000) {
        lastHABackgroundCheck.current = { url, at: now };
        void ha.refresh().catch(() => {});
      }
    }
    return (await cloudState.refetch({ cancelRefetch: false })).isSuccess;
  });
  const simulated = mode === 'demo';
  useEffect(() => {
    if (!controlFeedback) return;
    const prune = () => setControlFeedback(current => {
      if (!current || current !== controlFeedback) return current;
      if (current.key !== cloudKey) return undefined;
      const items = current.items.filter(item => awaitingControlEcho(cloudState.data, item, Date.now()));
      return items.length === current.items.length ? current : items.length ? { ...current, items } : undefined;
    });
    prune();
    const timeout = setTimeout(prune, Math.max(0, controlFeedback.items[0].confirmedAt + controlEchoWindow - Date.now()));
    return () => clearTimeout(timeout);
  }, [cloudKey, cloudState.data, controlFeedback]);
  const liveState = controlFeedback?.key === cloudKey ? applyConfirmedControls(cloudState.data, controlFeedback.items, Date.now()) : cloudState.data;
  const canSee = (grant: Grant) => !expired && !!vehicle && grants[grant];
  const vehicleReport = liveState?.reportedAt ?? liveState?.updatedAt;
  const statusTime = liveState?.updatedAt;
  const stale = !!statusTime && Date.now() - statusTime > 30 * 60_000;
  const soc = simulated ? 42 : liveState?.soc ?? null;
  const powertrain = simulated ? debug.powertrain : powertrainInfo.type;
  const ranges = liveState?.rangeReadings;
  const range = displayedRange(powertrain, ranges);
  const current = {
    soc,
    powertrain,
    range: simulated ? powertrain === 'reev' ? 782 : 195 : range.km,
    electricRange: simulated ? powertrain === 'reev' ? 362 : 195 : powertrain === 'bev' ? range.km : ranges?.ev ?? ranges?.live ?? null,
    rangeLabel: powertrain === 'bev' ? '续航' : simulated || range.source === 'combined' || range.source === 'total' ? '综合续航' : '续航',
    fuel: powertrain === 'bev' ? null : simulated ? 38 : liveState?.fuelPercent ?? null,
    fuelRange: powertrain === 'bev' ? null : simulated ? 420 : liveState?.fuelRangeKm ?? null,
    locked: simulated ? true : liveState?.locked ?? null,
    trunkOpen: liveState?.trunkOpen ?? null,
    windowOpen: liveState?.windowOpen ?? null,
    windowPercent: liveState?.windowPercent,
    sunshadeOpen: liveState?.sunshadeOpen ?? null,
    inside: simulated ? 24 : liveState?.insideTempC ?? null,
    charging: simulated ? debug.charging : liveState?.charging ?? 'unknown',
    power: simulated && debug.charging === 'charging' ? 6.3 : liveState?.chargingPowerKw ?? null,
    healthCharging: liveState?.healthCharging ?? null,
    climateOn: simulated ? false : liveState?.climateOn ?? null,
    climateTemp: liveState?.climateTempC ?? null,
    climateFan: liveState?.climateFan ?? null,
    seatHeat: liveState?.seatHeat ?? null,
    seatVent: liveState?.seatVent ?? null,
    steeringHeat: liveState?.steeringHeat ?? null,
    mirrorHeat: liveState?.mirrorHeat ?? null,
    driving: simulated ? debug.driving : liveState?.isDriving ?? null,
    tires: simulated ? demoTires : liveState?.tirePressureKpa ?? [],
    odometer: simulated ? 12345 : liveState?.odometer ?? null,
    at: simulated ? undefined : statusTime,
    reportedAt: vehicleReport,
    location: simulated ? demoLocation : liveState?.latitude != null && liveState.longitude != null ?
      { lat: liveState.latitude, lon: liveState.longitude, at: liveState.reportedAt ?? liveState.updatedAt, coordinate: 'gcj02' as const } : null,
  };
  const scenario = simulated ? debug.scenario : cloudState.isError ? 'offline' as const : stale ? 'stale' as const : 'normal' as const;
  const hybrid = source === 'hybrid';
  const combinedTrips = useMemo(() => hybrid ? combineTrips(cloudRecords.trips, ha.records.trips) : null,
    [hybrid, cloudRecords.trips, ha.records.trips]);
  const combinedCharges = useMemo(() => hybrid ? combineCharges(cloudRecords.charges, ha.records.charges) : null,
    [hybrid, cloudRecords.charges, ha.records.charges]);
  const rawRecords = useMemo(() => {
    if (!grants.mileage || expired || source === 'off' || !localRecords && simulated) return { trips: [], charges: [] };
    if (simulated && usesPhone) return demoRecords();
    if (combinedTrips && combinedCharges) return { trips: combinedTrips.trips, charges: combinedCharges.charges };
    if (source === 'ha') return ha.records;
    return { trips: cloudRecords.trips, charges: cloudRecords.charges };
  }, [grants.mileage, expired, source, simulated, usesPhone, ha.records, localRecords, cloudRecords.trips, cloudRecords.charges, combinedTrips, combinedCharges]);
  const phoneTripScope = canSee('mileage') && usesPhone && (simulated || cloudKey) ?
    JSON.stringify(simulated ? ['demo', currentId] : ['phone', cloudKey]) : '';
  const haTripScope = canSee('mileage') && usesHA && ha.config && ha.vin ? JSON.stringify(['ha', ha.config.url, ha.vin]) : '';
  const tripScope = hybrid ? JSON.stringify([phoneTripScope, haTripScope]) : phoneTripScope || haTripScope;
  const tripVin = normalizedVin(mode === 'ha' ? ha.vin : mode === 'cloud' ? vehicle?.vin : undefined);
  // A local removal applies to this vehicle across data sources. Keep reading marks from earlier versions.
  const deletionScope = !phoneTripScope && !haTripScope ? '' :
    isVehicleVin(tripVin) ? JSON.stringify(['vin', tripVin]) : phoneTripScope || haTripScope;
  const removedLocal = useDeletedTrips(deletionScope);
  const removedPhone = useDeletedTrips(phoneTripScope === deletionScope ? '' : phoneTripScope);
  const removedHA = useDeletedTrips(haTripScope === deletionScope ? '' : haTripScope);
  const restoringDeletions = removedLocal.isLoading || removedPhone.isLoading || removedHA.isLoading;
  const records = useMemo(() => {
    if (restoringDeletions) return { ...rawRecords, trips: [] };
    if (!removedLocal.data?.length && !removedPhone.data?.length && !removedHA.data?.length) return rawRecords;
    const removed = new Set([...(removedLocal.data ?? []), ...(removedPhone.data ?? []), ...(removedHA.data ?? [])]);
    return { ...rawRecords, trips: rawRecords.trips.filter(trip => !removed.has(trip.id) &&
      !combinedTrips?.aliases.get(trip.id)?.some(id => removed.has(id))) };
  }, [removedLocal.data, removedPhone.data, removedHA.data, restoringDeletions, rawRecords, combinedTrips]);
  const canDeleteTrip = (id: string) => !!deletionScope &&
    id !== cloudRecords.activeTrip?.id && !combinedTrips?.aliases.get(id)?.includes(cloudRecords.activeTrip?.id ?? '');
  async function deleteTrip(id: string) {
    if (!canDeleteTrip(id) || !records.trips.some(trip => trip.id === id)) throw new Error('这段行程暂时无法删除。');
    const ids = [id, ...(combinedTrips?.aliases.get(id) ?? [])];
    const queryKey = ['deleted-trips', deletionScope];
    await qc.cancelQueries({ queryKey, exact: true });
    const saved = await updateDataset<string[]>('deleted-trips:' + deletionScope, prior => [...new Set([...(prior ?? []), ...ids])]);
    qc.setQueryData(queryKey, saved);
  }
  const favorites = favoriteSets[currentId] ?? (simulated ? [
    { name: '家', address: '上海市浦东新区花木路 · 世纪公园' }, { name: '公司', address: '上海市浦东新区张江 · 集电港' },
    { name: '常用充电站', address: '上海市浦东新区 · 龙阳路充电站' },
  ] : []);
  const paint = paintSets[currentId] ?? defaultPaint;
  const name = names[currentId] || vehicle?.nickname || '我的车辆';
  const tireRangeKey = cloudKey || currentId;
  const tireRange = tireRanges[tireRangeKey] ?? { min: 200, max: 270 };
  const tireAlerts = current.tires.map(pressure => pressure !== null && (pressure < tireRange.min || pressure > tireRange.max));

  async function logout() {
    if (mode === 'cloud') {
      await clearCloud();
      if (cloud) {
        const vins = new Set([...vehicles, ...cloud.vehicles].map(item => item.vin.toUpperCase()).filter(Boolean));
        await Promise.allSettled([...vins].map(vin => forgetOperationPin(JSON.stringify([cloud.account.userId, vin]))));
      }
      qc.removeQueries({ queryKey: ['operation-auth'] });
    }
    if (mode === 'ha') await ha.disconnect();
    setCloud(null);
    setCloudExpired(false);
    setMode(null);
    setVehicleId('');
    qc.removeQueries({ queryKey: ['cloud'] });
    await widgetBridge.clear();
  }
  function chooseMode(next: Mode, session?: LiveVehicles) {
    setCloud(next === 'cloud' ? session ?? null : null);
    setCloudExpired(false);
    setMode(next);
    const nextVehicles = next === 'cloud' ? session?.vehicles ?? [] : next === 'ha' ? [haVehicle] : demoVehicles;
    if (!nextVehicles.some(v => v.id === vehicleId)) setVehicleId(next === 'ha' ? haVehicle.id : '');
    if (next === 'ha') setSource('ha');
    else if (next === 'demo') setDebug(normalDemo);
  }
  async function refresh(notify = false) {
    if (mode === 'cloud' && client && !expired) {
      const result = await cloudState.refetch({ cancelRefetch: false });
      if (notify && !(result.error instanceof CloudSessionExpired)) {
        setToast(result.error ? failureLabels[failureFacts(result.error).kind] + (result.data ? '，显示上次车况' : '，暂无车况') : (result.data?.reportedAt ?? result.data?.updatedAt) === vehicleReport ? '已查询，车辆暂无新上报' : '车况已更新');
      }
      return;
    }
    if (simulated && scenario !== 'offline' && scenario !== 'pending') setDebug(s => ({ ...s, scenario: 'normal' }));
    else if (mode === 'ha' && notify) setToast('请登录零跑账号查看实时车况。');
  }
  async function refreshVehicles() {
    if (!client) { await refresh(); return; }
    const result = await cloudVehicles.refetch({ cancelRefetch: false });
    if (result.error) throw result.error;
  }
  async function clearLocal() {
    setSource('off');
    await qc.cancelQueries({ queryKey: ['cloud'], predicate: q => ['charges', 'cached-charges', 'energy'].includes(String(q.queryKey[1])) });
    await Promise.all([ha.clearHistory(), cloudRecords.clear(),
      ...(currentId ? [clearLegacyPhoneRecording(currentId), deleteDataset('phone:' + currentId)] : [])]);
    qc.removeQueries({ queryKey: ['cloud'], predicate: q => ['charges', 'cached-charges', 'energy'].includes(String(q.queryKey[1])) });
    if (simulated) setLocalRecords(false);
  }

  return {
    mode, booted, vehicle, vehicles, vehicleId, setVehicleId, name, source, setSource, usesPhone, usesHA, theme, setTheme, themeAccent, setThemeAccent,
    profileScope, accountMaskedPhone: cloud?.account.maskedPhone,
    colorScheme, systemColorScheme: preferredTheme, tariff, baseTariff, setTariff,
    batteryPacks, energySettings, powertrainInfo, rangeSource: range.source, rangeReadings: ranges,
    shouldGuideBatterySetup: (car: Vehicle) =>
      mode === 'cloud' && !!cloud && !expired && (!car.shared || car.grants?.mileage === true) &&
      !Object.hasOwn(vehicleEnergySettings, vehicleEnergyScope(car)),
    skipBatterySetup: () => {
      if (mode === 'cloud' && energyScope && !expired && grants.mileage) {
        setVehicleEnergySettings(values => Object.hasOwn(values, energyScope) ? values : { ...values, [energyScope]: null });
      }
    },
    setEnergySettings: (settings: VehicleEnergySettings) => {
      if (energyScope && currentId && !expired && grants.mileage) {
        setVehicleEnergySettings(values => ({ ...values, [energyScope]: settings }));
      }
    },
    demo: mode === 'demo', simulated, debug, setDebug, expired, canSee, grants, scenario, current, records, tripScope, canDeleteTrip, deleteTrip, ha, background, client, cloudKey, cloudRecords, operationScope,
    findTrip: (id?: string) => records.trips.find(row => row.id === id || !!id && combinedTrips?.aliases.get(row.id)?.includes(id)),
    findCharge: (id?: string) => records.charges.find(row => row.id === id || !!id &&
      (row.sampledId === id || combinedCharges?.aliases.get(row.id)?.includes(id))),
    favorites, paint, hasCustomPaint: !!paintSets[currentId], toast, setToast, refresh, refreshing: cloudState.isFetching,
    stateFailure: cloudState.isError ? failureLabels[failureFacts(cloudState.error).kind] : '',
    cloudDiagnostics: {
      listStatus: cloudVehicles.status, listLastSuccess: cloudVehicles.dataUpdatedAt, listFailure: () => readFailure(profileScope, 'list'),
      stateStatus: cloudState.status, stateLastSuccess: cloudState.dataUpdatedAt, stateFailure: () => readFailure(cloudKey, 'state'),
      readList: async () => {
        const result = await cloudVehicles.refetch({ cancelRefetch: false, throwOnError: true });
        return { result: '成功 · ' + (result.data?.length ?? 0) + ' 辆授权车辆' };
      },
      readState: async () => {
        await cloudState.refetch({ cancelRefetch: false, throwOnError: true });
        return { result: '成功' };
      },
    },
    controlStateReady: cloudState.isSuccess,
    tireRange, tireAlerts, setTireRange: (range: typeof tireRange) => setTireRanges(all => ({ ...all, [tireRangeKey]: range })),
    controlClient, showControlState, showConfirmedControl, refreshChargePlan, expireCloud: () => setCloudExpired(true),
    refreshVehicles, vehiclesLoading: cloudVehicles.isFetching, vehiclesError: cloudVehicles.isError, clearLocal, chooseMode, logout,
    rename: (model: Vehicle, name: string) => setNames(values => ({ ...values, [model.id]: [...name.trim()].slice(0, 10).join('') })),
    setPaint: (hex: string, name: string) => setPaintSets(values => ({ ...values, [currentId]: { hex, name } })),
    setFavorites: (next: typeof favorites) => setFavoriteSets(values => ({ ...values, [currentId]: next })),
    energyPlaceholder: (days: number) => mode === 'ha' ? dailyEnergy(ha.frames, days) : simulated ? demoEnergy(days) : dailyEnergy([], days),
  };
}
type Model = ReturnType<typeof useModel>;
const Context = createContext<Model | null>(null);
export function ModelProvider({ children, widgetControl = false }: { children: ReactNode; widgetControl?: boolean }) {
  return <Context.Provider value={useModel(widgetControl)}>{children}</Context.Provider>;
}
export function useModelContext() {
  const context = useContext(Context);
  if (!context) throw new Error('缺少应用会话');
  return context;
}
