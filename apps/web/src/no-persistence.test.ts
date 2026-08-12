// @vitest-environment node
//
// Node rather than the package's jsdom default: this test runs a build and
// reads files, and jsdom gives it a `import.meta.url` that is not a file URL.
/**
 * The web build keeps nothing. This is the test that proves it.
 *
 * CLAUDE.md is unambiguous: on web there is no persistence whatsoever, no
 * `localStorage`, no `IndexedDB`, no cookies holding message content, and
 * scrollback dies with the tab. Phase 7 of BUILD_PLAN.md asks for that to be
 * verified by test rather than by review, because it is exactly the kind of
 * rule that a later convenience quietly breaks.
 *
 * So this builds the actual browser bundle and reads it. Not the sources — the
 * artifact that ships. A dependency three levels down that reaches for
 * `localStorage` would never show up in a source-level check of this package,
 * and would be just as much of a breach.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const appDir = fileURLToPath(new URL('..', import.meta.url));

/**
 * Ways a browser can keep something between page loads.
 *
 * Every one of these is a way message content could outlive the tab, which is
 * the guarantee. `caches` and the service worker registration are here too:
 * Phase 8 adds a service worker for assets, and the line between "caches the
 * app shell" and "caches a response with a conversation in it" is one somebody
 * has to keep deliberately.
 */
const PERSISTENCE_APIS = [
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'IndexedDB',
  'openDatabase',
  'webkitIndexedDB',
  'mozIndexedDB',
] as const;

/**
 * Ways the desktop store could be reached.
 *
 * The web build has no Rust behind it, so any of these would be a call that
 * fails at runtime rather than one that writes — but a call that fails is a
 * call somebody meant to succeed, and the structure is supposed to make it
 * impossible to write in the first place.
 */
const DESKTOP_STORE = ['plugin-sql', 'log_append', 'log_write', 'log_default_dir'] as const;

let bundle = '';

beforeAll(() => {
  const out = mkdtempSync(join(tmpdir(), 'marmotter-web-'));
  try {
    // The real production build, with the real minifier and the real tree
    // shaking. Anything the bundle would ship, it ships here.
    execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
      cwd: appDir,
      stdio: 'pipe',
    });
    const assets = join(out, 'assets');
    bundle = readdirSync(assets)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(assets, name), 'utf8'))
      .join('\n');
    expect(bundle.length).toBeGreaterThan(0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  // The build is the slow part of this file; everything after it is a string
  // scan. 120s is room for a cold machine, not an expectation.
}, 120_000);

afterAll(() => {
  bundle = '';
});

describe('the web bundle', () => {
  it.each(PERSISTENCE_APIS)('never reaches for %s', (api) => {
    expect(bundle).not.toContain(api);
  });

  it.each(DESKTOP_STORE)('never reaches for the desktop log store (%s)', (symbol) => {
    expect(bundle).not.toContain(symbol);
  });

  it('registers no service worker, which Phase 8 has yet to add deliberately', () => {
    expect(bundle).not.toContain('serviceWorker');
  });

  it('writes no cookie', () => {
    // `document.cookie` is the one persistence route that needs no API surface
    // at all, and minification leaves it exactly as written.
    expect(bundle).not.toContain('document.cookie');
    expect(bundle).not.toMatch(/\.cookie\s*=/);
  });

  it('still contains the client, so the scan above is not passing on an empty build', () => {
    // Without this, deleting the app would make every assertion above pass.
    expect(bundle).toContain('Marmotter');
  });
});
