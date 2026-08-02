/**
 * The line serializer. The inverse of `parseMessage` for any valid input.
 */

import { CRLF_BYTES, MAX_MESSAGE_BYTES, utf8ByteLength } from './limits.js';
import type { IrcMessage } from './message.js';
import { serializeTags } from './tags.js';

/**
 * Whether a parameter must be sent as the trailing parameter.
 *
 * Empty parameters, parameters containing a space, and parameters starting with
 * a colon cannot be expressed any other way. A tab is not a separator and needs
 * no special treatment.
 */
export function needsTrailing(value: string): boolean {
  return value === '' || value.includes(' ') || value.startsWith(':');
}

export type SerializeFailureReason =
  /** A parameter other than the last one cannot be represented on the wire. */
  | 'ambiguous-parameter'
  /** The verb was empty, or contained a space. */
  | 'invalid-command';

export type SerializeResult =
  | { readonly ok: true; readonly line: string }
  | { readonly ok: false; readonly reason: SerializeFailureReason };

/**
 * Serializes a message to a single line, without the trailing CRLF.
 *
 * Returns a failure rather than throwing, and rather than silently emitting a
 * line that would parse back as something different.
 */
export function serializeMessage(msg: IrcMessage): SerializeResult {
  const verb = msg.rawCommand ?? msg.command;
  if (verb === '' || verb.includes(' ')) {
    return { ok: false, reason: 'invalid-command' };
  }

  for (let i = 0; i < msg.params.length - 1; i += 1) {
    const value = msg.params[i] ?? '';
    if (needsTrailing(value)) {
      return { ok: false, reason: 'ambiguous-parameter' };
    }
  }

  let line = '';

  const tags = serializeTags(msg.tags);
  if (tags !== '') {
    line += `${tags} `;
  }
  if (msg.source !== undefined) {
    line += `:${msg.source.raw} `;
  }
  line += verb;

  for (let i = 0; i < msg.params.length; i += 1) {
    const value = msg.params[i] ?? '';
    const last = i === msg.params.length - 1;
    line += last && needsTrailing(value) ? ` :${value}` : ` ${value}`;
  }

  return { ok: true, line };
}

/**
 * Bytes this message will occupy on the wire, CRLF included.
 *
 * The tag section is measured against a separate limit, so it is reported
 * separately rather than folded into one number.
 */
export function measureMessage(msg: IrcMessage): {
  readonly tagBytes: number;
  readonly bodyBytes: number;
  readonly withinBodyLimit: boolean;
} {
  const tags = serializeTags(msg.tags);
  const tagBytes = tags === '' ? 0 : utf8ByteLength(tags) + 1;

  const result = serializeMessage({ ...msg, tags: new Map() });
  const bodyBytes = result.ok ? utf8ByteLength(result.line) + CRLF_BYTES : 0;

  return { tagBytes, bodyBytes, withinBodyLimit: bodyBytes <= MAX_MESSAGE_BYTES };
}
