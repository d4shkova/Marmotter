/**
 * Turning a protocol token into plain English.
 *
 * The single worked example in CLAUDE.md is `+mnt` becoming "Only voiced users
 * can speak. Outside messages are blocked. Only ops can change the topic." —
 * so a mode string is explained letter by letter and the sentences are joined,
 * rather than matched against a table of whole strings that would never cover
 * the combinations people actually set.
 */

import {
  CHANNEL_FLAG_MODES,
  CHANNEL_LIST_MODES,
  CHANNEL_PARAMETER_MODES,
  CTCP_EXPLANATIONS,
  type Explanation,
  NUMERIC_EXPLANATIONS,
  ROLE_MODES,
  SERVICES_EXPLANATIONS,
  USER_MODES,
} from './dictionary.js';

export type TokenKind = 'channel-mode' | 'user-mode' | 'numeric' | 'ctcp' | 'services';

/** One line of an explanation: the token, and what it means. */
export interface ExplainedPart {
  /** As it appeared, e.g. `+m` or `473`. */
  readonly token: string;
  readonly explanation: Explanation;
}

export interface Explained {
  readonly kind: TokenKind;
  /** The whole token, e.g. `+mnt`. */
  readonly token: string;
  readonly parts: readonly ExplainedPart[];
  /** True when nothing in the token could be explained. */
  readonly unknown: boolean;
}

/**
 * How much of a channel mode string this network's own `CHANMODES` and
 * `PREFIX` say about each letter.
 *
 * Optional throughout. Without it the dictionary's own grouping is used, which
 * is right on most networks; with it, a network that moves a letter between
 * groups is explained correctly rather than confidently wrongly.
 */
export interface ModeContext {
  /** Letters that grant a role, from `PREFIX`. */
  readonly roleModes?: string;
  /** Letters holding a list of masks, from the first `CHANMODES` group. */
  readonly listModes?: string;
}

const lookupChannelMode = (
  letter: string,
  context: ModeContext | undefined,
): Explanation | undefined => {
  // The network's own grouping wins, because the same letter means different
  // things on different ircds and only the server knows which it is.
  if (context?.roleModes?.includes(letter) === true) {
    return ROLE_MODES.get(letter);
  }
  if (context?.listModes?.includes(letter) === true) {
    return CHANNEL_LIST_MODES.get(letter);
  }
  return (
    CHANNEL_FLAG_MODES.get(letter) ??
    CHANNEL_PARAMETER_MODES.get(letter) ??
    CHANNEL_LIST_MODES.get(letter) ??
    ROLE_MODES.get(letter)
  );
};

/** Whether a string looks like a mode change, e.g. `+mnt` or `-o`. */
export function isModeString(token: string): boolean {
  return /^[+-][A-Za-z]+([+-][A-Za-z]+)*$/.test(token);
}

/**
 * Explains a channel mode string.
 *
 * Each letter keeps the sign it was given, so `+m-t` reads as one thing being
 * turned on and another off rather than as an undifferentiated list.
 */
export function explainChannelModes(token: string, context?: ModeContext): Explained {
  const parts: ExplainedPart[] = [];
  let sign = '+';

  for (const character of token) {
    if (character === '+' || character === '-') {
      sign = character;
      continue;
    }
    const explanation = lookupChannelMode(character, context);
    if (explanation !== undefined) {
      parts.push({ token: `${sign}${character}`, explanation: negated(explanation, sign) });
    }
  }

  return { kind: 'channel-mode', token, parts, unknown: parts.length === 0 };
}

/** Explains a user mode string. */
export function explainUserModes(token: string): Explained {
  const parts: ExplainedPart[] = [];
  let sign = '+';

  for (const character of token) {
    if (character === '+' || character === '-') {
      sign = character;
      continue;
    }
    const explanation = USER_MODES.get(character);
    if (explanation !== undefined) {
      parts.push({ token: `${sign}${character}`, explanation: negated(explanation, sign) });
    }
  }

  return { kind: 'user-mode', token, parts, unknown: parts.length === 0 };
}

/**
 * Rewrites an explanation for a mode being removed.
 *
 * Prefixing "No longer:" rather than negating each sentence by hand — inverting
 * English reliably is a much bigger problem than this feature needs, and a
 * half-inverted sentence would be worse than an honest prefix.
 */
function negated(explanation: Explanation, sign: string): Explanation {
  if (sign !== '-') {
    return explanation;
  }
  return {
    ...explanation,
    title: `${explanation.title} — removed`,
    detail: `No longer in force: ${lowerFirst(explanation.detail)}`,
  };
}

const lowerFirst = (text: string): string =>
  text.length === 0 ? text : `${text[0]?.toLowerCase() ?? ''}${text.slice(1)}`;

export function explainNumeric(numeric: string): Explained {
  const explanation = NUMERIC_EXPLANATIONS.get(numeric);
  return {
    kind: 'numeric',
    token: numeric,
    parts: explanation === undefined ? [] : [{ token: numeric, explanation }],
    unknown: explanation === undefined,
  };
}

export function explainCtcp(command: string): Explained {
  const explanation = CTCP_EXPLANATIONS.get(command.toUpperCase());
  return {
    kind: 'ctcp',
    token: command,
    parts: explanation === undefined ? [] : [{ token: command, explanation }],
    unknown: explanation === undefined,
  };
}

export function explainServices(term: string): Explained {
  const explanation = SERVICES_EXPLANATIONS.get(term.toLowerCase());
  return {
    kind: 'services',
    token: term,
    parts: explanation === undefined ? [] : [{ token: term, explanation }],
    unknown: explanation === undefined,
  };
}

/**
 * Explains whatever it is handed.
 *
 * Used where the caller has a token out of a raw log or an error and does not
 * know which kind it is. A caller that does know should say so: `+i` is a
 * different thing on a channel than on a person, and this cannot tell.
 */
export function explain(token: string, context?: ModeContext): Explained {
  if (/^\d{3}$/.test(token)) {
    return explainNumeric(token);
  }
  if (isModeString(token)) {
    const channel = explainChannelModes(token, context);
    return channel.unknown ? explainUserModes(token) : channel;
  }
  if (CTCP_EXPLANATIONS.has(token.toUpperCase())) {
    return explainCtcp(token);
  }
  return explainServices(token);
}

/**
 * The one-line form, for a tooltip or a screen reader.
 *
 * This is the string CLAUDE.md's worked example describes: several mode letters
 * become several sentences, run together.
 */
export function explainToText(explained: Explained): string {
  return explained.parts.map((part) => part.explanation.detail).join(' ');
}
