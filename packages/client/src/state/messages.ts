/**
 * The message buffer: stable IDs, deduplication, and ordering.
 *
 * Three things make this harder than appending to an array.
 *
 * `echo-message` returns our own messages, so an optimistically rendered line
 * has to be recognised and reconciled rather than shown twice.
 *
 * `draft/chathistory` backfills messages that overlap what is already in the
 * buffer, so the same message arrives twice by two routes.
 *
 * `server-time` means messages can arrive out of order relative to their
 * timestamps, and history arrives newest-batch-first while being oldest-first
 * within a batch.
 */

import type { Tags } from '@marmotter/protocol';
import { MESSAGE_LIMIT, type Message } from './types.js';

/**
 * A stable ID for a message that has no `msgid`.
 *
 * Derived from the content rather than random, so the same message arriving
 * twice — once live and once through history — collapses to one entry on a
 * network without `msgid`. Two genuinely identical messages a second apart do
 * merge, which is the lesser of the two errors: a duplicate is more confusing
 * than a lost repeat, and repeats are rare.
 */
export function derivedId(message: {
  readonly at: Date;
  readonly target: string;
  readonly text: string;
  readonly source: { readonly nick: string } | undefined;
}): string {
  const nick = message.source?.nick ?? '';
  const second = Math.floor(message.at.getTime() / 1000);
  return `d:${second}:${nick}:${message.target}:${message.text}`;
}

/** Reads `server-time`, falling back to the local clock. */
export function timestampOf(
  tags: Tags,
  now: () => Date = () => new Date(),
): { at: Date; fromServerTime: boolean } {
  const raw = tags.get('time');
  if (raw !== undefined && raw !== '') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return { at: parsed, fromServerTime: true };
    }
  }
  return { at: now(), fromServerTime: false };
}

/**
 * The fields of a message that carry a value.
 *
 * A message built from a line without an `account` tag or a `+draft/reply` has
 * those keys present and undefined, and spreading it over an existing entry
 * therefore erases what the other copy knew. A history copy of a line has no
 * reason to carry every tag the live one did, so merging the two must not be
 * able to lose detail — only add it.
 */
function definedOnly(message: Message): Partial<Message> {
  const kept: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(message)) {
    if (value !== undefined) {
      kept[field] = value;
    }
  }
  return kept as Partial<Message>;
}

/**
 * Inserts a message, keeping the buffer ordered by time.
 *
 * A message already in the buffer is merged in place rather than appended, so
 * the same line arriving twice — live and again through history — stays one
 * entry, keeping its position and gaining whatever the second copy knew.
 */
export function insertMessage(
  messages: readonly Message[],
  message: Message,
  limit = MESSAGE_LIMIT,
): readonly Message[] {
  const existingIndex = messages.findIndex((candidate) => candidate.id === message.id);

  if (existingIndex !== -1) {
    const existing = messages[existingIndex];
    if (existing === undefined) {
      return messages;
    }
    // A pending message confirmed by echo-message, or a history copy carrying
    // detail the live one lacked. Keep the position, take the better data.
    if (!existing.pending && message.pending) {
      return messages;
    }
    const merged: Message = { ...existing, ...definedOnly(message), pending: false };
    const next = [...messages];
    next[existingIndex] = merged;
    return next;
  }

  // The common case by far: the newest message belongs at the end.
  const last = messages[messages.length - 1];
  if (last === undefined || last.at.getTime() <= message.at.getTime()) {
    const appended = [...messages, message];
    return appended.length > limit ? appended.slice(appended.length - limit) : appended;
  }

  // Out of order, which history backfill makes routine. Binary search rather
  // than re-sorting: the buffer reaches tens of thousands of lines.
  let low = 0;
  let high = messages.length;
  const target = message.at.getTime();
  while (low < high) {
    const middle = (low + high) >>> 1;
    const candidate = messages[middle];
    if (candidate !== undefined && candidate.at.getTime() <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const next = [...messages.slice(0, low), message, ...messages.slice(low)];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Reconciles our own echoed message with the optimistic one already shown.
 *
 * Without `echo-message` the pending message simply stays pending, and the
 * interface shows the un-acknowledged indicator rather than lying about
 * delivery.
 */
export function reconcileEcho(messages: readonly Message[], echoed: Message): readonly Message[] {
  // Match on msgid first — the reliable route.
  const byId = messages.findIndex((candidate) => candidate.id === echoed.id);
  if (byId !== -1) {
    return insertMessage(messages, echoed);
  }

  // Otherwise find the most recent pending message with the same text on the
  // same target. Only our own messages are ever pending, so this cannot match
  // somebody else's line.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (
      candidate !== undefined &&
      candidate.pending &&
      candidate.target === echoed.target &&
      candidate.text === echoed.text
    ) {
      const next = [...messages];
      next[index] = { ...echoed, pending: false };
      return next;
    }
  }

  return insertMessage(messages, echoed);
}

/**
 * Whether history and the live buffer meet, or whether something is missing
 * between them.
 *
 * A gap means the interface should offer to load more rather than implying the
 * conversation is continuous.
 */
export function hasGap(
  messages: readonly Message[],
  historyOldest: Date | undefined,
  historyNewest: Date | undefined,
): boolean {
  if (historyOldest === undefined || historyNewest === undefined || messages.length === 0) {
    return false;
  }

  const liveOldest = messages[0]?.at;
  if (liveOldest === undefined) {
    return false;
  }
  // History that ends before the live buffer starts leaves a hole between them.
  return historyNewest.getTime() < liveOldest.getTime();
}

/** Drops every message whose source matches an ignore predicate. */
export function withoutIgnored(
  messages: readonly Message[],
  isIgnored: (nick: string) => boolean,
): readonly Message[] {
  return messages.filter((message) => {
    const nick = message.source?.nick;
    return nick === undefined || !isIgnored(nick);
  });
}
