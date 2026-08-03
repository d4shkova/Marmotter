/**
 * CTCP encoding and decoding, including both quoting layers.
 *
 * A CTCP message is an ordinary PRIVMSG or NOTICE whose text is wrapped in
 * `\x01` delimiters. `ACTION` — the `/me` command — is the one everybody knows;
 * `VERSION`, `PING`, and `TIME` are the ones Marmotter answers automatically.
 *
 * Two quoting layers exist and they are separate:
 *
 *   - **Low-level quoting** protects bytes that cannot appear in an IRC message
 *     at all (NUL, CR, LF) using `\x10` as the escape.
 *   - **CTCP-level quoting** protects the `\x01` delimiter itself using `\\`.
 *
 * Most clients implement neither, so decoding must tolerate unquoted input, and
 * encoding must not produce anything a naive client would mangle.
 */

const DELIM = '\x01';
const LOW_LEVEL_ESCAPE = '\x10';
const CTCP_ESCAPE = '\\';

export interface CtcpMessage {
  /** Uppercased, e.g. `ACTION`, `VERSION`, `PING`. */
  readonly command: string;
  /** Everything after the command, unquoted. Empty when there was none. */
  readonly params: string;
}

/** Applies low-level quoting, so the text survives the IRC wire format. */
export function lowLevelQuote(text: string): string {
  let out = '';
  for (const char of text) {
    switch (char) {
      case '\0':
        out += `${LOW_LEVEL_ESCAPE}0`;
        break;
      case '\n':
        out += `${LOW_LEVEL_ESCAPE}n`;
        break;
      case '\r':
        out += `${LOW_LEVEL_ESCAPE}r`;
        break;
      case LOW_LEVEL_ESCAPE:
        out += `${LOW_LEVEL_ESCAPE}${LOW_LEVEL_ESCAPE}`;
        break;
      default:
        out += char;
        break;
    }
  }
  return out;
}

/** Reverses low-level quoting. An unknown escape drops to the literal char. */
export function lowLevelDequote(text: string): string {
  if (!text.includes(LOW_LEVEL_ESCAPE)) {
    return text;
  }

  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== LOW_LEVEL_ESCAPE) {
      out += text[i];
      continue;
    }
    i += 1;
    if (i >= text.length) {
      break; // trailing escape: dropped
    }
    switch (text[i]) {
      case '0':
        out += '\0';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case LOW_LEVEL_ESCAPE:
        out += LOW_LEVEL_ESCAPE;
        break;
      default:
        out += text[i];
        break;
    }
  }
  return out;
}

/** Applies CTCP-level quoting, protecting the delimiter. */
export function ctcpQuote(text: string): string {
  let out = '';
  for (const char of text) {
    if (char === DELIM) {
      out += `${CTCP_ESCAPE}a`;
    } else if (char === CTCP_ESCAPE) {
      out += `${CTCP_ESCAPE}${CTCP_ESCAPE}`;
    } else {
      out += char;
    }
  }
  return out;
}

/** Reverses CTCP-level quoting. */
export function ctcpDequote(text: string): string {
  if (!text.includes(CTCP_ESCAPE)) {
    return text;
  }

  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== CTCP_ESCAPE) {
      out += text[i];
      continue;
    }
    i += 1;
    if (i >= text.length) {
      break;
    }
    switch (text[i]) {
      case 'a':
        out += DELIM;
        break;
      case CTCP_ESCAPE:
        out += CTCP_ESCAPE;
        break;
      default:
        out += text[i];
        break;
    }
  }
  return out;
}

/** Whether a message body contains a CTCP request or reply. */
export function isCtcp(text: string): boolean {
  return text.startsWith(DELIM);
}

/**
 * Splits a message body into its CTCP parts and whatever plain text surrounds
 * them.
 *
 * The grammar allows several CTCP blocks in one message with text between them.
 * Almost nothing sends that, but a parser that assumes one block will
 * mis-render the ones that do.
 */
export function extractCtcp(text: string): {
  readonly messages: readonly CtcpMessage[];
  readonly text: string;
} {
  if (!text.includes(DELIM)) {
    return { messages: [], text };
  }

  const dequoted = lowLevelDequote(text);
  const messages: CtcpMessage[] = [];
  let plain = '';
  let i = 0;

  while (i < dequoted.length) {
    const start = dequoted.indexOf(DELIM, i);
    if (start === -1) {
      plain += dequoted.slice(i);
      break;
    }

    plain += dequoted.slice(i, start);

    const end = dequoted.indexOf(DELIM, start + 1);
    // An unterminated block runs to the end of the message.
    const body = end === -1 ? dequoted.slice(start + 1) : dequoted.slice(start + 1, end);

    if (body !== '') {
      const space = body.indexOf(' ');
      const command = space === -1 ? body : body.slice(0, space);
      const params = space === -1 ? '' : body.slice(space + 1);
      messages.push({ command: command.toUpperCase(), params: ctcpDequote(params) });
    }

    if (end === -1) {
      break;
    }
    i = end + 1;
  }

  return { messages, text: plain };
}

/** Decodes a body that is exactly one CTCP message, or undefined if it is not. */
export function decodeCtcp(text: string): CtcpMessage | undefined {
  const { messages, text: plain } = extractCtcp(text);
  return messages.length === 1 && plain.trim() === '' ? messages[0] : undefined;
}

/** Builds a CTCP message body, ready to be the trailing parameter. */
export function encodeCtcp(command: string, params = ''): string {
  const body =
    params === '' ? command.toUpperCase() : `${command.toUpperCase()} ${ctcpQuote(params)}`;
  return lowLevelQuote(`${DELIM}${body}${DELIM}`);
}

/** Builds the body of an `ACTION`, which is what `/me` sends. */
export function encodeAction(text: string): string {
  return encodeCtcp('ACTION', text);
}

/** The action text, when this body is an ACTION. */
export function decodeAction(text: string): string | undefined {
  const ctcp = decodeCtcp(text);
  return ctcp?.command === 'ACTION' ? ctcp.params : undefined;
}

/**
 * CTCP requests Marmotter answers on the user's behalf.
 *
 * Every one leaks something — that a client is online, what it is, what its
 * clock says — so the set is deliberately small and the interface makes it
 * configurable. Anything not listed here is surfaced as a quiet notice and left
 * unanswered.
 */
export const AUTO_ANSWERED: ReadonlySet<string> = new Set([
  'VERSION',
  'PING',
  'TIME',
  'CLIENTINFO',
]);

/** Whether a CTCP request should be answered without asking the user. */
export function isAutoAnswered(command: string): boolean {
  return AUTO_ANSWERED.has(command.toUpperCase());
}
