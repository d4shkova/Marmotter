import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end, against a real ircd.
 *
 * BUILD_PLAN's Phase 5 and Phase 6 acceptance both turn on this: unit tests can
 * show that a panel builds the right command, and nothing but a round trip
 * shows that the server accepts it and that the reply lands where the interface
 * expects. Phase 6's second half — the same run against Atheme-backed InspIRCd
 * — is not here yet.
 *
 * The browser build is what gets driven, because ergo speaks WebSocket and a
 * browser is a great deal cheaper to automate than a Tauri window. Everything
 * under test is the shared `Marmotter` component; only the transport differs,
 * so this exercises the desktop client's own interface.
 */
const chromiumPath = process.env['PLAYWRIGHT_CHROMIUM_PATH'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // The tests are about what a person sees, so they wait on the interface
    // rather than on the network; a slow ircd should be a slow pass, not a
    // flake.
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Some environments ship a Chromium already and forbid downloading
        // another. Pointing at it beats pinning a Playwright version to
        // whatever revision happens to be installed.
        ...(chromiumPath === undefined ? {} : { launchOptions: { executablePath: chromiumPath } }),
      },
    },
  ],

  webServer: [
    {
      // `run` rather than a pre-started daemon, so a failed test run cannot
      // leave a server holding the port for the next one.
      command: 'ergo run --conf e2e/ergo.yaml',
      port: 18097,
      reuseExistingServer: process.env['CI'] === undefined,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // The Anope half of Phase 6's acceptance. InspIRCd's client port is what
      // is polled; `run.sh` starts services behind it in the right order.
      command: './e2e/anope/run.sh',
      port: 16668,
      reuseExistingServer: process.env['CI'] === undefined,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @marmotter/web preview --port 4173 --strictPort',
      port: 4173,
      reuseExistingServer: process.env['CI'] === undefined,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
