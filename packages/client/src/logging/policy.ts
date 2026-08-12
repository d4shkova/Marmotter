/**
 * What gets logged, and for how long.
 *
 * Pure decisions over a `LoggingPolicy`, with no disk anywhere near them. The
 * store writes what these say to write; keeping the judgement here is what
 * makes "does a server notice get logged when the scope says no" a test rather
 * than a thing somebody has to reproduce by running the app.
 *
 * The bias throughout is towards writing less. Logging is off by default,
 * enabling it is an explicit choice, and where the policy is ambiguous the
 * answer is not to write — a line that was not kept is a smaller mistake than
 * one that was kept against the user's wishes.
 */

import type { LoggingPolicy } from '@marmotter/shared';
import type { Message } from '../state/types.js';

/**
 * Kinds that are never written, whatever the policy says.
 *
 * These are the client talking to itself: an error rendered for the person
 * looking at it, and the folded join/part traffic that CLAUDE.md already treats
 * as noise in the interface. A log of them is a log of the client's own
 * behaviour rather than the conversation.
 */
const NEVER_LOGGED: ReadonlySet<string> = new Set(['error']);

/** Whether this target is a conversation with a channel rather than a person. */
export type TargetKind = 'channel' | 'private' | 'server';

/**
 * Which part of the scope a message falls under.
 *
 * `isChannelTarget` comes from the network's own `CHANTYPES` rather than a
 * hardcoded `#`, because the caller knows the network and this function should
 * not have to.
 */
export function targetKind(
  message: Message,
  isChannelTarget: (target: string) => boolean,
): TargetKind {
  if (message.kind === 'server' || message.target === '') {
    return 'server';
  }
  return isChannelTarget(message.target) ? 'channel' : 'private';
}

/** Whether a message is written to the log under this policy. */
export function shouldLog(
  policy: LoggingPolicy,
  message: Message,
  isChannelTarget: (target: string) => boolean,
): boolean {
  if (!policy.enabled) {
    return false;
  }
  if (NEVER_LOGGED.has(message.kind)) {
    return false;
  }
  // A message still in flight has no confirmed content or time. It is logged
  // when it comes back through `echo-message`, or not at all — writing it twice
  // is worse than writing it late.
  if (message.pending) {
    return false;
  }
  switch (targetKind(message, isChannelTarget)) {
    case 'channel':
      return policy.scope.channels;
    case 'private':
      return policy.scope.privateMessages;
    case 'server':
      return policy.scope.serverNotices;
  }
}

/**
 * The instant before which logged lines are deleted, or undefined to keep all.
 *
 * A whole number of days back from now, which is what the setting says and what
 * somebody reading "kept for 30 days" expects.
 */
export function retentionCutoff(policy: LoggingPolicy, now: Date): Date | undefined {
  if (policy.retentionDays === 'forever') {
    return undefined;
  }
  const days = Math.max(0, Math.floor(policy.retentionDays));
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * The policy in force for a network.
 *
 * A network either carries its own policy or follows the one set globally.
 * Merged rather than either-or so that switching logging off globally switches
 * it off everywhere, which is what somebody reaching for that switch means —
 * an override that could quietly keep writing after a global "off" would be a
 * setting that lies.
 */
export function effectivePolicy(
  global: LoggingPolicy,
  override: LoggingPolicy | undefined,
): LoggingPolicy {
  if (override === undefined) {
    return global;
  }
  return { ...override, enabled: global.enabled && override.enabled };
}
