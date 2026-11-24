import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { focusManager } from '@tanstack/react-query';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Login, Subaccount, VehicleAccess, VehicleList } from './features/account/pages';
import { ChargingPage, ClimatePage, DrivingLock, VehicleControl } from './features/vehicle/pages';
import { LocationPage } from './features/vehicle/Location';
import { VehicleSurfaces } from './features/appearance/VehicleSurfaces';
import { VehicleVisualProvider } from './features/appearance/VehicleModel';
import { ChargeDetail, RecordsPage, RecordsSource, TripDetail } from './features/records/pages';
import { EnergyPage } from './features/records/Energy';
import { HAConnect } from './features/records/HA';
import { AmapSettings, AppAppearance, BackgroundGuide, Mine, OperationPin, States } from './features/settings/pages';
import { PublishWidget, WidgetAction, WidgetControl, WidgetPreview } from './features/vehicle/Widgets';
import { CommandProvider } from './features/vehicle/commands';
import { ControlsProvider } from './features/vehicle/controls';
import { useModelContext } from './features/context';
import { SlidingSelector } from './ui/SlidingSelector';
import { usePageScroll } from './ui/usePageScroll';
import { Icon } from './ui/Icon';
import { widgetBridge } from './platform/widgets';
import type { WidgetControlRequest } from './platform/widgets';

const tabs = [
  ['/home', '车辆', 'car'], ['/records', '记录', 'route'], ['/energy', '统计', 'chart'], ['/mine', '我的', 'user'],
] as const;
const mineRoutes = ['/mine', '/mine/appearance'];
const watchSize = (callback: () => void) => {
  const list = matchMedia('(max-width: 340px)');
  list.addEventListener('change', callback);
  return () => list.removeEventListener('change', callback);
};
const compactSize = () => matchMedia('(max-width: 340px)').matches;

function NativeLinks() {
  const navigate = useNavigate();
  const latestNavigate = useRef(navigate);
  useLayoutEffect(() => { latestNavigate.current = navigate; }, [navigate]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'openharmony') return;
    const listener = NativeApp.addListener('appStateChange', ({ isActive }) => focusManager.setFocused(isActive));
    return () => { focusManager.setFocused(undefined); void listener.then(x => x.remove()).catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let receivedWidgetLink = false;
    const open = (url: string) => {
      let intent: URL;
      try { intent = new URL(url); } catch { return; }
      if (intent.protocol !== 'com.leapmore.app:' || intent.hostname !== 'widget' || intent.pathname !== '/action') return;
      receivedWidgetLink = true;
      const action = intent.searchParams.get('action');
      if (action && ['lock', 'climate', 'trunk', 'find'].includes(action)) latestNavigate.current('/widget-action?action=' + action);
      else latestNavigate.current('/home');
    };
    let stopPolling = () => {};
    if (['openharmony', 'ios'].includes(Capacitor.getPlatform())) {
      let running = false;
      const take = () => {
        if (document.hidden || running) return;
        running = true;
        void widgetBridge.take().then(({ action }) => {
          if (action) open('com.leapmore.app://widget/action?action=' + encodeURIComponent(action));
        }).catch(() => {}).finally(() => { running = false; });
      };
      const timer = setInterval(take, 1250);
      document.addEventListener('visibilitychange', take);
      stopPolling = () => { clearInterval(timer); document.removeEventListener('visibilitychange', take); };
    }
    if (Capacitor.getPlatform() === 'openharmony') return stopPolling;
    const listener = NativeApp.addListener('appUrlOpen', e => open(e.url));
    // Android retains the initial appUrlOpen event until the listener is registered.
    let active = true;
    if (Capacitor.getPlatform() === 'ios') {
      void listener.then(() => NativeApp.getLaunchUrl()).then(event => {
        if (active && !receivedWidgetLink && event?.url) open(event.url);
      }).catch(() => {});
    }
    return () => { active = false; stopPolling(); void listener.then(x => x.remove()).catch(() => {}); };
  }, []);
  return null;
}

