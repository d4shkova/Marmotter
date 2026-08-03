/**
 * IRCv3 message-tags escaping, parsing, and serialization.
 *
 * https://ircv3.net/specs/extensions/message-tags
 */

import type { Tags } from './message.js';

/**
 * Decodes a tag value.
 *
 * Per the specification: an escape sequence with no defined meaning drops the
 * backslash and keeps the character, and a lone trailing backslash is dropped
 * entirely. Neither is an error.
 */
export function unescapeTagValue(value: string): string {
  if (!value.includes('\\')) {
    return value;
  }

  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== '\\') {
      out += value[i];
      continue;
    }

    i += 1;
    if (i >= value.length) {
      break; // Lone trailing backslash: dropped.
    }

    switch (value[i]) {
      case ':':
        out += ';';
        break;
      case 's':
        out += ' ';
        break;
      case '\\':
        out += '\\';
        break;
      case 'r':
        out += '\r';
        break;
      case 'n':
        out += '\n';
        break;
      default:
        out += value[i];
        break;
    }
  }
  return out;
}

/** Encodes a tag value for the wire. */
export function escapeTagValue(value: string): string {
  let out = '';
  for (const char of value) {
    switch (char) {
      case ';':
        out += '\\:';
        break;
      case ' ':
        out += '\\s';
        break;
      case '\\':
        out += '\\\\';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\n':
        out += '\\n';
        break;
      default:
        out += char;
        break;
    }
  }
  return out;
}

/**
 * Parses the tag section of a message, without its leading `@`.
 *
 * Duplicate tag names resolve to the last occurrence, matching the reference
 * vectors. Empty segments are skipped rather than producing a nameless tag.
 */
export function parseTags(section: string): Tags {
  const tags = new Map<string, string>();
  if (section === '') {
    return tags;
  }

  for (const entry of section.split(';')) {
    if (entry === '') {
      continue;
    }
    const equals = entry.indexOf('=');
    if (equals === -1) {
      tags.set(entry, '');
    } else {
      tags.set(entry.slice(0, equals), unescapeTagValue(entry.slice(equals + 1)));
    }
  }
  return tags;
}

/**
 * Serializes tags, including the leading `@`. Returns the empty string when
 * there are no tags, so callers can concatenate unconditionally.
 */
export function serializeTags(tags: Tags): string {
  if (tags.size === 0) {
    return '';
  }

  const parts: string[] = [];
  for (const [name, value] of tags) {
    parts.push(value === '' ? name : `${name}=${escapeTagValue(value)}`);
  }
  return `@${parts.join(';')}`;
}

/**
 * Whether a tag is a client-only tag, which the specification marks with a
 * leading `+` and servers relay without interpreting.
 */
export function isClientTag(name: string): boolean {
  return name.startsWith('+');
}
