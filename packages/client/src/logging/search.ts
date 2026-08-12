/**
 * Searching, as pure functions over lines and records.
 *
 * The SQLite store hands this work to SQLite, which is what a database is for.
 * The plaintext store cannot: its files are text, so the platform reads them
 * and these functions decide what matches. Keeping the deciding here means the
 * two stores agree about what a search means, rather than each inventing its
 * own idea of it.
 */

import type { LogQuery, LogRecord } from '@marmotter/shared';
import { stampOf } from './plaintext.js';

/**
 * The words a query is looking for.
 *
 * Split on whitespace, and every word has to appear somewhere in the line —
 * `marmot photo` finds a line containing both, in either order. Quoted phrases
 * stay together, which is the one piece of search syntax people reach for
 * without being taught it.
 */
export function termsOf(text: string): readonly string[] {
  const terms: string[] = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  for (const match of text.matchAll(pattern)) {
    const term = (match[1] ?? match[2] ?? '').trim().toLowerCase();
    if (term !== '') {
      terms.push(term);
    }
  }
  return terms;
}

/** Whether a line satisfies every term. Case-insensitive, as people expect. */
export function matchesTerms(line: string, terms: readonly string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const haystack = line.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** Whether a record falls inside the query's network, target and date range. */
export function withinRange(record: LogRecord, query: LogQuery): boolean {
  if (query.networkId !== undefined && record.networkId !== query.networkId) {
    return false;
  }
  if (query.target !== undefined && record.target !== query.target) {
    return false;
  }
  if (query.from !== undefined && record.at.getTime() < query.from.getTime()) {
    return false;
  }
  if (query.to !== undefined && record.at.getTime() > query.to.getTime()) {
    return false;
  }
  return true;
}

/** Applies a whole query to records already read from disk, newest first. */
export function selectMatching(
  records: readonly LogRecord[],
  query: LogQuery,
): readonly LogRecord[] {
  const terms = termsOf(query.text);
  return records
    .filter((record) => withinRange(record, query) && matchesTerms(record.text, terms))
    .sort((left, right) => right.at.getTime() - left.at.getTime())
    .slice(0, Math.max(0, query.limit));
}

/**
 * A logged line read back into a record.
 *
 * Plaintext logs are for people and their own tools first, so the format is
 * lossy on purpose: it carries no message ID, no network ID, and no year. What
 * comes back is what the line actually says, with the caller supplying the
 * context it already knows — which file this was, and therefore which network
 * and conversation.
 *
 * `year` is needed because the stamp does not carry one. The caller passes the
 * file's own year, and a line stamped later than the reference date is read as
 * the year before, which is what makes a December line in a file read in
 * January come back as December rather than as eleven months in the future.
 */
export function parseLine(
  line: string,
  context: {
    readonly networkId: string;
    readonly networkName: string;
    readonly target: string;
    readonly reference: Date;
  },
): LogRecord | undefined {
  const match = /^([A-Z][a-z]{2}) (\d{2}) (\d{2}):(\d{2}):(\d{2}) (.*)$/.exec(line);
  if (match === null) {
    return undefined;
  }
  const [, month, day, hour, minute, second, body = ''] = match;
  const monthIndex = MONTH_INDEX.get(month ?? '');
  if (monthIndex === undefined) {
    return undefined;
  }

  const at = new Date(
    context.reference.getFullYear(),
    monthIndex,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (at.getTime() > context.reference.getTime()) {
    at.setFullYear(at.getFullYear() - 1);
  }

  const { kind, nick, text } = readBody(body);
  return {
    // Plaintext carries no message ID. The position in time and the text are
    // what identifies a line here, and nothing downstream dedupes search hits.
    id: `${at.toISOString()} ${text}`,
    networkId: context.networkId,
    networkName: context.networkName,
    target: context.target,
    at,
    kind,
    nick,
    text,
  };
}

const MONTH_INDEX: ReadonlyMap<string, number> = new Map(
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(
    (name, index) => [name, index],
  ),
);

/** Reads the part after the timestamp back into a kind, a nick, and text. */
function readBody(body: string): { kind: string; nick: string; text: string } {
  const speech = /^<([^>]*)>\t(.*)$/.exec(body);
  if (speech !== null) {
    return { kind: 'privmsg', nick: speech[1] ?? '', text: speech[2] ?? '' };
  }
  const notice = /^-([^-]*)-\t(.*)$/.exec(body);
  if (notice !== null) {
    return { kind: 'notice', nick: notice[1] ?? '', text: notice[2] ?? '' };
  }
  const event = /^\*\t(.*)$/.exec(body);
  if (event !== null) {
    return { kind: 'server', nick: '', text: event[1] ?? '' };
  }
  return { kind: 'server', nick: '', text: body };
}

/** Round-trips a record through the plaintext format, for tests and export. */
export const stampFor = stampOf;
