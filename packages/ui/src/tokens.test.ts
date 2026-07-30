import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('.', import.meta.url));
const tokensCss = readFileSync(join(srcDir, 'tokens.css'), 'utf8');

/** The colour contract from the Design section of CLAUDE.md, verbatim. */
const requiredColours: Record<string, string> = {
  '--bg-base': '#000000',
  '--bg-elevated': '#1c1c1e',
  '--bg-elevated-2': '#2c2c2e',
  '--bg-elevated-3': '#3a3a3c',
  '--fill-primary': 'rgba(120, 120, 128, 0.36)',
  '--fill-secondary': 'rgba(120, 120, 128, 0.32)',
  '--fill-tertiary': 'rgba(118, 118, 128, 0.24)',
  '--fill-quaternary': 'rgba(116, 116, 128, 0.18)',
  '--label-primary': '#ffffff',
  '--label-secondary': 'rgba(235, 235, 245, 0.6)',
  '--label-tertiary': 'rgba(235, 235, 245, 0.3)',
  '--label-quaternary': 'rgba(235, 235, 245, 0.16)',
  '--separator': 'rgba(84, 84, 88, 0.65)',
  '--separator-opaque': '#38383a',
  '--accent': '#0a84ff',
  '--green': '#30d158',
  '--red': '#ff453a',
  '--orange': '#ff9f0a',
  '--yellow': '#ffd60a',
  '--purple': '#bf5af2',
  '--pink': '#ff375f',
  '--teal': '#40c8e0',
  '--indigo': '#5e5ce6',
};

const declaredValue = (property: string): string | undefined => {
  const match = new RegExp(`^\\s*${property}:\\s*([^;]+);`, 'm').exec(tokensCss);
  return match?.[1]?.trim();
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

describe('design tokens', () => {
  it.each(Object.entries(requiredColours))('defines %s as %s', (property, value) => {
    expect(declaredValue(property)).toBe(value);
  });

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
  // Phase 4 acceptance, enforced from Phase 0: no hardcoded colour anywhere in
  // packages/ui outside tokens.css.
  it('keeps every literal colour inside tokens.css', () => {
    const offenders = walk(srcDir)
      .filter((path) => !path.endsWith('tokens.css') && !path.endsWith('.test.ts'))
      .filter((path) => /\.(css|ts|tsx)$/.test(path))
      .filter((path) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(srcDir.length));

    expect(offenders).toEqual([]);
  });
});
