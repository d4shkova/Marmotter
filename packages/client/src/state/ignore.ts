/**
 * The client-side mute list.
 *
 * Nothing here reaches the server. IRC has no server-side ignore worth using,
 * so suppression happens on arrival: the message is dropped before it enters
 * the buffer, and the ignored person has no way to tell.
 *
 * Two properties matter and are easy to get wrong. Matching is casemapped, so
 * a network where `Tamsin` and `tamsin[` are the same person cannot be evaded
 * by changing case. And an expired rule stops matching without anyone having to
 * remember to remove it, because a mute set "for an hour" that silently lasts
 * forever is worse than no mute at all.
 */

import { type CaseMapping, type Source, fold } from '@marmotter/protocol';
import { DEFAULT_IGNORE_SCOPE, type IgnoreRule, type IgnoreScope } from './types.js';

/** Which part of the interface is asking whether something is muted. */
export type IgnoreChannel = keyof IgnoreScope;

/**
 * Turns a mask into a matcher.
 *
 * `*` matches any run, `?` matches one character, and everything else is
 * literal — including regex metacharacters, which a hostmask is full of.
 */
function maskToRegExp(mask: string): RegExp {
  const escaped = mask.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`);
}

const matcherCache = new Map<string, RegExp>();

function matcherFor(mask: string): RegExp {
  const cached = matcherCache.get(mask);
  if (cached !== undefined) {
    return cached;
  }
  const matcher = maskToRegExp(mask);
  // Bounded so a long session cannot grow this without limit; the list a person
  // actually maintains is far smaller than this.
  if (matcherCache.size > 512) {
    matcherCache.clear();
  }
  matcherCache.set(mask, matcher);
  return matcher;
}

/**
 * Renders a source as the `nick!user@host` a mask is matched against.
 *
 * A source with no user or host — a server, or a network that withholds them
 * until WHO — becomes `nick!*@*`, so a nick-only rule still matches and a
 * host-scoped one correctly does not.
 */
export function hostmaskOf(source: Source | undefined): string | undefined {
  if (source === undefined || source.nick === '') {
    return undefined;
  }
  const user = source.user === '' ? '*' : source.user;
  const host = source.host === '' ? '*' : source.host;
  return `${source.nick}!${user}@${host}`;
}

/** Whether a rule is still in force at a given moment. */
export function isActive(rule: IgnoreRule, now: Date): boolean {
  return rule.expiresAt === undefined || rule.expiresAt.getTime() > now.getTime();
}

/**
 * Whether a hostmask matches a rule.
 *
 * The rule's mask is completed to `nick!user@host` first: a user typing
 * `tamsin` means that person, not a literal nick with no user or host.
 */
export function matchesMask(mask: string, hostmask: string, mapping: CaseMapping): boolean {
  return matcherFor(fold(completeMask(mask), mapping)).test(fold(hostmask, mapping));
}

/**
 * Fills in the parts of a mask the user left out.
 *
 * `tamsin` becomes `tamsin!*@*`; `*@example.com` becomes `*!*@example.com`;
 * `~u@host` becomes `*!~u@host`. This is what makes the mask builder's simple
 * cases work without the user knowing the shape.
 */
export function completeMask(mask: string): string {
  if (mask === '') {
    return '*!*@*';
  }

  const at = mask.indexOf('@');
  const bang = mask.indexOf('!');

  if (bang !== -1 && at !== -1) {
    return mask;
  }
  if (at !== -1) {
    // `user@host`, or `@host` when the user part was left off.
    const user = mask.slice(0, at);
    return `*!${user === '' ? '*' : user}@${mask.slice(at + 1)}`;
  }
  if (bang !== -1) {
    // `nick!user`, with the host left off.
    return `${mask}@*`;
  }
  return `${mask}!*@*`;
}

export interface IgnoreQuery {
  /** The sender, as `nick!user@host`. */
  readonly hostmask: string;
  readonly channel: IgnoreChannel;
  readonly mapping: CaseMapping;
  readonly now?: Date;
}

/** The rule suppressing something, or undefined when nothing does. */
export function findIgnore(
  rules: readonly IgnoreRule[],
  query: IgnoreQuery,
): IgnoreRule | undefined {
  const now = query.now ?? new Date();
  return rules.find(
    (rule) =>
      rule.scope[query.channel] &&
      isActive(rule, now) &&
      matchesMask(rule.mask, query.hostmask, query.mapping),
  );
}

/** Whether something from this sender is suppressed. */
export function isIgnored(rules: readonly IgnoreRule[], query: IgnoreQuery): boolean {
  return findIgnore(rules, query) !== undefined;
}

export interface AddIgnoreOptions {
  readonly scope?: Partial<IgnoreScope>;
  /** How long the rule lasts, in milliseconds. Omit for indefinite. */
  readonly durationMs?: number;
  readonly note?: string;
  readonly now?: Date;
}

/**
 * Adds a rule, or replaces one with the same mask.
 *
 * Replacing rather than appending means adding the same person twice does not
 * leave a stale first rule that outlives the second's expiry.
 */
export function addIgnore(
  rules: readonly IgnoreRule[],
  mask: string,
  options: AddIgnoreOptions = {},
): readonly IgnoreRule[] {
  const now = options.now ?? new Date();
  const completed = completeMask(mask);
  const rule: IgnoreRule = {
    mask: completed,
    scope: { ...DEFAULT_IGNORE_SCOPE, ...options.scope },
    expiresAt:
      options.durationMs === undefined ? undefined : new Date(now.getTime() + options.durationMs),
    note: options.note,
  };

  const without = rules.filter((existing) => existing.mask !== completed);
  return [...without, rule];
}

/** Removes a rule by mask, accepting the shorthand the user typed. */
export function removeIgnore(rules: readonly IgnoreRule[], mask: string): readonly IgnoreRule[] {
  const completed = completeMask(mask);
  return rules.filter((rule) => rule.mask !== completed);
}

/**
 * Drops lapsed rules.
 *
 * Returns the same array when nothing lapsed, so a caller can skip a re-render.
 */
export function pruneIgnores(
  rules: readonly IgnoreRule[],
  now: Date = new Date(),
): readonly IgnoreRule[] {
  const active = rules.filter((rule) => isActive(rule, now));
  return active.length === rules.length ? rules : active;
}

/**
 * Candidate masks for a person, narrowest first, for the mask builder.
 *
 * The interface shows these as named choices — "This nick", "This person",
 * "Everyone on this host" — with the mask itself in the decoder rather than the
 * primary copy.
 */
export function suggestMasks(source: Source): readonly string[] {
  const user = source.user === '' ? '*' : source.user;
  const host = source.host === '' ? '*' : source.host;

  const masks = [
    `${source.nick}!${user}@${host}`,
    `${source.nick}!*@*`,
    `*!${user}@${host}`,
    `*!*@${host}`,
  ];
  // A source with no user or host collapses several of these to the same thing.
  return [...new Set(masks)];
}
