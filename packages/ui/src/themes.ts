/**
 * The themes, as the interface offers them.
 *
 * Names and order only. Every colour lives in `tokens.css`, and a swatch is
 * drawn by putting `data-theme` on an element and reading the same aliases the
 * rest of the interface reads — which is why there is not a hex value in this
 * file and must not be: a swatch that named its own colours would be a second
 * copy of the palette, free to disagree with the one on screen.
 */

export const THEME_IDS = ['midnight', 'monochrome', 'ember', 'blossom', 'paper', 'nebula'] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = 'midnight';

export interface ThemeInfo {
  readonly id: ThemeId;
  /** What it is called in the picker. */
  readonly name: string;
  /** A few words on what it looks like, for the row under the name. */
  readonly description: string;
}

export const THEMES: readonly ThemeInfo[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Blue on black. The original.',
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    description: 'Black, white and grey. Red still means trouble.',
  },
  {
    id: 'ember',
    name: 'Ember',
    description: 'Black and red, on warm grey.',
  },
  {
    id: 'blossom',
    name: 'Blossom',
    description: 'Light, in shades of pink.',
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'A white page with a red accent.',
  },
  {
    id: 'nebula',
    name: 'Nebula',
    description: 'Purple and blue.',
  },
];

/**
 * A theme id read back from somewhere that could say anything — a settings file
 * on disk, in practice. Anything unrecognised is the default rather than a
 * window with no colours in it.
 */
export function readThemeId(value: unknown): ThemeId {
  return THEME_IDS.includes(value as ThemeId) ? (value as ThemeId) : DEFAULT_THEME;
}
