import { fileURLToPath } from 'node:url';

/**
 * Workspace packages resolve to their sources, everywhere.
 *
 * Two reasons, and both are the same reason. BUILD_PLAN Phase 0 requires
 * `pnpm test` to pass before `pnpm build`, so tests cannot depend on `dist/`
 * existing. And a dev server that reads `dist/` shows whatever was last built
 * rather than what is on disk — which fails as a blank window and a list of
 * missing exports, with nothing pointing at the stale build that caused it.
 *
 * Aliasing to source removes that failure mode and gives hot reload across
 * package boundaries. The `dist/` builds still exist and `pnpm build` still
 * produces them; nothing in development reads them.
 */

const dir = (pkg: string): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/`, import.meta.url));

const entry = (pkg: string): string => `${dir(pkg)}index.ts`;

const PACKAGES = ['protocol', 'shared', 'client', 'ui'] as const;

/**
 * Anchored patterns rather than a bare record of prefixes.
 *
 * Vite treats a string alias key as a prefix, which rewrites
 * `@marmotter/ui/styles.css` into a path *inside* `index.ts` and then fails
 * with an error naming neither the alias nor the import. Matching the bare
 * specifier exactly, and subpaths separately, is the only form that gets both
 * right.
 */
export const workspaceAlias = [
  ...PACKAGES.map((pkg) => ({
    find: new RegExp(`^@marmotter/${pkg}$`),
    replacement: entry(pkg),
  })),

  // Subpath exports — `@marmotter/ui/styles.css` and `tokens.css` — are real
  // files that ship as they are, so they map straight into the source tree.
  ...PACKAGES.map((pkg) => ({
    find: new RegExp(`^@marmotter/${pkg}/(.*)$`),
    replacement: `${dir(pkg)}$1`,
  })),
];
