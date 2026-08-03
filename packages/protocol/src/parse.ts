/**
 * The line parser: RFC 1459 / 2812 message grammar plus IRCv3 message tags.
 *
 * Malformed input never throws. Every failure comes back as a typed result so
 * a bad line from a hostile or broken server degrades to a raw-log entry rather
 * than taking down the connection.
 *
 * Atoms are separated by one *or more* spaces. RFC 2812 says exactly one, but
 * real servers send runs of spaces, and the reference vectors follow RFC 1459
 * here.
 */

import { type IrcMessage, upperAscii } from './message.js';
import { parseSource } from './source.js';
import { parseTags } from './tags.js';

export type ParseFailureReason =
  /** The line was empty, or contained only whitespace. */
  | 'empty'
  /** Tags or a source were present, but no verb followed them. */
  | 'missing-command';

export type ParseResult =
  | { readonly ok: true; readonly message: IrcMessage }
  | { readonly ok: false; readonly reason: ParseFailureReason; readonly input: string };

const SPACE = 0x20;

/**
 * Parses one IRC line.
 *
 * A trailing CRLF is tolerated but not required; transports usually strip it
 * while splitting the stream.
 */
export function parseMessage(line: string): ParseResult {
  const input = line;

  let end = line.length;
  while (end > 0) {
    const code = line.charCodeAt(end - 1);
    if (code !== 0x0d && code !== 0x0a) {
      break;
    }
    end -= 1;
  }

  let i = 0;
  const skipSpaces = (): void => {
    while (i < end && line.charCodeAt(i) === SPACE) {
      i += 1;
    }
  };
  const readAtom = (): string => {
    const start = i;
    while (i < end && line.charCodeAt(i) !== SPACE) {
      i += 1;
    }
    return line.slice(start, i);
  };

  skipSpaces();
  if (i >= end) {
    return { ok: false, reason: 'empty', input };
  }

  let tags = undefined;
  if (line[i] === '@') {
    i += 1;
    tags = parseTags(readAtom());
    skipSpaces();
  }

  let source = undefined;
  if (i < end && line[i] === ':') {
    i += 1;
    source = parseSource(readAtom());
    skipSpaces();
  }

  const rawCommand = readAtom();
  if (rawCommand === '') {
    return { ok: false, reason: 'missing-command', input };
  }

  const params: string[] = [];
  for (;;) {
    skipSpaces();
    if (i >= end) {
      break;
    }
    if (line[i] === ':') {
      // The trailing parameter runs to the end of the line, spaces included,
      // and may be empty.
      params.push(line.slice(i + 1, end));
      break;
    }
    params.push(readAtom());
  }

  const command = upperAscii(rawCommand);

  return {
    ok: true,
    message: {
      tags: tags ?? new Map(),
      source,
      command,
      rawCommand: rawCommand === command ? undefined : rawCommand,
      params,
    },
  };
}
