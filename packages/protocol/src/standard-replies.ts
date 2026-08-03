/**
 * IRCv3 standard replies: `FAIL`, `WARN`, and `NOTE`.
 *
 * https://ircv3.net/specs/extensions/standard-replies
 *
 * These exist so a server can say what went wrong in a machine-readable way
 * instead of inventing a numeric or sending prose. Marmotter prefers them over
 * numerics wherever a network sends both, because the code is stable and the
 * description is already a sentence written for a person.
 *
 *   FAIL <command> <code> [context]... :<description>
 */

import type { IrcMessage } from './message.js';

export type ReplySeverity = 'fail' | 'warn' | 'note';

export interface StandardReply {
  readonly severity: ReplySeverity;
  /** The command that prompted it, or `*` when the server did not say. */
  readonly command: string;
  /** A stable machine-readable code, e.g. `ACCOUNT_REQUIRED_TO_CONNECT`. */
  readonly code: string;
  /** Extra context values between the code and the description. */
  readonly context: readonly string[];
  /** Human-readable text, already written for a person to read. */
  readonly description: string;
}

const SEVERITIES: ReadonlyMap<string, ReplySeverity> = new Map([
  ['FAIL', 'fail'],
  ['WARN', 'warn'],
  ['NOTE', 'note'],
]);

/** Whether this message is a standard reply. */
export function isStandardReply(msg: IrcMessage): boolean {
  return SEVERITIES.has(msg.command);
}

/**
 * Parses a standard reply, or returns undefined when the message is not one.
 *
 * A reply missing its description still parses: the code carries the meaning,
 * and dropping the whole reply because the prose is absent would lose the more
 * useful half.
 */
export function parseStandardReply(msg: IrcMessage): StandardReply | undefined {
  const severity = SEVERITIES.get(msg.command);
  if (severity === undefined) {
    return undefined;
  }

  const params = msg.params;
  if (params.length < 2) {
    return undefined;
  }

  // The description is the trailing parameter; everything between the code and
  // it is context. With only two parameters there is no description.
  const hasDescription = params.length >= 3;

  return {
    severity,
    command: params[0] ?? '*',
    code: params[1] ?? '',
    context: hasDescription ? params.slice(2, -1) : [],
    description: hasDescription ? (params[params.length - 1] ?? '') : '',
  };
}

/**
 * Whether a failure means the connection cannot proceed.
 *
 * These are the codes where retrying the same command changes nothing, so the
 * interface should stop and explain rather than spin.
 */
const FATAL_CODES: ReadonlySet<string> = new Set([
  'ACCOUNT_REQUIRED_TO_CONNECT',
  'BANNED',
  'NEED_REGISTRATION',
  'REGISTRATION_INVALID_CRED_TYPE',
  'ACCOUNT_ALREADY_EXISTS',
  'INVALID_UTF8',
]);

export function isFatalReply(reply: StandardReply): boolean {
  return reply.severity === 'fail' && FATAL_CODES.has(reply.code);
}

/**
 * The text to show for a standard reply.
 *
 * The server's own description wins, because it is already prose and it knows
 * details we do not. A reply with no description falls back to the code turned
 * into a readable sentence rather than shown raw — `NEED_REGISTRATION` is not
 * something to put in front of a person.
 */
export function describeStandardReply(reply: StandardReply): string {
  if (reply.description !== '') {
    return reply.description;
  }

  const words = reply.code
    .toLowerCase()
    .split('_')
    .filter((word) => word !== '');

  if (words.length === 0) {
    return 'The network refused that request.';
  }

  const sentence = words.join(' ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
