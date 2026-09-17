import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERFACE_FONT,
  DEFAULT_MESSAGE_FONT,
  INTERFACE_FONTS,
  INTERFACE_FONT_IDS,
  MESSAGE_FONTS,
  MESSAGE_FONT_IDS,
  interfaceFontStack,
  messageFontStack,
  readInterfaceFontId,
  readMessageFontId,
} from './fonts.js';

describe('the faces on offer', () => {
  it('offers seven of each, as the brief asks', () => {
    expect(INTERFACE_FONTS).toHaveLength(7);
    expect(MESSAGE_FONTS).toHaveLength(7);
  });

  it('lists exactly the ids it describes, with no duplicates', () => {
    expect(INTERFACE_FONTS.map((font) => font.id)).toEqual([...INTERFACE_FONT_IDS]);
    expect(MESSAGE_FONTS.map((font) => font.id)).toEqual([...MESSAGE_FONT_IDS]);
    expect(new Set(INTERFACE_FONT_IDS).size).toBe(INTERFACE_FONT_IDS.length);
    expect(new Set(MESSAGE_FONT_IDS).size).toBe(MESSAGE_FONT_IDS.length);
  });

  it('names every face something different', () => {
    const names = [...INTERFACE_FONTS, ...MESSAGE_FONTS].map((font) => font.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // The whole degradation story. Nothing here is downloaded, so a machine
  // without the named face has to land on one it has rather than on nothing.
  it('ends every stack in a generic family', () => {
    for (const font of INTERFACE_FONTS) {
      expect(font.stack.trim(), font.id).toMatch(/(?:sans-serif|serif)$/);
    }
    for (const font of MESSAGE_FONTS) {
      expect(font.stack.trim(), font.id).toMatch(/monospace$/);
    }
  });

  // Not a style rule: the nick column is measured in characters and the raw log
  // is read by lining fields up, both of which a proportional face breaks.
  it('keeps the message list monospaced, whichever face is chosen', () => {
    for (const font of MESSAGE_FONTS) {
      expect(font.stack, font.id).toMatch(/mono|Consolas|Courier/i);
    }
  });

  it('starts from the stacks the design pins', () => {
    expect(interfaceFontStack(DEFAULT_INTERFACE_FONT)).toContain('-apple-system');
    expect(interfaceFontStack(DEFAULT_INTERFACE_FONT)).toContain('system-ui');
    expect(messageFontStack(DEFAULT_MESSAGE_FONT)).toContain('SF Mono');
    expect(messageFontStack(DEFAULT_MESSAGE_FONT)).toContain('ui-monospace');
  });
});

describe('a font id read back from somewhere', () => {
  it('keeps one it recognises', () => {
    expect(readInterfaceFontId('serif')).toBe('serif');
    expect(readMessageFontId('courier')).toBe('courier');
  });

  // A settings document from a newer release can name a face this build has
  // never heard of, and that is a settings screen with a default on it rather
  // than an interface with no font-family resolved at all.
  it.each([undefined, null, '', 'comic-sans', 42, {}, ['inter']])(
    'falls back to the default for %s',
    (value) => {
      expect(readInterfaceFontId(value)).toBe(DEFAULT_INTERFACE_FONT);
      expect(readMessageFontId(value)).toBe(DEFAULT_MESSAGE_FONT);
    },
  );

  // The two lists are separate on purpose: a monospace id in the interface slot
  // is not a face, it is a mistake, and it must not be honoured.
  it('will not take a message face as an interface one, or the reverse', () => {
    expect(readInterfaceFontId('courier')).toBe(DEFAULT_INTERFACE_FONT);
    expect(readMessageFontId('serif')).toBe(DEFAULT_MESSAGE_FONT);
  });
});
