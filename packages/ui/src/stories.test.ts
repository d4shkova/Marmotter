// @vitest-environment node
// Reads files off disk, so it needs Node rather than the jsdom default.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * BUILD_PLAN phase 4 acceptance: Storybook covers every component.
 *
 * Checked rather than trusted, because a component added without a story is
 * invisible until somebody needs it and finds it broken. Stories are grouped by
 * theme rather than one file per component, so the check is that every exported
 * component appears in some story file — not that a file exists per component.
 */

const root = fileURLToPath(new URL('.', import.meta.url));

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const all = filesUnder(root);

const componentFiles = all.filter(
  (path) => path.endsWith('.tsx') && !path.endsWith('.stories.tsx') && !path.endsWith('.test.tsx'),
);

/** Comments stripped: a story explaining why it avoids placeholder copy would
 *  otherwise trip the check that it avoids placeholder copy. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const storySource = all
  .filter((path) => path.endsWith('.stories.tsx'))
  .map((path) => withoutComments(readFileSync(path, 'utf8')))
  .join('\n');

/** Exported component names, which are the ones starting with a capital. */
function exportedComponents(source: string): string[] {
  return [...source.matchAll(/export function ([A-Z]\w+)/g)].map((match) => match[1] ?? '');
}

describe('every component has a story', () => {
  it.each(
    componentFiles.flatMap((path) =>
      exportedComponents(readFileSync(path, 'utf8')).map((name) => [basename(path), name] as const),
    ),
  )('%s exports %s, and a story uses it', (_file, name) => {
    expect(storySource.includes(`<${name}`), `no story renders <${name}>`).toBe(true);
  });

  it('found components to check, so a broken glob cannot pass', () => {
    expect(componentFiles.length).toBeGreaterThan(15);
  });
});

describe('stories are written with real copy', () => {
  it('uses no placeholder text', () => {
    // Placeholder copy hides the two things a story exists to show: whether a
    // real label fits, and whether it reads the way the copy rules require.
    for (const placeholder of ['Lorem ipsum', 'foo bar', 'Button 1', 'Test Title']) {
      expect(storySource.includes(placeholder), placeholder).toBe(false);
    }
  });
});
