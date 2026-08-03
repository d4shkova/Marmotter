// @vitest-environment node
// Reads tokens.css off disk, so it needs Node rather than the jsdom default.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('.', import.meta.url));
const tokensCss = readFileSync(join(srcDir, 'tokens.css'), 'utf8');

const declaredValue = (property: string): string | undefined => {
  const match = new RegExp(`^\\s*${property}:\\s*([^;]+);`, 'm').exec(tokensCss);
  return match?.[1]?.trim();
};

/** Follows `var(--x)` indirection down to the literal a token resolves to. */
const resolve = (property: string, depth = 0): string | undefined => {
  const value = declaredValue(property);
  if (value === undefined || depth > 8) {
    return value;
  }
  const indirect = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  return indirect?.[1] === undefined ? value : resolve(indirect[1], depth + 1);
};

const rgb = (hex: string): [number, number, number] => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) {
    throw new Error(`not a six-digit hex colour: ${hex}`);
  }
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
};

/** WCAG relative luminance. */
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

/**
 * Perceptual distance, using the "redmean" approximation. Good enough to catch
 * two nick colours that would read as the same colour in a message list.
 */
const perceptualDistance = (a: string, b: string): number => {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rMean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const BLUE_RAMP = ['050', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const NICK_TOKENS = Array.from({ length: 8 }, (_, i) => `--nick-${i + 1}`);

describe('primitives', () => {
  it.each(BLUE_RAMP)('defines --blue-%s as a hex value', (step) => {
    const value = declaredValue(`--blue-${step}`);
    expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps systemBlue as the middle of the ramp', () => {
    expect(declaredValue('--blue-500')).toBe('#0a84ff');
  });

  it('orders the ramp from light to dark', () => {
    const luminances = BLUE_RAMP.map((step) => luminance(declaredValue(`--blue-${step}`) ?? ''));
    const sorted = [...luminances].sort((a, b) => b - a);
    expect(luminances).toEqual(sorted);
  });

  it('defines the neutral and alarm primitives', () => {
    for (const token of ['--ink-000', '--ink-900', '--ink-800', '--ink-700', '--red-500']) {
      expect(declaredValue(token), token).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('semantic aliases', () => {
  const aliases = [
    '--bg-base',
    '--bg-elevated',
    '--bg-elevated-2',
    '--bg-elevated-3',
    '--accent',
    '--accent-hover',
    '--accent-pressed',
    '--danger',
    '--status-connected',
    '--status-connecting',
    '--status-failed',
    ...NICK_TOKENS,
  ];

  it.each(aliases)('%s points at a primitive rather than a literal', (token) => {
    expect(declaredValue(token), token).toMatch(/^var\(--[\w-]+\)$/);
  });

  it('resolves the accent to systemBlue', () => {
    expect(resolve('--accent')).toBe('#0a84ff');
  });

  it('keeps the base surface black', () => {
    expect(resolve('--bg-base')).toBe('#000000');
  });
});

describe('red is reserved for alarm', () => {
  const reds = new Set(
    ['--red-400', '--red-500', '--red-900'].map((token) => declaredValue(token) ?? ''),
  );

  const alarmAliases = ['--danger', '--danger-hover', '--danger-muted', '--status-failed'];

  it('uses red for the alarm aliases', () => {
    expect(reds.has(resolve('--danger') ?? '')).toBe(true);
    expect(reds.has(resolve('--status-failed') ?? '')).toBe(true);
  });

  it('uses red nowhere else', () => {
    // Every alias in the file, minus the ones that are supposed to be red.
    const aliasNames = [...tokensCss.matchAll(/^\s*(--[\w-]+):\s*var\(--[\w-]+\);/gm)]
      .map((match) => match[1] ?? '')
      .filter((name) => !alarmAliases.includes(name));

    for (const name of aliasNames) {
      expect(reds.has(resolve(name) ?? ''), `${name} resolves to red`).toBe(false);
    }
  });

  it('does not offer a green or an amber primitive to reach for', () => {
    // The palette is one blue family plus red. Anything else has to be added
    // deliberately, as a semantic alias, not picked out of a grab bag of hues.
    for (const token of ['--green', '--orange', '--yellow', '--purple', '--pink']) {
      expect(declaredValue(token), `${token} should not exist`).toBeUndefined();
    }
  });

  it('shows connection health in blue, so red only ever means trouble', () => {
    expect(reds.has(resolve('--status-connected') ?? '')).toBe(false);
    expect(reds.has(resolve('--status-connecting') ?? '')).toBe(false);
  });
});

describe('nick colours', () => {
  const resolved = NICK_TOKENS.map((token) => ({ token, value: resolve(token) ?? '' }));
  const base = resolve('--bg-base') ?? '#000000';

  it('defines eight of them', () => {
    expect(resolved).toHaveLength(8);
    for (const { token, value } of resolved) {
      expect(value, token).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  // The accessibility floor in CLAUDE.md, checked rather than asserted.
  it.each(resolved)('$token clears 4.5:1 against the message background', ({ value }) => {
    expect(contrast(value, base)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every pair far enough apart to tell two people apart', () => {
    // The real risk of a single-hue palette: two nicks that read as one colour.
    const tooClose: string[] = [];
    for (let i = 0; i < resolved.length; i += 1) {
      for (let k = i + 1; k < resolved.length; k += 1) {
        const a = resolved[i];
        const b = resolved[k];
        if (a === undefined || b === undefined) {
          continue;
        }
        const distance = perceptualDistance(a.value, b.value);
        if (distance < 40) {
          tooClose.push(`${a.token} and ${b.token} (${distance.toFixed(1)})`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it('uses distinct values', () => {
    expect(new Set(resolved.map((entry) => entry.value)).size).toBe(resolved.length);
  });
});

describe('sidebar row colours', () => {
  const sidebar = resolve('--bg-elevated') ?? '#101720';
  const rows = [
    { token: '--label-channel', value: resolve('--label-channel') ?? '' },
    { token: '--label-person', value: resolve('--label-person') ?? '' },
  ];

  it.each(rows)('$token clears 4.5:1 against the sidebar', ({ value }) => {
    expect(contrast(value, sidebar)).toBeGreaterThanOrEqual(4.5);
  });

  // They exist to be told apart at a glance. Two near-identical blues would be
  // decoration rather than a distinction.
  it('keeps a channel and a person far enough apart to read as different', () => {
    const [channel, person] = rows;
    expect(channel).toBeDefined();
    expect(person).toBeDefined();
    expect(perceptualDistance(channel?.value ?? '', person?.value ?? '')).toBeGreaterThan(40);
  });
});

describe('typography, geometry, and motion', () => {
  it('defines the iOS text styles', () => {
    for (const style of [
      'large-title',
      'title-1',
      'title-2',
      'title-3',
      'headline',
      'body',
      'callout',
      'subhead',
      'footnote',
      'caption-1',
      'caption-2',
    ]) {
      expect(declaredValue(`--text-${style}-size`), `${style} size`).toBeDefined();
      expect(declaredValue(`--text-${style}-line`), `${style} line height`).toBeDefined();
      expect(declaredValue(`--text-${style}-weight`), `${style} weight`).toBeDefined();
    }
  });

  it('defines the geometry and motion values', () => {
    expect(declaredValue('--space-unit')).toBe('4px');
    expect(declaredValue('--screen-margin')).toBe('16px');
    expect(declaredValue('--corner-control')).toBe('10px');
    expect(declaredValue('--corner-card')).toBe('14px');
    expect(declaredValue('--corner-sheet')).toBe('20px');
    expect(declaredValue('--blur-vibrancy')).toBe('blur(20px) saturate(180%)');
    expect(declaredValue('--duration-sheet')).toBe('200ms');
    expect(declaredValue('--easing-sheet')).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
    expect(declaredValue('--duration-press')).toBe('120ms');
  });
});

describe('token discipline', () => {
  it('keeps every literal colour inside tokens.css', () => {
    const offenders = walk(srcDir)
      .filter((path) => !path.endsWith('tokens.css') && !path.endsWith('.test.ts'))
      .filter((path) => /\.(css|ts|tsx)$/.test(path))
      .filter((path) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(srcDir.length));

    expect(offenders).toEqual([]);
  });

  it('keeps every literal colour in tokens.css inside the primitive layer', () => {
    // Semantic aliases must go through var(); a literal below the primitives
    // would break theming, since a theme only redefines primitives.
    const semanticSection = tokensCss.slice(tokensCss.indexOf('2. semantic aliases'));
    const literals = [...semanticSection.matchAll(/^\s*--[\w-]+:\s*(#[0-9a-f]{3,8})\b/gim)].map(
      (match) => match[0].trim(),
    );

    // --label-primary and --on-accent are pure white in every theme.
    expect(literals.every((line) => line.includes('#ffffff'))).toBe(true);
  });
});
