/**
 * What the composer offers while you are typing.
 *
 * Two things trigger it: a slash at the start of the line, and a colon
 * shortcode anywhere in it. Nick and channel completion stays on Tab, because
 * a popup that appears on every word in a message would be in the way of
 * writing one.
 *
 * CLAUDE.md asks for a command bar with "autocomplete with inline
 * documentation for each" — so every command row carries its parameters, what
 * it does, and where the same thing lives in the interface. Somebody who
 * already knows `/mode` loses nothing; somebody who does not learns that the
 * channel settings panel exists.
 */

import { type CommandSpec, suggestCommands } from './commands.js';
import { type Emoji, suggestEmoji } from './emoji.js';

export interface SuggestionItem {
  readonly id: string;
  /** The primary text: `/join`, or the emoji character. */
  readonly label: string;
  /** Parameters or shortcode, shown next to the label. */
  readonly hint: string;
  /** One sentence of documentation. Empty for emoji, which explain themselves. */
  readonly detail: string;
  /** Where the same thing lives in the interface, when it does. */
  readonly alsoAt?: string;
  /** What replaces the trigger text when this is accepted. */
  readonly insert: string;
}

export interface Suggestions {
  readonly kind: 'command' | 'emoji';
  readonly items: readonly SuggestionItem[];
  /** Start of the text being replaced. */
  readonly from: number;
  /** End of the text being replaced — the caret. */
  readonly to: number;
}

/** How many rows the popup shows at once while it is narrowing as you type. */
const LIMIT = 8;

export interface SuggestOptions {
  /**
   * Show every command on an empty line, unasked.
   *
   * For somebody who right-clicked an empty composer to find out what there is,
   * rather than somebody typing `/` who is already narrowing. Nothing narrows
   * this list yet, so it is not cut short the way the typed one is.
   */
  readonly offerCommands?: boolean;
}

/**
 * The suggestions for a caret position, or undefined for none.
 *
 * Deliberately a pure function of the text and the caret so it can be reasoned
 * about — and tested — without a DOM.
 */
export function computeSuggestions(
  value: string,
  caret: number,
  options: SuggestOptions = {},
): Suggestions | undefined {
  const before = value.slice(0, caret);

  if (options.offerCommands === true && value === '') {
    const items = suggestCommands('').map(commandItem);
    return items.length === 0 ? undefined : { kind: 'command', items, from: 0, to: caret };
  }

  // A command, only while the caret is still inside the command word at the
  // start of the line. `//` is the escape for a literal slash, not a command.
  const command = /^\/([a-z0-9]*)$/i.exec(before);
  if (command !== null) {
    const prefix = command[1] ?? '';
    const items = suggestCommands(prefix).slice(0, LIMIT).map(commandItem);
    return items.length === 0 ? undefined : { kind: 'command', items, from: 0, to: caret };
  }

  // A shortcode. Two characters minimum, so `:)` and `:D` are left alone —
  // those are text, and turning them into a popup would fight the user.
  const emoji = /(?:^|\s):([a-z0-9_+-]{2,})$/i.exec(before);
  if (emoji !== null) {
    const needle = emoji[1] ?? '';
    const items = suggestEmoji(needle, LIMIT).map(emojiItem);
    return items.length === 0
      ? undefined
      : { kind: 'emoji', items, from: caret - needle.length - 1, to: caret };
  }

  return undefined;
}

/** Applies an item, returning the new text and where the caret should land. */
export function applySuggestion(
  value: string,
  suggestions: Suggestions,
  item: SuggestionItem,
): { readonly text: string; readonly caret: number } {
  const head = value.slice(0, suggestions.from) + item.insert;
  return { text: head + value.slice(suggestions.to), caret: head.length };
}

function commandItem(spec: CommandSpec): SuggestionItem {
  return {
    id: `command:${spec.name}`,
    label: `/${spec.name}`,
    hint: spec.params,
    detail: spec.summary,
    ...(spec.alsoAt === undefined ? {} : { alsoAt: spec.alsoAt }),
    // The trailing space is the point: accepting a command leaves the caret
    // ready for its first argument rather than jammed against the name. Where
    // the argument always starts with a particular character, that goes in too
    // — picking `/join` should leave `/join #` and a caret, not a command the
    // user has to already know how to finish.
    insert: `/${spec.name} ${spec.argPrefix ?? ''}`,
  };
}

function emojiItem(entry: Emoji): SuggestionItem {
  return {
    id: `emoji:${entry.name}`,
    label: entry.char,
    hint: `:${entry.name}:`,
    detail: '',
    insert: entry.char,
  };
}
