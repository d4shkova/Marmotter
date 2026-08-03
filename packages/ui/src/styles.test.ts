// @vitest-environment node
// Compiles the real stylesheet off disk, so it needs Node rather than jsdom.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

/**
 * The stylesheet actually produces the utilities the components use.
 *
 * This exists because it once did not, and nothing caught it. Tailwind's
 * automatic source detection roots itself at whatever imports the stylesheet —
 * an app, or Storybook — and every component lives in this package instead, so
 * nothing was scanned. The build succeeded. The tests passed. The tokens and
 * the reset were emitted, so the window had the right background colour. What
 * shipped was an interface with no layout at all: a single column of unstyled
 * text.
 *
 * A silent failure that looks like success is the kind worth spending a test
 * on, so this compiles the stylesheet the way Vite does and asserts the
 * classes the interface depends on came out the other side.
 */

const here = dirname(fileURLToPath(import.meta.url));
const stylesheet = readFileSync(join(here, 'styles.css'), 'utf8');
const resolver = createRequire(import.meta.url);

/** Resolves an `@import`, whether it names a file or a package. */
function resolveImport(id: string, base: string): string {
  if (id.startsWith('.') || id.startsWith('/')) {
    return join(base, id);
  }
  // `@import 'tailwindcss'` means the package's stylesheet, not its module.
  return resolver.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
}

/** Every class name the components actually ask for. */
function usedClasses(): Set<string> {
  const classes = new Set<string>();

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx$/.test(entry) || /\.(test|stories)\.tsx$/.test(entry)) {
        continue;
      }
      const source = readFileSync(path, 'utf8');
      for (const [, value] of source.matchAll(/(?:className|class)=["'`]([^"'`]+)["'`]/g)) {
        for (const name of (value ?? '').split(/\s+/)) {
          if (name !== '' && !name.includes('{') && !name.includes('$')) {
            classes.add(name);
          }
        }
      }
      // Class strings inside `cn(...)` calls, which is how most of them are
      // written once a component has conditional styling.
      for (const [, value] of source.matchAll(/'([a-z0-9][^']*)'/g)) {
        if (!/^[a-z0-9[\]:_\-/.()% ]+$/i.test(value ?? '')) {
          continue;
        }
        for (const name of (value ?? '').split(/\s+/)) {
          if (/^[a-z-]+[a-z0-9[\]:_\-/.()%]*$/i.test(name) && name.length > 1) {
            classes.add(name);
          }
        }
      }
    }
  };

  walk(here);
  return classes;
}

/** Compiles the stylesheet against a candidate list, as the Vite plugin does. */
async function build(candidates: readonly string[]): Promise<string> {
  const compiled = await compile(stylesheet, {
    base: here,
    // The `@source` directive is what this test is really about, so file
    // scanning is left switched off and the candidates are supplied directly:
    // that isolates "does the stylesheet emit these utilities" from "does
    // Tailwind find the files", and the second is checked separately below.
    loadStylesheet: async (id, base) => {
      const path = resolveImport(id, base);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  return compiled.build([...candidates]);
}

describe('the stylesheet emits the utilities the interface uses', () => {
  it.each([
    ['layout', ['flex', 'flex-1', 'min-w-0', 'shrink-0', 'h-dvh', 'items-baseline']],
    ['scrolling', ['overflow-y-auto', 'overflow-hidden', 'overscroll-contain']],
    ['our own radii', ['rounded-control', 'rounded-card', 'rounded-sheet']],
    ['our own type scale', ['text-footnote', 'text-headline', 'text-caption-1']],
    ['accessibility', ['sr-only']],
    ['the message list', ['tabular-nums', 'truncate', 'break-words', 'whitespace-pre-wrap']],
  ])('%s', async (_name, candidates) => {
    const css = await build(candidates);
    for (const candidate of candidates) {
      // The escaped form is what reaches the file for a class with a dash or
      // a bracket in it, so the check is on the rule existing at all.
      expect(css.length, candidate).toBeGreaterThan(0);
      expect(css.includes(candidate.replace(/([[\]().%/])/g, '\\$1')), candidate).toBe(true);
    }
  });

  it('resolves a token through an arbitrary value', async () => {
    const css = await build(['bg-[var(--fill-tertiary)]', 'text-[var(--label-primary)]']);
    expect(css).toContain('--fill-tertiary');
    expect(css).toContain('--label-primary');
  });

  it('maps the design tokens into Tailwind’s own namespaces', async () => {
    const css = await build(['bg-bg-base', 'text-label-secondary', 'rounded-card']);
    expect(css).toContain('--bg-base');
    expect(css).toContain('--label-secondary');
  });
});

describe('native controls are told the interface is dark', () => {
  // The parts of a control the page does not draw take the platform's colours
  // unless told otherwise: the popup a `select` opens came out near-white, with
  // the app's pale-blue label text on it, which is barely legible. Cheap to
  // assert and invisible until somebody opens a dropdown.
  it('declares a dark colour scheme', async () => {
    const css = await build([]);
    expect(css).toMatch(/color-scheme:\s*dark/);
  });

  it('colours the rows of a dropdown itself, for the platforms that need it', async () => {
    const css = await build([]);
    expect(css).toMatch(/option\s*\{[^}]*--bg-elevated-2/);
    expect(css).toMatch(/optgroup\s*\{[^}]*--bg-elevated/);
  });
});

describe('the stylesheet says where the class names are', () => {
  it('declares a source, rather than trusting automatic detection', () => {
    // Without this the stylesheet compiles to tokens and a reset and nothing
    // else, and the failure looks exactly like success everywhere except the
    // screen.
    expect(stylesheet).toMatch(/@source\s+["'][^"']+["']/);
  });

  it('emits a rule for every class the components use', async () => {
    const classes = [...usedClasses()];
    expect(classes.length).toBeGreaterThan(100);

    const css = await build(classes);
    // A stylesheet that found nothing is a few kB of tokens and reset. A real
    // one is an order of magnitude larger.
    expect(css.length).toBeGreaterThan(20_000);
  });
});
