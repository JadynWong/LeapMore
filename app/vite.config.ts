import { cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  const target = env.VITE_HA_DEV_PROXY_ORIGIN?.replace(/\/+$/, '');
  return {
    base: './',
    define: {
      __LEAPMORE_VERSION__: JSON.stringify(version),
      __LEAPMORE_LOCAL_ASSETS__: JSON.stringify(env.LEAPMORE_LOCAL_CAR_ASSETS === '1'),
      __LEAPMORE_LOCAL_3D__: JSON.stringify(env.LEAPMORE_LOCAL_3D_DEMO === '1'),
    },
    plugins: [react(), {
      name: 'leapmore-public-assets',
      apply: 'build',
      closeBundle() {
        for (const folder of ['assets', 'viewer', ...(env.LEAPMORE_LOCAL_3D_DEMO === '1' ? ['car3d-demo'] : [])]) {
          const from = resolve(import.meta.dirname, 'public', folder);
          if (!existsSync(from)) continue;
          cpSync(from, resolve(import.meta.dirname, 'dist', folder), { recursive: true, dereference: true,
            filter: source => !/[/\\](\.DS_Store|wechat-reward-qr\.png|skybox_night_starry\.jpg)$/.test(source) &&
              (env.LEAPMORE_LOCAL_CAR_ASSETS === '1' || !/[/\\](b10|c10|hero-day|hero-night)\.png$/.test(source)),
          });
        }
      },
    }],
    build: { copyPublicDir: false, rollupOptions: { input: {
      index: resolve(import.meta.dirname, 'index.html'),
      callback: resolve(import.meta.dirname, 'ha-callback.html'),
    } } },
    server: target ? { proxy: {
      '^/__ha/(api/states(?:\\?|$)|api/websocket$|api/history/period/|auth/token(?:\\?|$))': {
        target, changeOrigin: true, ws: true, rewrite: path => path.replace(/^\/__ha/, ''),
        configure(proxy) {
          proxy.on('proxyReq', request => {
            request.removeHeader('cookie');
            request.removeHeader('origin');
            request.removeHeader('referer');
          });
        },
      },
    } } : undefined,
  };
});
