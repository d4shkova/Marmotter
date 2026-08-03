import { describe, expect, it } from 'vitest';
import { COMMANDS } from './commands.js';
import { emojiFor, replaceShortcodes, suggestEmoji } from './emoji.js';
import { applySuggestion, computeSuggestions } from './suggest.js';

/** The item the popup would have highlighted first. */
const firstFor = (value: string, caret = value.length) => {
  const suggestions = computeSuggestions(value, caret);
  return suggestions === undefined ? undefined : suggestions.items[0];
};

describe('what the composer offers', () => {
  it('offers commands for a slash at the start of the line', () => {
    expect(firstFor('/jo')?.label).toBe('/join');
    expect(firstFor('/jo')?.hint).toBe('<channel> [password]');
    expect(firstFor('/jo')?.detail).toBe('Joins a channel, creating it if nobody is there.');
  });

  it('offers every command for a bare slash', () => {
    expect(computeSuggestions('/', 1)?.items.length).toBeGreaterThan(3);
  });

  // `//text` is the escape for saying something that starts with a slash. A
  // popup there would be offering to turn it back into a command.
  it('leaves the literal-slash escape alone', () => {
    expect(computeSuggestions('//not a command', 15)).toBeUndefined();
  });

  it('stops offering commands once the command word is finished', () => {
    expect(computeSuggestions('/join #marmotter', 16)).toBeUndefined();
  });

  it('offers emoji for a shortcode, matching keywords as well as names', () => {
    expect(firstFor(':smi')?.label).toBe('😄');
    expect(firstFor('thanks :appl')?.label).toBe('👏');
  });

  // `:)` and `:D` are text somebody meant to type, and a popup over them would
  // be fighting the user rather than helping.
  it('ignores the short smileys', () => {
    expect(computeSuggestions(':)', 2)).toBeUndefined();
    expect(computeSuggestions(':D', 2)).toBeUndefined();
  });

  it('does not treat a colon inside a word as a shortcode', () => {
    expect(computeSuggestions('https://example.com', 19)).toBeUndefined();
  });

  // Right-clicking an empty composer asks for the whole list, for somebody who
  // does not already know that `/` produces one.
  it('offers every command on an empty line when asked outright', () => {
    const suggestions = computeSuggestions('', 0, { offerCommands: true });
    const everyday = COMMANDS.filter((command) => command.operator !== true);
    expect(suggestions?.kind).toBe('command');
    expect(suggestions?.items.length).toBe(everyday.length);
    expect(suggestions?.items.map((item) => item.label)).toContain('/join');
  });

  // Discovery, not permission: `/oper` typed in full still parses and runs on
  // any network. It simply is not proposed to somebody it means nothing to.
  it('keeps the operator commands out of the list until the network says otherwise', () => {
    const ordinary = computeSuggestions('/op', 3);
    expect(ordinary).toBeUndefined();

    const operator = computeSuggestions('/op', 3, { operator: true });
    expect(operator?.items.map((item) => item.label)).toEqual(['/oper']);
  });

  it('offers the operator commands in the browsed list too, once enabled', () => {
    const browsed = computeSuggestions('', 0, { offerCommands: true, operator: true });
    expect(browsed?.items.map((item) => item.label)).toContain('/wallops');
    expect(browsed?.items.length).toBe(COMMANDS.length);
  });

  it('cuts the typed list short but not the browsed one', () => {
    const typed = computeSuggestions('/', 1);
    const browsed = computeSuggestions('', 0, { offerCommands: true });
    expect(typed?.items.length).toBeLessThan(browsed?.items.length ?? 0);
  });

  it('leaves a line with something on it to the usual rules', () => {
    expect(computeSuggestions('hello', 5, { offerCommands: true })).toBeUndefined();
  });

  it('splices a browsed command into the empty line', () => {
    const suggestions = computeSuggestions('', 0, { offerCommands: true });
    const item = suggestions?.items.find((entry) => entry.label === '/join');
    expect(suggestions).toBeDefined();
    expect(item).toBeDefined();
    if (suggestions === undefined || item === undefined) {
      return;
    }
    expect(applySuggestion('', suggestions, item)).toEqual({ text: '/join #', caret: 7 });
  });

  // `/join` carries the `#` its argument always starts with, so picking it out
  // of the list leaves something that can be finished by typing a name rather
  // than by knowing what a channel name looks like.
  it('splices a command in with the caret ready for its first argument', () => {
    const suggestions = computeSuggestions('/jo', 3);
    const item = suggestions?.items[0];
    expect(suggestions).toBeDefined();
    expect(item).toBeDefined();
    if (suggestions === undefined || item === undefined) {
      return;
    }
    expect(applySuggestion('/jo', suggestions, item)).toEqual({ text: '/join #', caret: 7 });
  });

  it('leaves a command whose argument has no fixed shape at a bare space', () => {
    const suggestions = computeSuggestions('/whoi', 5);
    const item = suggestions?.items[0];
    expect(suggestions).toBeDefined();
    expect(item).toBeDefined();
    if (suggestions === undefined || item === undefined) {
      return;
    }
    expect(applySuggestion('/whoi', suggestions, item)).toEqual({ text: '/whois ', caret: 7 });
  });

  it('replaces the whole shortcode, colon included, and keeps what follows', () => {
    const value = 'nice :tad work';
    const suggestions = computeSuggestions(value, 9);
    const item = suggestions?.items[0];
    expect(suggestions).toBeDefined();
    expect(item).toBeDefined();
    if (suggestions === undefined || item === undefined) {
      return;
    }
    expect(applySuggestion(value, suggestions, item)).toEqual({ text: 'nice 🎉 work', caret: 7 });
  });
});

describe('emoji shortcodes', () => {
  it('resolves a complete shortcode on send', () => {
    expect(replaceShortcodes('shipping it :rocket: :tada:')).toBe('shipping it 🚀 🎉');
  });

  // A shortcode Marmotter does not know is somebody's code, a ratio, or a
  // timestamp. Mangling it would be worse than not helping.
  it('leaves an unrecognised shortcode exactly as typed', () => {
    expect(replaceShortcodes('printf :%s: then :12:')).toBe('printf :%s: then :12:');
  });

  it('ranks a name that starts with the search above one that merely contains it', () => {
    const names = suggestEmoji('smile').map((entry) => entry.name);
    expect(names[0]).toBe('smile');
  });

  it('resolves a shortcode with or without its colons', () => {
    expect(emojiFor('fire')).toBe('🔥');
    expect(emojiFor(':fire:')).toBe('🔥');
    expect(emojiFor('nothing_like_this')).toBeUndefined();
  });
});
