import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The Tauri shells' own tests moved to `packages/platform-tauri` with the
    // code they cover, so `apps/desktop` and `apps/android` hold only the
    // handful of files that are genuinely one platform's own.
    projects: ['packages/*', 'apps/web'],
    // Vitest's own default is five seconds, which a shared CI runner does not
    // reliably clear: it runs about three times slower than a developer's
    // machine, and the parser fuzzing already lands at four seconds there. That
    // makes a red build mean "the runner was busy" often enough to stop meaning
    // anything. Fifteen is still far short of any test that has actually hung,
    // and no assertion is weakened by waiting longer for it.
    testTimeout: 15_000,
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
