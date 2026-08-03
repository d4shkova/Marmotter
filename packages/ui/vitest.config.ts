import { defineConfig } from 'vitest/config';
import { workspaceAlias } from '../../workspace.alias';

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    name: 'ui',
    // The token and dictionary tests need no DOM, but the component tests do,
    // and one environment for the package keeps the config honest.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
