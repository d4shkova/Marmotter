/**
 * Member list operations.
 *
 * BUILD_PLAN singles this out as a common source of bugs, and the reason is
 * that the member list is assembled from six different sources that each carry
 * part of the truth: NAMES gives nicks and prefixes, extended-join gives the
 * account and realname, WHO gives the host, and account-notify, away-notify,
 * chghost and setname amend it afterwards. Every one of them has to update the
 * same record without discarding what the others contributed.
 *
 * Keys are casemapped; the display spelling lives in the record.
 */

import { type CaseMapping, type ISupport, fold, prefixRank } from '@marmotter/protocol';
import type { Member } from './types.js';

export const emptyMember = (nick: string): Member => ({
  nick,
  user: '',
  host: '',
  account: undefined,
  realname: '',
  away: false,
  bot: false,
  prefixes: '',
});

/**
 * Applies a partial update, creating the member when absent.
 *
 * Fields left undefined are kept, which is what makes it safe to call from
 * every source without one clobbering another's contribution.
 */
export function upsertMember(
  members: ReadonlyMap<string, Member>,
  nick: string,
  mapping: CaseMapping,
  update: Partial<Member>,
): ReadonlyMap<string, Member> {
  const key = fold(nick, mapping);
  const existing = members.get(key) ?? emptyMember(nick);

  const next = new Map(members);
  next.set(key, { ...existing, ...update, nick: update.nick ?? existing.nick });
  return next;
}

export function removeMember(
  members: ReadonlyMap<string, Member>,
  nick: string,
  mapping: CaseMapping,
): ReadonlyMap<string, Member> {
  const key = fold(nick, mapping);
  if (!members.has(key)) {
    return members;
  }
  const next = new Map(members);
  next.delete(key);
  return next;
}

/**
 * Renames a member, keeping everything else about them.
 *
 * A nick change must not reset the account, away state, or prefixes: the person
 * did not change, only their name. Getting this wrong is why operators appear
 * to lose their status after renaming.
 */
export function renameMember(
  members: ReadonlyMap<string, Member>,
  from: string,
  to: string,
  mapping: CaseMapping,
): ReadonlyMap<string, Member> {
  const fromKey = fold(from, mapping);
  const existing = members.get(fromKey);
  if (existing === undefined) {
    return members;
  }

  const next = new Map(members);
  next.delete(fromKey);
  next.set(fold(to, mapping), { ...existing, nick: to });
  return next;
}

export function getMember(
  members: ReadonlyMap<string, Member>,
  nick: string,
  mapping: CaseMapping,
): Member | undefined {
  return members.get(fold(nick, mapping));
}

/**
 * Sorts for display: by privilege, then by nick.
 *
 * Privilege order comes from `PREFIX`, never from a hardcoded `@%+`, because
 * networks add owner and admin prefixes in their own order.
 */
export function sortMembers(
  members: ReadonlyMap<string, Member>,
  support: ISupport,
): readonly Member[] {
  return [...members.values()].sort((left, right) => {
    const leftRank = prefixRank(left.prefixes[0] ?? '', support);
    const rightRank = prefixRank(right.prefixes[0] ?? '', support);
    if (leftRank !== rightRank) {
      return rightRank - leftRank;
    }
    return left.nick.toLowerCase().localeCompare(right.nick.toLowerCase());
  });
}

/** How many members are marked away, for the header count. */
export function countAway(members: ReadonlyMap<string, Member>): number {
  let count = 0;
  for (const member of members.values()) {
    if (member.away) {
      count += 1;
    }
  }
  return count;
}
