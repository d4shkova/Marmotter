import { fileURLToPath } from 'node:url';

/**
 * Workspace packages resolve to their sources under test.
 *
 * BUILD_PLAN Phase 0 requires `pnpm test` to pass before `pnpm build`, so tests
 * cannot depend on `dist/` existing.
 */
const src = (pkg: string): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export const workspaceAlias: Record<string, string> = {
  '@marmotter/protocol': src('protocol'),
  '@marmotter/shared': src('shared'),
  '@marmotter/client': src('client'),
  '@marmotter/ui': src('ui'),
};
