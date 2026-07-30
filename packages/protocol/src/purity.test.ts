import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md makes purity a hard rule for this package: zero dependencies, zero
 * I/O, no React. The lint config enforces the import side; this asserts the
 * manifest side, so a stray `pnpm add` fails the build rather than the review.
 */
describe('packages/protocol purity', () => {
  const manifest: Record<string, unknown> = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as Record<string, unknown>;

  it('declares no runtime dependencies', () => {
    expect(manifest['dependencies']).toBeUndefined();
  });

  it('declares no peer dependencies', () => {
    expect(manifest['peerDependencies']).toBeUndefined();
  });

  it('declares no dev dependencies', () => {
    expect(manifest['devDependencies']).toBeUndefined();
  });
});
