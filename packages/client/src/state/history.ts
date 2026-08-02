/**
 * `draft/chathistory` integration: backfill on join, paginated load-on-scroll,
 * and gap detection.
 *
 * On the web build this is the only scrollback that exists — nothing is stored
 * locally on any platform for message content, and the web build stores nothing
 * at all. So the three states a conversation can be in have to be distinct and
 * visible: history is still loading, history has reached the start, or history
 * stopped short and there is a hole.
 *
 * The requests themselves are built in `@marmotter/protocol`, which reads
 * ISUPPORT for the page ceiling and the accepted reference types. This module
 * decides *when* to ask and what the answer means.
 */

import {
  type MessageRef,
  fold,
  latestHistoryLine,
  missedHistoryLine,
  olderHistoryLine,
  supportsChatHistory,
} from '@marmotter/protocol';
import type { ChannelState, Message, NetworkState, OpenBatch, PendingHistory } from './types.js';

export interface HistoryRequest {
  readonly state: NetworkState;
  readonly send: readonly string[];
}

/** Why a history request produced no line. */
export type HistorySkip =
  /** The network does not offer server-side history. */
  | 'unsupported'
  /** A request for this conversation is already in flight. */
  | 'in-flight'
  /** History already reaches the start of the conversation. */
  | 'complete'
  /** There is nothing to page backwards from yet. */
  | 'no-anchor';

export type HistoryResult =
  | { readonly ok: true; readonly state: NetworkState; readonly send: readonly string[] }
  | { readonly ok: false; readonly reason: HistorySkip };

const conversation = (
  state: NetworkState,
  target: string,
): { key: string; channel: ChannelState | undefined; inChannels: boolean } => {
  const key = fold(target, state.support.caseMapping);
  const channel = state.channels.get(key);
  if (channel !== undefined) {
    return { key, channel, inChannels: true };
  }
  return { key, channel: state.queries.get(key), inChannels: false };
};

const withChannel = (
  state: NetworkState,
  key: string,
  inChannels: boolean,
  channel: ChannelState,
): NetworkState => {
  if (inChannels) {
    const channels = new Map(state.channels);
    channels.set(key, channel);
    return { ...state, channels };
  }
  const queries = new Map(state.queries);
  queries.set(key, channel);
  return { ...state, queries };
};

/**
 * A message expressed as a page boundary, or undefined when it cannot be.
 *
 * A `msgid` is exact and preferred. Failing that, a `server-time` timestamp is
 * a point both sides agree on. A locally-clocked timestamp is neither: it is
 * our guess at when a message arrived, and a clock a minute fast would page
 * from a moment the server thinks is in the future, silently skipping
 * everything in between. A derived id is likewise ours alone, and the server
 * has never heard of it.
 */
function refFor(message: Message): MessageRef | undefined {
  if (!message.id.startsWith('d:')) {
    return { kind: 'msgid', id: message.id };
  }
  return message.fromServerTime ? { kind: 'timestamp', at: message.at } : undefined;
}

/** The reference to page backwards from. */
export function oldestRef(channel: ChannelState): MessageRef | undefined {
  for (const message of channel.messages) {
    const ref = refFor(message);
    if (ref !== undefined) {
      return ref;
    }
  }
  return undefined;
}

/** The reference to page forwards from, for catching up after a reconnect. */
export function newestRef(channel: ChannelState): MessageRef | undefined {
  for (let index = channel.messages.length - 1; index >= 0; index -= 1) {
    const message = channel.messages[index];
    const ref = message === undefined ? undefined : refFor(message);
    if (ref !== undefined) {
      return ref;
    }
  }
  return undefined;
}

/**
 * The oldest point in a conversation that server history can be compared to.
 *
 * Only a `server-time` timestamp qualifies. A locally-clocked event — a join
 * stamped by our own clock — is not on the same timeline as anything the server
 * returns, and comparing the two would report holes that are really clock skew.
 */
export function historyAnchorTime(channel: ChannelState): Date | undefined {
  for (const message of channel.messages) {
    if (message.fromServerTime) {
      return message.at;
    }
  }
  return undefined;
}

/** Marks a request as in flight, so a second one is not issued over it. */
const beginLoading = (
  state: NetworkState,
  target: string,
  pending: PendingHistory,
): NetworkState => {
  const { key, channel, inChannels } = conversation(state, target);
  if (channel === undefined) {
    return state;
  }
  return withChannel(state, key, inChannels, { ...channel, historyPending: pending });
};

/**
 * Asks for the newest page, which is what a fresh join wants.
 *
 * Nothing is assumed about how much the server holds: the response tells us,
 * because a page shorter than the one requested means there is no more.
 */
