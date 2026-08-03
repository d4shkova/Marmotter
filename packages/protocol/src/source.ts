/**
 * Message source parsing: the `nick!user@host` split.
 */

import type { Source } from './message.js';

/**
 * Splits a source prefix into its parts.
 *
 * The leading colon must already be removed. Missing parts come back as empty
 * strings rather than undefined, matching the reference vectors, so callers can
 * compare without narrowing first.
 *
 * The `user` and `host` parts are taken verbatim. Some networks put formatting
 * control codes in hostnames, and the parser's job is to report what arrived,
 * not to sanitise it.
 */
export function parseSource(raw: string): Source {
  const at = raw.indexOf('@');
  const bang = raw.indexOf('!');

  // A `!` only introduces a user part when it precedes the `@`.
  const hasUser = bang !== -1 && (at === -1 || bang < at);

  const nickEnd = hasUser ? bang : at === -1 ? raw.length : at;
  const nick = raw.slice(0, nickEnd);
  const user = hasUser ? raw.slice(bang + 1, at === -1 ? raw.length : at) : '';
  const host = at === -1 ? '' : raw.slice(at + 1);

  return { raw, nick, user, host };
}

/**
 * Builds a source from its parts, deriving the wire form.
 *
 * Use this rather than an object literal so `raw` always agrees with the parts;
 * serialization trusts `raw`.
 */
export function makeSource(nick: string, user = '', host = ''): Source {
  return { raw: serializeSource({ raw: '', nick, user, host }), nick, user, host };
}

/** Rebuilds a source prefix, without the leading colon. */
export function serializeSource(source: Source): string {
  if (source.host !== '') {
    return source.user !== ''
      ? `${source.nick}!${source.user}@${source.host}`
      : `${source.nick}@${source.host}`;
  }
  return source.user !== '' ? `${source.nick}!${source.user}` : source.nick;
}
