// @vitest-environment node
// Reads files off disk, so it needs Node rather than the jsdom default:
// under jsdom `import.meta.url` is an http URL and cannot be resolved to a path.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * BUILD_PLAN phase 4 acceptance: no hardcoded colour exists anywhere in
 * `packages/ui` outside `tokens.css`.
 *
 * This is what makes theming later a token swap rather than a refactor, and it
 * is the kind of rule that decays the moment it stops being checked — one
 * `#1a2430` in a component is invisible in review and invisible in the
 * rendered output until somebody switches theme.
 */

const root = join(fileURLToPath(new URL('.', import.meta.url)));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx|css)$/.test(entry) ? [path] : [];
  });
}

const files = sourceFiles(root).filter(
  (path) =>
    !path.endsWith('tokens.css') &&
    // Tests naming the literals they check are the point of those tests, and
    // nothing they contain ships.
    !/\.test\.(ts|tsx)$/.test(path),
);

/** `#abc`, `#aabbcc`, `#aabbccdd`. */
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
/** `rgb(...)`, `rgba(...)`, `hsl(...)`, `oklch(...)` and friends. */
const FUNCTIONAL = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/g;
/** Tailwind's own palette, which would bypass the tokens entirely. */
const TAILWIND_PALETTE =
  /\b(?:bg|text|border|fill|stroke|from|via|to|ring|outline|shadow|decoration|accent|caret|divide)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

describe('no colour literals outside tokens.css', () => {
  it.each(files.map((path) => [path.slice(root.length), path]))(
    '%s uses tokens rather than literals',
    (_name, path) => {
      const source = readFileSync(path, 'utf8');
      expect(source.match(HEX) ?? [], 'hex literal').toEqual([]);
      expect(source.match(FUNCTIONAL) ?? [], 'colour function').toEqual([]);
      expect(source.match(TAILWIND_PALETTE) ?? [], "Tailwind's own palette").toEqual([]);
    },
  );

  it('checks a meaningful number of files, so a broken glob cannot pass', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('does check the components, not only the helpers', () => {
    expect(files.some((path) => path.includes('primitives'))).toBe(true);
    expect(files.some((path) => path.includes('decoder'))).toBe(true);
  });
});

describe('no named CSS colours either', () => {
  // `white` and `black` are the two that slip in: they read as neutral rather
  // than as a colour choice, and they are exactly what a light theme has to
  // change.
  const NAMED = /\b(?:bg|text|border|fill|stroke|ring|decoration)-(?:white|black)\b/g;

  it.each(files.map((path) => [path.slice(root.length), path]))(
    '%s names no raw colour',
    (_name, path) => {
      expect(readFileSync(path, 'utf8').match(NAMED) ?? []).toEqual([]);
    },
  );
});
