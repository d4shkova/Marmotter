// @vitest-environment node
/**
 * The Android resource files are XML, and nothing else here compiles them.
 *
 * Everything in `gen/android` is built by Gradle on a machine with the Android
 * SDK, which this repository's test suite is not. That makes a malformed
 * resource file a mistake that survives review, survives `pnpm test`, and is
 * first reported by a resource merger several minutes into somebody's build.
 *
 * These are the cheap checks that do not need a toolchain. They are not a
 * substitute for building the app; they catch the things that are invisible in
 * a diff and expensive to find any other way.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const project = fileURLToPath(new URL('../src-tauri/gen/android', import.meta.url));

function xmlFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      // Gradle's output, and the native libraries the Rust build drops in.
      return entry === 'build' || entry === '.gradle' ? [] : xmlFiles(path);
    }
    return entry.endsWith('.xml') ? [path] : [];
  });
}

const files = xmlFiles(project);

describe('the Android resource files', () => {
  it('finds some, so a moved directory fails rather than passing vacuously', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  /**
   * XML forbids `--` inside a comment, and Android's resource merger enforces
   * it. The trap is that the tokens these files quote are CSS custom
   * properties, whose names begin with exactly that — so writing down where a
   * value came from is the thing that breaks the build.
   */
  it.each(files)('has no double hyphen inside a comment in %s', (file) => {
    const comments = readFileSync(file, 'utf8').match(/<!--[\s\S]*?-->/g) ?? [];
    const offending = comments.filter((comment) => comment.slice(4, -3).includes('--'));
    expect(offending).toEqual([]);
  });

  it.each(files)('opens and closes every tag in %s', (file) => {
    const text = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const stack: string[] = [];
    for (const [, closing, name, selfClosing] of text.matchAll(
      /<(\/?)([A-Za-z_][\w.:-]*)[^>]*?(\/?)>/g,
    )) {
      if (closing === '/') {
        expect(stack.pop()).toBe(name);
      } else if (selfClosing !== '/') {
        stack.push(name as string);
      }
    }
    expect(stack).toEqual([]);
  });
});

const manifest = join(project, 'app/src/main/AndroidManifest.xml');
const sources = join(project, 'app/src/main/java/uk/co/dashkova/marmotter');

describe('the manifest', () => {
  const text = readFileSync(manifest, 'utf8');

  /**
   * Every `android:name` outside a permission or an intent filter names a class
   * Android instantiates by reflection. Name one that is not there and the
   * failure is at runtime, not at build time — and for the `<application>` tag
   * it is at process start, so the app dies before a line of its own code runs
   * and the only clue is a ClassNotFoundException in logcat.
   *
   * This is the whole check: the classes we claim to own must exist.
   */
  it('names only classes this package actually has', () => {
    const declared = [...text.matchAll(/android:name="(\.[\w.]+)"/g)].map(([, name]) => name);

    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(existsSync(join(sources, `${name.slice(1)}.kt`))).toBe(true);
    }
  });

  /**
   * There is no Tauri Application class to subclass. The lifecycle wiring is in
   * the generated TauriActivity, which registers its observer with
   * ProcessLifecycleOwner — so an `android:name` here is a class nobody wrote,
   * and naming one crashed every launch.
   */
  it('declares no custom application class', () => {
    const application = /<application\b[^>]*>/.exec(text)?.[0] ?? '';
    expect(application).not.toContain('android:name');
  });

  /** The service the foreground connection runs in has to be declared to start. */
  it('declares the connection service with the type Android 14 wants stated', () => {
    expect(text).toContain('android:name=".ConnectionService"');
    expect(text).toContain('android:foregroundServiceType="dataSync"');
  });
});
