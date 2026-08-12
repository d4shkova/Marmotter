/**
 * Driving the log store from what the client is holding.
 *
 * Watches each conversation for lines it has not written yet, batches them, and
 * hands them to whatever `LogStore` the platform supplied — or does nothing at
 * all where there is none, which is the web build.
 *
 * Two things this deliberately does *not* do. It does not live in the reducer:
 * "have I written this down" is no more a question about network state than
 * "have I read this" is, and the reducer would have to answer both. And it does
 * not write per message: a busy channel is several lines a second, and a disk
 * write each would make logging the client's slowest path.
 */

import type { NetworkState } from '@marmotter/client';
import { shouldLog, toLogRecord } from '@marmotter/client';
import type { LogRecord, LogStore, LoggingPolicy } from '@marmotter/shared';
import { useEffect, useRef } from 'react';

/** How long lines wait to be written together. */
const FLUSH_MS = 2_000;

/** How often retention is enforced while the app is open. */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export interface MessageLoggingOptions {
  readonly networks: readonly NetworkState[];
  /** The platform's store, or undefined where the platform keeps nothing. */
  readonly store: LogStore | undefined;
  /** The policy in force for a network, global and override already merged. */
  readonly policyFor: (networkId: string) => LoggingPolicy;
  /** Whether a target is a channel on that network, read from its CHANTYPES. */
  readonly isChannelTarget: (networkId: string, target: string) => boolean;
  /** Reports a write that failed, so a full disk is not silent. */
  readonly onError: (message: string) => void;
}

/**
 * Records not yet written, and where each conversation was left off.
 *
 * Kept in refs rather than state: none of it is rendered, and a re-render per
 * logged line would be a rendering cost paid for a disk write.
 */
interface Progress {
  /** The ID of the last message written, per network+target. */
  readonly written: Map<string, string>;
  /** Lines waiting for the next flush. */
  pending: LogRecord[];
  /** Whether a flush is already running, so two do not overlap. */
  flushing: boolean;
}

export function collectNewRecords(
  networks: readonly NetworkState[],
  options: Pick<MessageLoggingOptions, 'policyFor' | 'isChannelTarget'>,
  written: Map<string, string>,
): readonly LogRecord[] {
  const collected: LogRecord[] = [];

  for (const state of networks) {
    const policy = options.policyFor(state.id);
    for (const [key, conversation] of [...state.channels, ...state.queries]) {
      const messages = conversation.messages;
      if (messages.length === 0) {
        continue;
      }
      const seenKey = `${state.id} ${key}`;
      const last = written.get(seenKey);

      // Where to resume. A conversation seen for the first time starts at its
      // end, not its beginning: a `chathistory` backfill is the server handing
      // over messages that were said before logging was switched on, and
      // writing those would be inventing a log the user never kept.
      let start = messages.length;
      if (last !== undefined) {
        const index = messages.findIndex((message) => message.id === last);
        // A line that has scrolled out of the buffer entirely means the buffer
        // was trimmed; resuming at the start writes what is still there rather
        // than silently skipping it.
        start = index === -1 ? 0 : index + 1;
      }

      const newest = messages[messages.length - 1];
      if (newest !== undefined) {
        written.set(seenKey, newest.id);
      }
      if (!policy.enabled) {
        continue;
      }

      for (const message of messages.slice(start)) {
        if (shouldLog(policy, message, (target) => options.isChannelTarget(state.id, target))) {
          collected.push(toLogRecord(message, { id: state.id, name: state.name }));
        }
      }
    }
  }

  return collected;
}

/** Writes conversations to the platform's log store as they happen. */
export function useMessageLogging(options: MessageLoggingOptions): void {
  const progress = useRef<Progress>({ written: new Map(), pending: [], flushing: false });
  // Held in a ref so the flush timer below does not need rebuilding whenever a
  // message arrives, which is what would happen if it closed over the props.
  const latest = useRef(options);
  latest.current = options;

  // Collecting. Runs on every change to the networks array, which the store
  // hands back new whenever any conversation changes.
  useEffect(() => {
    const { store } = latest.current;
    const records = collectNewRecords(options.networks, latest.current, progress.current.written);
    if (store !== undefined && records.length > 0) {
      progress.current.pending.push(...records);
    }
  }, [options.networks]);

  // Writing. One timer for the whole app rather than one per conversation.
  useEffect(() => {
    const flush = async (): Promise<void> => {
      const state = progress.current;
      const { store, onError } = latest.current;
      if (store === undefined || state.flushing || state.pending.length === 0) {
        return;
      }
      const batch = state.pending;
      state.pending = [];
      state.flushing = true;
      try {
        await store.append(batch);
      } catch (error) {
        // Put them back, so a disk that was briefly full does not lose the
        // conversation — and say so once rather than per line.
        state.pending = [...batch, ...state.pending];
        onError(error instanceof Error ? error.message : String(error));
      } finally {
        state.flushing = false;
      }
    };

    const timer = window.setInterval(() => void flush(), FLUSH_MS);
    return () => {
      window.clearInterval(timer);
      // A last write on the way out, so closing the window does not drop the
      // few seconds since the last flush.
      void flush();
    };
  }, []);
}

/**
 * Enforces retention: on open, and hourly while the app stays open.
 *
 * Per network, because a network may keep less than the rest. A network whose
 * policy says forever is skipped rather than passed a cutoff of the epoch,
 * which would be a delete statement that happens to match nothing.
 */
export function usePurge(options: {
  readonly store: LogStore | undefined;
  readonly networkIds: readonly string[];
  readonly cutoffFor: (networkId: string) => Date | undefined;
  readonly onError: (message: string) => void;
}): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const purge = async (): Promise<void> => {
      const { store, networkIds, cutoffFor, onError } = latest.current;
      if (store === undefined) {
        return;
      }
      for (const id of networkIds) {
        const cutoff = cutoffFor(id);
        if (cutoff === undefined) {
          continue;
        }
        try {
          await store.purge(cutoff, id);
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
          return;
        }
      }
    };

    void purge();
    const timer = window.setInterval(() => void purge(), PURGE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
}
