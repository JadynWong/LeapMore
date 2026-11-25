import { Capacitor, registerPlugin } from '@capacitor/core';

interface DesktopState {
  vehicle: string;
  soc: string;
  range: string;
  rangeLabel: string;
  fuel: string;
  state: string;
  charging: string;
  chargeStatus: string;
  power: string;
  inside: string;
  locked: string;
  odometer: string;
  colorScheme: 'light' | 'dark';
  climateOn: boolean;
  trunkOpen: boolean;
  lockAction: string;
  climateAction: string;
  trunkAction: string;
  findAction: string;
  simulated: boolean;
  canLock: boolean;
  canControl: boolean;
  canTrunk: boolean;
  canFind: boolean;
}
export type WidgetControlRequest = { action: string; vehicle: string };
const plugin = registerPlugin<{
  update(options: { summary: DesktopState }): Promise<void>;
  clear(): Promise<void>;
  take(): Promise<{ action?: string }>;
  closeControl(): Promise<void>;
}>('LeapWidget');
export const widgetBridge = {
  async update(state: DesktopState) { if (Capacitor.isPluginAvailable('LeapWidget')) await plugin.update({ summary: state }).catch(() => {}); },
  async take(): Promise<{ action?: string }> { return ['openharmony', 'ios'].includes(Capacitor.getPlatform()) ? plugin.take() : {}; },
  async clear() { if (Capacitor.isPluginAvailable('LeapWidget')) await plugin.clear().catch(() => {}); },
  async closeControl() { await plugin.closeControl().catch(() => {}); },
};

export function androidWidgetControl(): WidgetControlRequest | null {
  if (Capacitor.getPlatform() !== 'android') return null;
  const params = new URLSearchParams(location.search);
  const action = params.get('widget-control');
  const vehicle = params.get('vehicle');
  return action && vehicle && ['lock', 'climate', 'trunk', 'find'].includes(action) ? { action, vehicle } : null;
}
