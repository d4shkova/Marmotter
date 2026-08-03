import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/web'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/index.ts', '**/*.d.ts'],
      // CLAUDE.md / BUILD_PLAN Phase 1: packages/protocol must stay above 90%.
      thresholds: {
        'packages/protocol/src/**': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        // Phase 3. Lower on branches than protocol because the reducer has one
        // per numeric and per capability, many of which are a single line of
        // state assignment. The floor is here to stop it sliding, not to chase
        // a number.
        'packages/client/src/**': {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
      },
    },
  },
});
