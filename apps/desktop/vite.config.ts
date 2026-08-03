import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { workspaceAlias } from '../../workspace.alias';

// Tauri drives the dev server on a fixed port and watches the frontend only.
const host = process.env['TAURI_DEV_HOST'];

/**
 * Workspace packages resolve to their sources rather than their `dist/`
 * builds, so the dev server always shows what is on disk. See
 * `workspace.alias.ts`.
 */

export default defineConfig({
  resolve: { alias: workspaceAlias },
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    ...(host ? { hmr: { protocol: 'ws', host, port: 1421 } } : {}),
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
