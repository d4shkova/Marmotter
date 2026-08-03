import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { workspaceAlias } from '../../workspace.alias';

/**
 * Workspace packages resolve to their sources rather than their `dist/`
 * builds, so the dev server always shows what is on disk. See
 * `workspace.alias.ts`.
 */

export default defineConfig({
  resolve: { alias: workspaceAlias },
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
