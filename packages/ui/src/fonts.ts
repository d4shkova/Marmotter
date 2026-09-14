/**
 * The typefaces, as the interface offers them.
 *
 * Two roles, because the design asks for two and they are not
 * interchangeable. The interface font sets every label, button and settings
 * row; the message font sets the nick column, the message body and the raw
 * log, and has to be monospaced — the message list lays nicks out in a column
 * measured in characters and the raw log is read by lining up fields, both of
 * which a proportional face quietly breaks. So a person chooses one of each,
 * and the monospace list contains nothing that is not monospaced.
 *
 * Every stack ends in the generic family it belongs to, which is the whole
 * degradation story: nothing here is downloaded. Marmotter ships no webfont and
 * asks no host for one — a font fetched at startup is a request to somebody
 * else's server carrying the user's address, which is the same trade link
 * unfurling makes and the same answer. So each entry names faces the platforms
 * actually install, in the order they are likely to be found, and a machine
 * with none of them lands on its own default rather than on nothing.
 *
 * Like a theme, a font is one custom property on the root element — the two the
 * whole stylesheet resolves its type through. Adding one means adding a row
 * here; it must never mean touching a component.
 */

export const INTERFACE_FONT_IDS = [
  'system',
  'inter',
  'grotesque',
  'segoe',
  'roboto',
  'plex',
  'serif',
] as const;

export const MESSAGE_FONT_IDS = [
  'system-mono',
  'jetbrains',
  'fira',
  'plex-mono',
  'cascadia',
  'menlo',
  'courier',
] as const;

export type InterfaceFontId = (typeof INTERFACE_FONT_IDS)[number];
export type MessageFontId = (typeof MESSAGE_FONT_IDS)[number];

export const DEFAULT_INTERFACE_FONT: InterfaceFontId = 'system';
export const DEFAULT_MESSAGE_FONT: MessageFontId = 'system-mono';

export interface FontInfo<Id extends string> {
  readonly id: Id;
  /** What it is called in the picker. */
  readonly name: string;
  /** A few words on what it is, for the row under the name. */
  readonly description: string;
  /** The `font-family` value, ending in a generic family. */
  readonly stack: string;
}

/**
 * The interface faces.
 *
 * `system` first and default, which is the stack the design pins: whatever the
 * platform's own interface font is. The rest are there because "the system
 * font" is not an answer for somebody who finds it hard to read, and the last
 * is a serif on purpose — some people read one more easily, and a list of seven
 * grotesques would not be seven choices.
 */
export const INTERFACE_FONTS: readonly FontInfo<InterfaceFontId>[] = [
  {
    id: 'system',
    name: 'System',
    description: "Whatever this device's own interface font is.",
    stack: `-apple-system, 'SF Pro Text', 'Inter var', system-ui, sans-serif`,
  },
  {
    id: 'inter',
    name: 'Inter',
    description: 'Open and even. Made for screens.',
    stack: `'Inter var', 'Inter', system-ui, sans-serif`,
  },
  {
    id: 'grotesque',
    name: 'Helvetica',
    description: 'The neutral grotesque, or Arial where it is not installed.',
    stack: `'Helvetica Neue', Helvetica, Arial, sans-serif`,
  },
  {
    id: 'segoe',
    name: 'Segoe UI',
    description: "Windows' own interface font.",
    stack: `'Segoe UI', 'Segoe UI Variable Text', system-ui, sans-serif`,
  },
  {
    id: 'roboto',
    name: 'Roboto',
    description: "Android's own, and on most Linux desktops.",
    stack: `Roboto, 'Noto Sans', 'Droid Sans', sans-serif`,
  },
  {
    id: 'plex',
    name: 'IBM Plex Sans',
    description: 'A little narrower. Fits more in a sidebar.',
    stack: `'IBM Plex Sans', 'Noto Sans', system-ui, sans-serif`,
  },
  {
    id: 'serif',
    name: 'Serif',
    description: 'Lettered, not drawn. Easier for some people to read.',
    stack: `Georgia, 'Iowan Old Style', 'Noto Serif', 'Times New Roman', serif`,
  },
];