export function requestBackfill(
  state: NetworkState,
  target: string,
  limit?: number,
): HistoryResult {
  const { channel } = conversation(state, target);
  if (channel === undefined || !supportsChatHistory(state.support)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (channel.historyPending !== undefined) {
    return { ok: false, reason: 'in-flight' };
  }

  const built = latestHistoryLine(target, state.support, limit);
  if (!built.ok) {
    return { ok: false, reason: 'unsupported' };
  }

  return {
    ok: true,
    state: beginLoading(state, target, { kind: 'latest', limit: built.limit }),
    send: [built.line],
  };
}

/**
 * Asks for the page before what is already loaded, which is what scrolling
 * upward wants.
 */
export function requestOlder(state: NetworkState, target: string, limit?: number): HistoryResult {
  const { channel } = conversation(state, target);
  if (channel === undefined || !supportsChatHistory(state.support)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (channel.historyPending !== undefined) {
    return { ok: false, reason: 'in-flight' };
  }
  if (channel.historyComplete) {
    return { ok: false, reason: 'complete' };
  }

  const anchor = oldestRef(channel);
  if (anchor === undefined) {
    // Nothing loaded yet, so there is no "before" — ask for the newest page.
    return requestBackfill(state, target, limit);
  }

  const built = olderHistoryLine(target, anchor, state.support, limit);
  if (!built.ok) {
    return { ok: false, reason: 'unsupported' };
  }

  return {
    ok: true,
    state: beginLoading(state, target, { kind: 'older', limit: built.limit }),
    send: [built.line],
  };
}

/**
 * Asks for whatever arrived while we were disconnected.
 *
 * Called on reconnect rather than on join. Without it a reconnect looks like a
 * quiet channel, which is the single most misleading thing a client can do.
 */
export function requestMissed(state: NetworkState, target: string, limit?: number): HistoryResult {
  const { channel } = conversation(state, target);
  if (channel === undefined || !supportsChatHistory(state.support)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (channel.historyPending !== undefined) {
    return { ok: false, reason: 'in-flight' };
  }

  const anchor = newestRef(channel);
  if (anchor === undefined) {
    return { ok: false, reason: 'no-anchor' };
  }

  const built = missedHistoryLine(target, anchor, state.support, limit);
  if (!built.ok) {
    return { ok: false, reason: 'unsupported' };
  }

  return {
    ok: true,
    state: beginLoading(state, target, { kind: 'missed', limit: built.limit }),
    send: [built.line],
  };
}

/**
 * Applies what a finished `chathistory` batch says about the conversation.
 *
 * No server states that it has reached the beginning, so completeness is
 * inferred: a page shorter than the one asked for means there was no more to
 * give. A gap is the opposite case — the server had plenty, and what it gave
 * does not meet what we already hold.
 */
export function completeHistoryBatch(
  state: NetworkState,
  target: string,
  batch: OpenBatch,
): NetworkState {
  const { key, channel, inChannels } = conversation(state, target);
  if (channel === undefined) {
    return state;
  }

  const pending = channel.historyPending;
  if (pending === undefined) {
    // History we did not ask for — a server pushing scrollback on join. It is
    // still real history, but it says nothing about what else exists.
    return state;
  }

  const short = batch.count < pending.limit;

  switch (pending.kind) {
    case 'latest':
    case 'older': {
      // A page taken from before our oldest message meets it by construction,
      // so only the newest page can land clear of what we already hold. A short
      // page is never a hole either: the server gave everything it has, and
      // offering to load what does not exist is worse than saying nothing.
      const disjoint =
        !short &&
        pending.kind === 'latest' &&
        batch.newest !== undefined &&
        batch.liveOldest !== undefined &&
        batch.newest.getTime() < batch.liveOldest.getTime();

      return withChannel(state, key, inChannels, {
        ...channel,
        historyPending: undefined,
        historyComplete: short ? true : channel.historyComplete,
        historyGap: disjoint,
      });
    }

    case 'missed':
      // A full page means the server had at least that much, so there may be
      // more between what we just took and now.
      return withChannel(state, key, inChannels, {
        ...channel,
        historyPending: undefined,
        historyGap: !short,
      });
  }
}

/**
 * Backfills every joined channel, for use once registration completes.
 *
 * Queries are deliberately excluded: reopening every private conversation the
 * server remembers is not what a person expects from connecting.
 */
export function backfillJoinedChannels(state: NetworkState, limit?: number): HistoryRequest {
  let current = state;
  const send: string[] = [];

  for (const channel of state.channels.values()) {
    if (!channel.joined) {
      continue;
    }
    const result = requestBackfill(current, channel.name, limit);
    if (result.ok) {
      current = result.state;
      send.push(...result.send);
    }
  }

  return { state: current, send };
}
