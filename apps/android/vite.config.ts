import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { workspaceAlias } from '../../workspace.alias';

/**
 * `tauri android dev` serves the frontend to a device or emulator over the
 * network rather than over localhost, so the dev server has to listen on an
 * address the phone can reach. The CLI sets `TAURI_DEV_HOST` to that address;
 * without it the server binds to localhost and the app opens on a blank page.
 */
const host = process.env['TAURI_DEV_HOST'];

export default defineConfig({
  resolve: { alias: workspaceAlias },
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host ?? false,
    ...(host ? { hmr: { protocol: 'ws', host, port: 1422 } } : {}),
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    // The floor Tauri's Android webview guarantees. Android 13's WebView is
    // evergreen and well past this, but an es2022 bundle assumes a browser
    // nobody has audited on the oldest device we claim to run on.
    target: 'es2022',
    sourcemap: true,
  },
});
