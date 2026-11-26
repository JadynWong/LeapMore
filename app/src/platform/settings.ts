import { Capacitor, registerPlugin } from '@capacitor/core';

export type AppIcon = 'simple' | 'original';

export interface AndroidBackgroundCheck {
  manufacturer: string;
  brand: string;
  sdk: number;
  release: string;
  notifications: boolean;
  batteryUnrestricted: boolean;
  backgroundRestricted: boolean | null;
  powerSave: boolean;
  recording: boolean;
}

export const nativeSettings = registerPlugin<{
  getAppIcon(): Promise<{ icon: AppIcon; canChange: boolean }>;
  setAppIcon(options: { icon: AppIcon }): Promise<void>;
  open(options: { target: string }): Promise<void>;
  openRelease(options: { url: string }): Promise<void>;
  diagnosticEnvironment(): Promise<{
    os: string; sdk: number; webViewVersion?: string; internetPermission?: boolean; activeNetwork?: boolean; networkInfoError?: number;
    wifi?: boolean; cellular?: boolean; ethernet?: boolean; vpn?: boolean; validated?: boolean; captivePortal?: boolean;
  }>;
  checkBackground(): Promise<AndroidBackgroundCheck>;
  openAmap(options: { app: string; web: string }): Promise<void>;
  saveRewardImage(): Promise<{ saved: boolean }>;
  saveText(options: { name: string; text: string }): Promise<{ saved: boolean }>;
  saveCsv(options: { name: string; text: string }): Promise<{ saved: boolean }>;
}>('LeapSettings');

export const saveRecordsCsv = (name: string, text: string) => saveTextFile(name, text);

export async function saveTextFile(name: string, text: string) {
  const plain = name.endsWith('.txt');
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LeapSettings')) {
    return (await (plain ? nativeSettings.saveText({ name, text }) : nativeSettings.saveCsv({ name, text }))).saved;
  }
  const url = URL.createObjectURL(new Blob([text], { type: plain ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
