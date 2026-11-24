import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.leapmore.app',
  appName: 'LeapMore',
  webDir: 'dist',
  loggingBehavior: 'none',
  // Android WebView needs mixed content for ws:// on a user-configured local HA.
  android: { allowMixedContent: true, webContentsDebuggingEnabled: process.env.LEAPMORE_WEBVIEW_DEBUG === '1' },
  ios: { contentInset: 'never' },
  plugins: { CapacitorHttp: { enabled: false } },
};
export default config;
