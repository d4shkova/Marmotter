import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { workspaceAlias } from '../../workspace.alias';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceAlias },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
