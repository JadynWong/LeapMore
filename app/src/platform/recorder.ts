import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

interface RecorderPlugin {
  start(options: { delay: number }): Promise<void>;
  stop(): Promise<void>;
  setDelay(options: { delay: number }): Promise<void>;
  clear(options: { vehicle: string }): Promise<void>;
  addListener(event: 'poll', callback: () => void): Promise<PluginListenerHandle>;
  addListener(event: 'status', callback: (status: { running: boolean; reason: string }) => void): Promise<PluginListenerHandle>;
}
export const recorder = registerPlugin<RecorderPlugin>('LeapRecorder');
export const hasBackgroundRecorder = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('LeapRecorder');
export async function clearLegacyPhoneRecording(vehicle: string) {
  if (Capacitor.isPluginAvailable('LeapRecorder')) await recorder.clear({ vehicle });
}
