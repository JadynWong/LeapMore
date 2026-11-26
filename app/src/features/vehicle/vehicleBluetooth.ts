import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { useModelContext } from '../context';

export const proximityFeatures = [
  ['remote', '手机遥控器', 'phone'], ['straight', '直进直出', 'straight'], ['parking', '泊车辅助', 'parking'],
] as const;
type Feature = typeof proximityFeatures[number][0];
type Identity = { vin: string; accountId: string };
type VehicleSession = Identity & { connected: boolean; authenticated: boolean; features: Feature[] };

// On platforms with an OEM integration, the native driver owns both authentication and the live control surface.
const driver = registerPlugin<{
  getSession(identity: Identity): Promise<VehicleSession>;
  openControl(options: Identity & { feature: Feature }): Promise<void>;
  addListener(event: 'sessionChanged', listener: () => void): Promise<PluginListenerHandle>;
}>('VehicleBluetooth');
function matches(session: VehicleSession | null, vehicle: Identity) {
  return session?.connected === true && session.authenticated === true && session.vin === vehicle.vin &&
    session.accountId === vehicle.accountId && Array.isArray(session.features);
}
export function useVehicleBluetooth() {
  const m = useModelContext();
  const vin = m.vehicle?.vin ?? '';
  const accountId = m.profileScope.replace(/^cloud:/, '');
  const allowed = !!vin && !m.expired && m.canSee('control');
  const demo = allowed && m.simulated;
  const hasDriver = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('VehicleBluetooth');
  const live = allowed && !!m.client && hasDriver;
  const [session, setSession] = useState<VehicleSession | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    let listening = false;
    setSession(null);
    const refresh = () => {
      if (!active) return;
      const current = ++revision.current;
      setSession(null);
      if (listening && !document.hidden) void driver.getSession({ vin, accountId }).then(session => {
        if (current === revision.current) setSession(session);
      }).catch(() => {});
    };
    const listener = live ? driver.addListener('sessionChanged', refresh) : null;
    void listener?.then(() => { listening = true; refresh(); }).catch(() => {});
    document.addEventListener('visibilitychange', refresh);
    return () => { ++revision.current; active = false; document.removeEventListener('visibilitychange', refresh); void listener?.then(h => h.remove()).catch(() => {}); };
  }, [vin, accountId, live]);
  const connected = demo || live && matches(session, { vin, accountId });
  const supports = (id: Feature) => connected && (demo || !!session?.features.includes(id));
  const identity = useRef({ vin, accountId, live });
  identity.current = { vin, accountId, live };
  async function open(feature: Feature) {
    if (!live || !supports(feature)) return;
    const opening = ++revision.current;
    const current = () => opening === revision.current && !document.hidden && identity.current.live &&
      identity.current.vin === vin && identity.current.accountId === accountId;
    try {
      const fresh = await driver.getSession({ vin, accountId });
      if (!current()) return;
      setSession(fresh);
      if (!matches(fresh, { vin, accountId }) || !fresh.features.includes(feature)) throw new Error();
      await driver.openControl({ vin, accountId, feature });
    } catch { if (current()) { setSession(null); m.setToast('车辆蓝牙连接不可用，请重新连接。'); } }
  }
  return { connected, supports, open, label: demo ? '演示蓝牙已连接' : !hasDriver ? '当前版本未接入' : connected ? '蓝牙已连接' : '蓝牙未连接' };
}
