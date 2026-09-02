// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/**
 * The browser globals that compile at the root and fail the package build.
 *
 * `tsconfig.json` — what `pnpm typecheck` uses — includes `DOM` in `lib`,
 * because the UI package needs it. The per-package `tsconfig.build.json` files
 * do not, and those are what `pnpm build` and CI compile with. So a `window` in
 * one of the DOM-free packages typechecks locally, passes the tests, and then
 * fails the build on a runner: the two configs disagree, and only one of them
 * runs before a push.
 *
 * Naming them here closes that gap at lint time, in seconds rather than in a
 * two-minute build, and says what to do instead. `packages/client` runs in both
 * Tauri shells and the browser and may well need a browser API — it reaches for
 * it through `globalThis` with a locally declared shape, the way
 * `transport/websocket.ts` describes `WebSocketLike` and `liveness.ts`
 * describes its event target.
 */
const domGlobals = ['window', 'document', 'navigator', 'location', 'history'].map((name) => ({
  name,
  message:
    `\`${name}\` is not available to this package: it builds without the DOM lib, so this ` +
    'passes `pnpm typecheck` and fails `pnpm build`. Reach it through `globalThis` with a ' +
    'locally declared shape, as `transport/websocket.ts` and `liveness.ts` do.',
}));

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/storybook-static/**',
      '**/target/**',
      '**/node_modules/**',
      'apps/desktop/src-tauri/gen/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.es2022 },
    },
    rules: {
      // CLAUDE.md: TypeScript strict. No `any`. No non-null assertions.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // CLAUDE.md: packages/protocol is pure. Zero dependencies, zero I/O, no React.
  {
    files: ['packages/protocol/src/**/*.ts'],
    ignores: ['packages/protocol/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-*',
                'node:*',
                'fs',
                'path',
                'net',
                'tls',
                'crypto',
                'http',
                'https',
                '@marmotter/*',
              ],
              message:
                'packages/protocol must stay pure: no I/O, no React, no workspace dependencies.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'packages/protocol performs no I/O.' },
        { name: 'WebSocket', message: 'packages/protocol performs no I/O.' },
        { name: 'localStorage', message: 'packages/protocol performs no I/O.' },
        { name: 'indexedDB', message: 'packages/protocol performs no I/O.' },
        ...domGlobals,
      ],
    },
  },

  // CLAUDE.md: message content never touches localStorage or IndexedDB. Plus
  // the DOM globals these packages build without — see `domGlobals` above.
  {
    files: ['packages/client/src/**/*.ts', 'packages/shared/src/**/*.ts'],
    ignores: ['packages/*/src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: 'Message content must never be persisted to web storage. See CLAUDE.md.',
        },
        {
          name: 'sessionStorage',
          message: 'Message content must never be persisted to web storage. See CLAUDE.md.',
        },
        {
          name: 'indexedDB',
          message: 'Message content must never be persisted to web storage. See CLAUDE.md.',
        },
        ...domGlobals,
      ],
    },
  },

  {
    files: ['packages/ui/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    files: ['**/*.test.{ts,tsx}', '**/*.config.{ts,js}', '**/vitest.workspace.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },

  prettier,
);
