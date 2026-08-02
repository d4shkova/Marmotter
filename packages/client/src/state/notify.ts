/**
 * The notify list — the Friends panel's data.
 *
 * Three mechanisms do the same job, and which one a network offers is not the
 * user's problem. MONITOR is the modern one and Libera has it; WATCH is the
 * older one and UnrealIRCd has it; a network with neither has to be polled with
 * WHOIS, which is why the poll interval is deliberately slow.
 *
 * All three converge on the same `monitor` event in the protocol layer, so
 * everything below this line is about issuing the right commands, not about
 * reading the replies.
 */

import { type ISupport, fold } from '@marmotter/protocol';
import type { NetworkState, NotifyEntry } from './types.js';

export type NotifyMechanism = 'monitor' | 'watch' | 'poll';

/** Which mechanism this network gets, best first. */
export function notifyMechanism(support: ISupport): NotifyMechanism {
  if (support.monitor.supported) {
    return 'monitor';
  }
  if (support.watch.supported) {
    return 'watch';
  }
  return 'poll';
}

/**
 * How many nicks the network will watch.
 *
 * Undefined means no stated limit. The poll fallback gets a deliberately small
 * one: each entry is a WHOIS on every tick, and a long list would be
 * indistinguishable from flooding.
 */
export function notifyLimit(support: ISupport): number | undefined {
  switch (notifyMechanism(support)) {
    case 'monitor':
      return support.monitor.limit;
    case 'watch':
      return support.watch.limit;
    case 'poll':
      return POLL_LIMIT;
  }
}

/** The most nicks worth polling with WHOIS. */
export const POLL_LIMIT = 20;

/** How often to poll, on a network with neither MONITOR nor WATCH. */
export const POLL_INTERVAL_MS = 60_000;

/**
 * How many targets to put on one line.
 *
 * Both MONITOR and WATCH take a comma-separated list, and both are subject to
 * the 512-byte line limit, so a long list is chunked rather than truncated by
 * the server.
 */
export const NOTIFY_BATCH = 20;

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

/** Lines that add nicks to the notify list. */
export function addNotifyLines(nicks: readonly string[], support: ISupport): readonly string[] {
  if (nicks.length === 0) {
    return [];
  }
  switch (notifyMechanism(support)) {
    case 'monitor':
      return chunk(nicks, NOTIFY_BATCH).map((group) => `MONITOR + ${group.join(',')}`);
    case 'watch':
      // WATCH takes each nick prefixed with `+`, space-separated.
      return chunk(nicks, NOTIFY_BATCH).map(
        (group) => `WATCH ${group.map((nick) => `+${nick}`).join(' ')}`,
      );
    case 'poll':
      // Nothing to register; the poll picks them up on its next tick.
      return [];
  }
}

/** Lines that remove nicks from the notify list. */
export function removeNotifyLines(nicks: readonly string[], support: ISupport): readonly string[] {
  if (nicks.length === 0) {
    return [];
  }
  switch (notifyMechanism(support)) {
    case 'monitor':
      return chunk(nicks, NOTIFY_BATCH).map((group) => `MONITOR - ${group.join(',')}`);
    case 'watch':
      return chunk(nicks, NOTIFY_BATCH).map(
        (group) => `WATCH ${group.map((nick) => `-${nick}`).join(' ')}`,
      );
    case 'poll':
      return [];
  }
}

/** Lines that ask the server for the current state of the whole list. */
export function refreshNotifyLines(nicks: readonly string[], support: ISupport): readonly string[] {
  if (nicks.length === 0) {
    return [];
  }
  switch (notifyMechanism(support)) {
    case 'monitor':
      return ['MONITOR S'];
    case 'watch':
      return ['WATCH S'];
    case 'poll':
      // One WHOIS per nick, and no more than the poll list is allowed to hold.
      return nicks.slice(0, POLL_LIMIT).map((nick) => `WHOIS ${nick}`);
  }
}

/** The line that clears the server-side list, for a clean reconnect. */
export function clearNotifyLines(support: ISupport): readonly string[] {
  switch (notifyMechanism(support)) {
    case 'monitor':
      return ['MONITOR C'];
    case 'watch':
      return ['WATCH C'];
    case 'poll':
      return [];
  }
}

export interface NotifyChange {
  readonly notify: ReadonlyMap<string, NotifyEntry>;
  readonly send: readonly string[];
}

/**
 * Adds nicks to the list.
 *
 * A nick already present is left alone rather than reset to unknown: the panel
 * should not flicker to "checking" because the user added a duplicate. Nicks
 * beyond the network's limit are dropped, with the caller free to report it —
 * silently registering fewer than asked is how a Friends panel starts lying.
 */
export function addToNotify(
  state: NetworkState,
  nicks: readonly string[],
): NotifyChange & { readonly rejected: readonly string[] } {
  const mapping = state.support.caseMapping;
  const notify = new Map(state.notify);
  const added: string[] = [];
  const rejected: string[] = [];
  const limit = notifyLimit(state.support);

  for (const nick of nicks) {
    if (nick === '') {
      continue;
    }
    const key = fold(nick, mapping);
    if (notify.has(key)) {
      continue;
    }
    if (limit !== undefined && notify.size >= limit) {
      rejected.push(nick);
      continue;
    }
    notify.set(key, { nick, online: false, known: false });
    added.push(nick);
  }

  return { notify, send: addNotifyLines(added, state.support), rejected };
}

export function removeFromNotify(state: NetworkState, nicks: readonly string[]): NotifyChange {
  const mapping = state.support.caseMapping;
  const notify = new Map(state.notify);
  const removed: string[] = [];

  for (const nick of nicks) {
    const key = fold(nick, mapping);
    const entry = notify.get(key);
    if (entry === undefined) {
      continue;
    }
    notify.delete(key);
    removed.push(entry.nick);
  }

  return { notify, send: removeNotifyLines(removed, state.support) };
}

/**
 * Re-registers the whole list.
 *
 * Called after reconnecting: MONITOR and WATCH lists live on the server and do
 * not survive the connection, so a reconnect that skips this leaves the panel
 * showing whatever was true before the disconnect, forever.
 */
export function resyncNotify(state: NetworkState): NotifyChange {
  const notify = new Map<string, NotifyEntry>();
  for (const [key, entry] of state.notify) {
    // Nothing is known again until the server says so.
    notify.set(key, { ...entry, known: false });
  }

  const nicks = [...notify.values()].map((entry) => entry.nick);
  return {
    notify,
    send: [...clearNotifyLines(state.support), ...addNotifyLines(nicks, state.support)],
  };
}

/** Nicks to WHOIS on this tick, on a network with no notify mechanism. */
export function pollTargets(state: NetworkState): readonly string[] {
  if (notifyMechanism(state.support) !== 'poll') {
    return [];
  }
  return [...state.notify.values()].slice(0, POLL_LIMIT).map((entry) => entry.nick);
}