function Screen() {
  const m = useModelContext();
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;
  const body = useRef<HTMLDivElement>(null);
  const scrollingPage = path === '/records' ? path + location.search : path;
  const atHome = path === '/home';
  const atEnergy = path === '/energy';
  const navigationHidden = usePageScroll(body, scrollingPage, { hideNavigation: path === '/records', rebound: !atHome });
  const compact = useSyncExternalStore(watchSize, compactSize);
  const tab = tabs.findIndex(t => t[0] === path);
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).has('preview') && path === '/widgets';
  const authRoutes = ['/welcome', '/login', '/subaccount', '/ha'];
  const publicRoutes = [...authRoutes, '/vehicle-access'];
  const main = m.booted && !m.expired && m.vehicle && tab >= 0;
  const atAppearance = path === '/appearance';
  const homeKey = m.booted && !m.expired && m.mode && m.vehicle ? JSON.stringify([m.mode, m.cloudKey, m.vehicle.id]) : '';
  const energyKey = homeKey && (m.mode === 'ha' ? JSON.stringify([homeKey, m.ha.config?.url, m.ha.vin]) : homeKey);
  const [openedEnergy, setOpenedEnergy] = useState('');
  useEffect(() => { if (atEnergy || !energyKey) setOpenedEnergy(energyKey); }, [atEnergy, energyKey]);
  const energyScroll = useRef({ key: '', top: 0 });
  const scrollKey = atEnergy ? energyKey : '';
  const focus = useRef(path);
  useLayoutEffect(() => {
    body.current?.scrollTo({ top: scrollKey && energyScroll.current.key === scrollKey ? energyScroll.current.top : 0 });
    if (focus.current !== path) body.current?.focus({ preventScroll: true });
    focus.current = path;
  }, [path, scrollingPage, scrollKey]);
  const [openedVehicle, setOpenedVehicle] = useState('');
  const vehicleView = atHome ? 'home' : atAppearance ? 'appearance' : null;
  useEffect(() => {
    if (vehicleView || !homeKey) setOpenedVehicle(homeKey);
  }, [vehicleView, homeKey]);

  return <div className={'screen app-screen' + (compact ? ' compact' : '') + (path === '/home' ? ' home-screen bg-sky' : '') + (main ? ' with-nav' : '')}>
    <div className="view app-view" ref={body} tabIndex={-1} onScroll={atEnergy ? event => {
      energyScroll.current = { key: energyKey, top: event.currentTarget.scrollTop };
    } : undefined}>
      <div className={'app-scroll-content' + (atAppearance ? ' appearance-scroll-content' : '')}>
      {homeKey && (vehicleView || openedVehicle === homeKey) && <VehicleSurfaces key={homeKey} view={vehicleView} />}
      {!m.booted && !authRoutes.includes(path) ? <p className="loading">正在读取会话…</p> :
      !m.mode && !publicRoutes.includes(path) && !preview ? <Navigate to="/welcome" replace /> :
      m.expired && !['/login', '/vehicle-access', '/vehicles', '/states', ...mineRoutes].includes(path) ? <Navigate to="/login" replace /> :
      m.mode && !m.vehicle && ![...publicRoutes, '/vehicles', '/states', ...mineRoutes].includes(path) ? <Navigate to="/vehicles" replace /> :
      <Routes>
        <Route path="/" element={<Navigate to={m.vehicle ? '/home' : '/vehicles'} replace />} />
        <Route path="/welcome" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/subaccount" element={<Subaccount />} />
        <Route path="/vehicles" element={<VehicleList />} />
        <Route path="/vehicle-access" element={<VehicleAccess />} />
        <Route path="/home" element={null} />
        <Route path="/control" element={<VehicleControl />} />
        <Route path="/climate" element={<ClimatePage key={m.vehicleId} />} />
        <Route path="/charging" element={<ChargingPage key={m.vehicleId} />} />
        <Route path="/location" element={<LocationPage key={m.vehicleId} />} />
        <Route path="/appearance" element={null} />
        <Route path="/driving-lock" element={<DrivingLock />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/trips/:id" element={<TripDetail />} />
        <Route path="/charges/:id" element={<ChargeDetail />} />
        <Route path="/records-source" element={<RecordsSource />} />
        <Route path="/energy" element={null} />
        <Route path="/ha" element={<HAConnect />} />
        <Route path="/ha-mapping" element={<Navigate to="/ha" replace />} />
        <Route path="/mine" element={<Mine />} />
        <Route path="/mine/appearance" element={<AppAppearance />} />
        <Route path="/vehicle-manage" element={<VehicleList manage />} />
        <Route path="/operation-pin" element={<OperationPin />} />
        <Route path="/background-guide" element={<BackgroundGuide />} />
        <Route path="/amap" element={<AmapSettings />} />
        <Route path="/states" element={<States />} />
        <Route path="/widgets" element={<WidgetPreview />} />
        <Route path="/widget-action" element={<WidgetAction />} />
        <Route path="*" element={<Navigate to={m.vehicle ? '/home' : '/vehicles'} replace />} />
      </Routes>}
      {energyKey && (atEnergy || openedEnergy === energyKey) && <EnergyPage key={energyKey} active={atEnergy} />}
      </div>
    </div>
    {main && <SlidingSelector nav concealed={navigationHidden} label="主导航" selected={tab} change={index => { if (index !== tab) navigate(tabs[index][0]); }}
      optionLabels={tabs.map(([, label]) => label)} options={tabs.map(([, , icon]) => <Icon name={icon} size={23} />)} />}
    {m.toast && <div className="toast app-toast" role="status">{m.toast}</div>}
  </div>;
}
export default function App({ widgetControl }: { widgetControl: WidgetControlRequest | null }) {
  if (widgetControl) return <CommandProvider onClose={widgetBridge.closeControl}><ControlsProvider>
    <WidgetControl request={widgetControl} />
  </ControlsProvider></CommandProvider>;
  return <CommandProvider><ControlsProvider><VehicleVisualProvider><NativeLinks /><PublishWidget /><Screen /></VehicleVisualProvider></ControlsProvider></CommandProvider>;
}