/**
 * The message faces, every one of them monospaced.
 *
 * Not a style preference: the nick column is measured in characters and the raw
 * log is read by lining fields up, so a proportional face here is a broken
 * layout rather than a different-looking one. Courier is last and is the one
 * that will be installed everywhere — it is also what IRC looked like for
 * twenty years, which for some people is the reason to pick it.
 */
export const MESSAGE_FONTS: readonly FontInfo<MessageFontId>[] = [
  {
    id: 'system-mono',
    name: 'System Mono',
    description: "Whatever this device's own monospace font is.",
    stack: `'SF Mono', 'JetBrains Mono', ui-monospace, monospace`,
  },
  {
    id: 'jetbrains',
    name: 'JetBrains Mono',
    description: 'Tall letters. Easy on a long scrollback.',
    stack: `'JetBrains Mono', ui-monospace, monospace`,
  },
  {
    id: 'fira',
    name: 'Fira Code',
    description: 'Rounded and wide-set.',
    stack: `'Fira Code', 'Fira Mono', ui-monospace, monospace`,
  },
  {
    id: 'plex-mono',
    name: 'IBM Plex Mono',
    description: 'Narrow. Fits more of a line before it wraps.',
    stack: `'IBM Plex Mono', ui-monospace, monospace`,
  },
  {
    id: 'cascadia',
    name: 'Cascadia Code',
    description: "Windows' terminal font, or Consolas beside it.",
    stack: `'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, monospace`,
  },
  {
    id: 'menlo',
    name: 'Menlo',
    description: 'The older desktop monospace, and DejaVu on Linux.',
    stack: `Menlo, 'DejaVu Sans Mono', 'Liberation Mono', ui-monospace, monospace`,
  },
  {
    id: 'courier',
    name: 'Courier',
    description: 'Typewriter. What IRC looked like for twenty years.',
    stack: `'Courier New', Courier, ui-monospace, monospace`,
  },
];

/**
 * A font id read back from somewhere that could say anything — a settings file
 * on disk, or a settings document from a newer release that has a face this one
 * has never heard of. Either way it is the default rather than an interface
 * with no font named at all.
 *
 * One reader for both roles, because the rule is the same for both and a rule
 * written twice is a rule that gets changed once.
 */
function readFontId<Id extends string>(ids: readonly Id[], fallback: Id, value: unknown): Id {
  return ids.includes(value as Id) ? (value as Id) : fallback;
}

export function readInterfaceFontId(value: unknown): InterfaceFontId {
  return readFontId(INTERFACE_FONT_IDS, DEFAULT_INTERFACE_FONT, value);
}

export function readMessageFontId(value: unknown): MessageFontId {
  return readFontId(MESSAGE_FONT_IDS, DEFAULT_MESSAGE_FONT, value);
}

/**
 * The `font-family` value for a chosen face.
 *
 * The id is validated on the way in by `readFontId`, so the only way to miss
 * here is a table with no row for an id its own type lists — which is the
 * default's row being absent too, and a reason to say so rather than to invent
 * a stack.
 */
function fontStack<Id extends string>(
  fonts: readonly FontInfo<Id>[],
  id: Id,
  fallback: Id,
): string {
  const found = fonts.find((font) => font.id === id) ?? fonts.find((font) => font.id === fallback);
  if (found === undefined) {
    throw new Error(`no font named ${id}`);
  }
  return found.stack;
}

/** The `font-family` value for a chosen interface face. */
export function interfaceFontStack(id: InterfaceFontId): string {
  return fontStack(INTERFACE_FONTS, id, DEFAULT_INTERFACE_FONT);
}

/** The `font-family` value for a chosen message face. */
export function messageFontStack(id: MessageFontId): string {
  return fontStack(MESSAGE_FONTS, id, DEFAULT_MESSAGE_FONT);
}
