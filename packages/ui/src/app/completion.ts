/**
 * Tab completion for the composer.
 *
 * Nicks and channel names, chosen by what is in front of the cursor. The rules
 * are small but every one of them is something a person notices when it is
 * wrong: completing at the start of a line appends `: `, completing anywhere
 * else appends a space, and pressing Tab again cycles rather than starting
 * over.
 */

export interface CompletionState {
  /** The word being completed, as originally typed. */
  readonly prefix: string;
  readonly start: number;
  readonly end: number;
  readonly candidates: readonly string[];
  readonly index: number;
}

export interface CompletionResult {
  readonly text: string;
  readonly caret: number;
  readonly state: CompletionState;
}

/** Characters IRC allows in a nick, plus the channel prefixes. */
const WORD = /[\w[\]\\`^{|}#&-]/;

/** The word the caret sits in or just after. */
export function wordAt(text: string, caret: number): { word: string; start: number } {
  let start = caret;
  while (start > 0) {
    const character = text[start - 1];
    if (character === undefined || !WORD.test(character)) {
      break;
    }
    start -= 1;
  }
  return { word: text.slice(start, caret), start };
}

/**
 * Completes the word before the caret.
 *
 * Pass the previous result back in to cycle through the candidates rather than
 * re-matching, which is what makes pressing Tab repeatedly work.
 */
export function complete(
  text: string,
  caret: number,
  options: {
    readonly nicks: readonly string[];
    readonly channels: readonly string[];
    /** Casemapped fold, so completion follows the network's rules. */
    readonly fold: (value: string) => string;
    readonly previous?: CompletionState | undefined;
    readonly backwards?: boolean;
  },
): CompletionResult | undefined {
  const step = options.backwards === true ? -1 : 1;

  // Cycling: the previous completion is still under the caret.
  if (
    options.previous !== undefined &&
    text.slice(options.previous.start, caret) === currentInsert(options.previous)
  ) {
    const next =
      (options.previous.index + step + options.previous.candidates.length) %
      options.previous.candidates.length;
    const state = { ...options.previous, index: next, end: caret };
    return apply(text, state, options.previous.start, caret);
  }

  const { word, start } = wordAt(text, caret);
  if (word === '') {
    return undefined;
  }

  const folded = options.fold(word);
  const pool = word.startsWith('#') || word.startsWith('&') ? options.channels : options.nicks;
  const candidates = pool.filter((candidate) => options.fold(candidate).startsWith(folded));
  if (candidates.length === 0) {
    return undefined;
  }

  const state: CompletionState = { prefix: word, start, end: caret, candidates, index: 0 };
  return apply(text, state, start, caret);
}

const currentInsert = (state: CompletionState): string => {
  const candidate = state.candidates[state.index] ?? state.prefix;
  return state.start === 0 ? `${candidate}: ` : `${candidate} `;
};

function apply(text: string, state: CompletionState, start: number, end: number): CompletionResult {
  // A nick at the start of a line is being addressed, and the convention
  // everywhere on IRC is `nick: message`. Anywhere else it is just a mention.
  const insert = currentInsert(state);
  const next = text.slice(0, start) + insert + text.slice(end);
  return { text: next, caret: start + insert.length, state: { ...state, end } };
}
