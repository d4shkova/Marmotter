import { readFileSync } from 'node:fs';

/**
 * An app's own version, for its Vite config to hand the bundle.
 *
 * Read from the `package.json` beside the config rather than written out again,
 * because a version that has to be updated in two places is one that will
 * disagree with itself — and the place it would show up is a settings export
 * claiming to have been written by a build that never existed.
 *
 * Used as `define: { __MARMOTTER_VERSION__: JSON.stringify(versionOf(import.meta.url)) }`.
 * See `packages/ui/src/app/version.ts` for the other end.
 */
export function versionOf(configUrl: string): string {
  const manifest = JSON.parse(readFileSync(new URL('./package.json', configUrl), 'utf8')) as {
    version?: string;
  };
  return manifest.version ?? '';
}
