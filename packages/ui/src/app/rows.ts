/**
 * The message buffer as rows.
 *
 * The list a person reads is not the list the reducer keeps. Forty people
 * joining after a netsplit is one event to a reader and forty to the protocol;
 * six messages in a row from the same person is one block with one nick on it;
 * and the boundary between yesterday and today is a row of its own that no
 * message corresponds to.
 *
 * Doing that here, as a pure function over the buffer, is what lets the
 * virtualizer measure rows without knowing any of it.
 */

import { FOLDABLE_KINDS, type Message } from '@marmotter/client';

export type Row =
  | {
      readonly kind: 'message';
      readonly id: string;
      readonly message: Message;
      readonly grouped: boolean;
    }
  /** Join, part, quit and nick changes, collapsed into one line. */
  | {
      readonly kind: 'events';
      readonly id: string;
      readonly messages: readonly Message[];
      readonly at: Date;
      readonly summary: string;
    }
  | { readonly kind: 'day'; readonly id: string; readonly at: Date }
  /** Where reading left off, drawn as a line across the list. */
  | { readonly kind: 'unread-marker'; readonly id: string };

export interface RowOptions {
  /** Folds join/part/quit/nick into summary rows. Per channel, per CLAUDE.md. */
  readonly foldEvents: boolean;
  /** How many messages at the end are unread, for the marker. */
  readonly unreadCount?: number;
  /** Consecutive messages from one nick within this many ms share a block. */
  readonly groupWindowMs?: number;
}

const DEFAULT_GROUP_WINDOW_MS = 5 * 60_000;

const sameDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

/**
 * Describes a run of folded events in the words a reader wants.
 *
 * Counted by person rather than by event, because somebody who reconnects
 * three times is one person having trouble, not six things happening.
 */
export function summarise(messages: readonly Message[]): string {
  const people = new Map<string, Set<string>>();
  for (const message of messages) {
    const nick = message.source?.nick ?? '';
    if (nick === '') {
      continue;
    }
    const kinds = people.get(nick) ?? new Set<string>();
    kinds.add(message.kind);
    people.set(nick, kinds);
  }

  const count = people.size;
  if (count === 0) {
    return `${messages.length} events`;
  }

  const kinds = new Set([...people.values()].flatMap((set) => [...set]));
  const names = [...people.keys()];
  const who = count === 1 ? (names[0] ?? '') : `${count} people`;

  if (kinds.size === 1) {
    const [only] = [...kinds];
    switch (only) {
      case 'join':
        return `${who} joined`;
      case 'part':
        return `${who} left`;
      case 'quit':
        return `${who} disconnected`;
      case 'nick':
        return count === 1 ? `${who} changed their name` : `${who} changed their names`;
      default:
        break;
    }
  }

  return `${who} came and went`;
}

/**
 * Builds the rows for a conversation.
 *
 * Pure and synchronous over the buffer, so it can be memoised on the buffer
 * identity and recomputed only when a message actually arrives.
 */
export function buildRows(messages: readonly Message[], options: RowOptions): readonly Row[] {
  const groupWindow = options.groupWindowMs ?? DEFAULT_GROUP_WINDOW_MS;
  const unreadFrom =
    options.unreadCount === undefined || options.unreadCount <= 0
      ? -1
      : messages.length - options.unreadCount;

  const rows: Row[] = [];
  let previousDay: Date | undefined;
  let previousNick: string | undefined;
  let previousAt: Date | undefined;
  let pending: Message[] = [];

  const flush = (): void => {
    if (pending.length === 0) {
      return;
    }
    const first = pending[0];
    if (first === undefined) {
      pending = [];
      return;
    }
    // A single event reads better as itself than as a summary of one.
    if (pending.length === 1) {
      rows.push({ kind: 'message', id: first.id, message: first, grouped: false });
    } else {
      rows.push({
        kind: 'events',
        id: `events:${first.id}`,
        messages: pending,
        at: first.at,
        summary: summarise(pending),
      });
    }
    pending = [];
    previousNick = undefined;
  };

  messages.forEach((message, index) => {
    if (previousDay === undefined || !sameDay(previousDay, message.at)) {
      flush();
      rows.push({ kind: 'day', id: `day:${message.at.toDateString()}`, at: message.at });
      previousDay = message.at;
      previousNick = undefined;
    }

    if (index === unreadFrom) {
      flush();
      rows.push({ kind: 'unread-marker', id: 'unread' });
      previousNick = undefined;
    }

    if (options.foldEvents && FOLDABLE_KINDS.has(message.kind)) {
      pending.push(message);
      return;
    }
    flush();

    const nick = message.source?.nick;
    const grouped =
      message.kind === 'privmsg' &&
      nick !== undefined &&
      nick === previousNick &&
      previousAt !== undefined &&
      message.at.getTime() - previousAt.getTime() < groupWindow;

    rows.push({ kind: 'message', id: message.id, message, grouped });
    previousNick = message.kind === 'privmsg' ? nick : undefined;
    previousAt = message.at;
  });

  flush();
  return rows;
}

/** Estimated height of a row, for the virtualizer's first pass. */
export function estimateRowHeight(row: Row): number {
  switch (row.kind) {
    case 'day':
      return 32;
    case 'unread-marker':
      return 20;
    case 'events':
      return 24;
    case 'message':
      // A rough two-line average: the virtualizer measures the real height once
      // the row is on screen, so this only has to be close enough to keep the
      // scrollbar from jumping.
      return row.message.text.length > 120 ? 44 : 24;
  }
}
