import { describe, expect, it } from 'vitest';
import { NICK_COLOR_COUNT, hashNick, nickColorIndex, nickColorVar } from './nick-color.js';

describe('nick colouring', () => {
  it('gives the same nick the same colour every time', () => {
    // Stability is the whole feature: the colour is identity, and identity that
    // changes between sessions is worse than no colour at all.
    expect(nickColorIndex('tamsin')).toBe(nickColorIndex('tamsin'));
    expect(hashNick('tamsin')).toBe(hashNick('tamsin'));
  });

  it('gives one person one colour however their nick is capitalised', () => {
    expect(nickColorIndex('Tamsin')).toBe(nickColorIndex('tamsin'));
    expect(nickColorIndex('TAMSIN')).toBe(nickColorIndex('tamsin'));
  });

  it('honours a casemapping the caller folded for it', () => {
    // On rfc1459 `tamsin[m]` and `tamsin{m}` are the same person, which this
    // package cannot know — so the caller folds and passes the result.
    expect(nickColorIndex('tamsin[m]', 'tamsin{m}')).toBe(nickColorIndex('Tamsin{m}', 'tamsin{m}'));
  });

  it('stays inside the palette', () => {
    for (let index = 0; index < 500; index += 1) {
      const value = nickColorIndex(`nick-${index}`);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(NICK_COLOR_COUNT);
    }
  });

  it('names a token that exists', () => {
    expect(nickColorVar('tamsin')).toMatch(/^--nick-[1-8]$/);
  });

  it('spreads a realistic channel across the whole palette', () => {
    const nicks = Array.from({ length: 200 }, (_, index) => `person${index}`);
    const used = new Set(nicks.map((nick) => nickColorIndex(nick)));
    expect(used.size).toBe(NICK_COLOR_COUNT);
  });

  it('does not pile a channel onto one or two colours', () => {
    const nicks = Array.from({ length: 800 }, (_, index) => `u${index}`);
    const counts = new Map<number, number>();
    for (const nick of nicks) {
      const index = nickColorIndex(nick);
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }
    // An even split is 100 each. Anything past double that would be visible as
    // a channel where half the names look alike.
    for (const count of counts.values()) {
      expect(count).toBeLessThan(200);
    }
  });

  it('copes with a nick made entirely of punctuation', () => {
    expect(() => nickColorIndex('[]\\`_^{|}')).not.toThrow();
    expect(nickColorIndex('')).toBeGreaterThanOrEqual(1);
  });
});
