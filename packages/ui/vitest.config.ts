import { defineConfig } from 'vitest/config';
import { workspaceAlias } from '../../vitest.alias';

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    name: 'ui',
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
