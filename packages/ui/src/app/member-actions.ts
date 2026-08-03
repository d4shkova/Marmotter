/**
 * The right-click member menu, as a mapping from what a person wants to the
 * IRC that does it.
 *
 * This is the abstraction layer from CLAUDE.md in miniature: "Give operator"
 * rather than `MODE #c +o`, "Remove from channel" rather than `KICK`. Every
 * item that changes the channel is gated by whether the user actually holds the
 * privilege to do it, and every role the menu offers is one the network's own
 * `PREFIX` advertises — so a network without half-ops never shows "Make a
 * half-op", and a member with no power sees only the things anyone can do.
 *
 * Pure: it returns descriptions of menu items, and the caller wires them to the
 * session. That keeps the mapping testable without a connection.
 */

import type { ChannelState, Member, NetworkState } from '@marmotter/client';
import { fold, prefixForMode, prefixRank } from '@marmotter/protocol';
import type { MenuItem } from '../primitives/ContextMenu.js';

export interface MemberActionCallbacks {
  /** Open a direct message with them. */
  readonly onMessage: (nick: string) => void;
  /** Ask the network who they are (WHOIS). */
  readonly onWhois: (nick: string) => void;
  /** Ignore them, client-side. */
  readonly onIgnore?: (nick: string) => void;
  /** Send a raw line — a mode change, a kick — built for the caller. */
  readonly onSend: (line: string) => void;
  /** Open the ban builder rather than banning with a default mask. */
  readonly onBanBuilder?: (member: Member) => void;
  /** Ask for a reason before removing them, rather than kicking silently. */
  readonly onKickBuilder?: (member: Member) => void;
}

/** The highest prefix a member holds, or '' when they hold none. */
const topPrefix = (member: Member): string => member.prefixes[0] ?? '';

/** Whether we outrank them — a precondition for acting on them. */
function canModerate(
  us: Member | undefined,
  them: Member,
  support: NetworkState['support'],
): boolean {
  if (us === undefined) {
    return false;
  }
  const ourRank = prefixRank(topPrefix(us), support);
  // Half-op is the lowest rank that can act on others; below that, nothing.
  // The `%` prefix is half-op where a network has one.
  const halfOp = prefixForMode('h', support);
  const opFloor = halfOp === undefined ? prefixForMode('o', support) : halfOp;
  const floorRank = opFloor === undefined ? Number.POSITIVE_INFINITY : prefixRank(opFloor, support);
  return ourRank >= floorRank && ourRank >= prefixRank(topPrefix(them), support);
}

/**
 * Whether we hold enough of a role in a channel to change it.
 *
 * Used to decide whether the channel panel offers controls or only shows what
 * is set. Half-op is the floor where a network has one, operator where it does
 * not — read from `PREFIX` rather than assumed, because not every ircd has
 * every rank.
 */
export function canModerateChannel(
  network: NetworkState,
  channel: ChannelState,
  ourNick: string,
): boolean {
  const us = channel.members.get(fold(ourNick, network.support.caseMapping));
  if (us === undefined) {
    return false;
  }
  const halfOp = prefixForMode('h', network.support);
  const floor = halfOp ?? prefixForMode('o', network.support);
  if (floor === undefined) {
    return false;
  }
  return prefixRank(topPrefix(us), network.support) >= prefixRank(floor, network.support);
}

/**
 * The actions for one member.
 *
 * `us` is our own member record in the same channel, which is how the menu
 * knows what we are allowed to offer.
 */
export function memberActions(
  member: Member,
  options: {
    readonly network: NetworkState;
    readonly channel: ChannelState;
    readonly ourNick: string;
    readonly callbacks: MemberActionCallbacks;
  },
): readonly MenuItem[] {
  const { network, channel, ourNick, callbacks } = options;
  const support = network.support;
  const mapping = support.caseMapping;
  const target = channel.name;
  const nick = member.nick;

  const us = channel.members.get(fold(ourNick, mapping));
  const isSelf = fold(nick, mapping) === fold(ourNick, mapping);

  const items: MenuItem[] = [
    { id: 'message', label: 'Send a message', onSelect: () => callbacks.onMessage(nick) },
    { id: 'whois', label: 'View details', onSelect: () => callbacks.onWhois(nick) },
  ];

  // Role changes, offered only for the roles this network actually has and only
  // when we outrank the person. Each toggles: granted becomes "remove", absent
  // becomes "give".
  if (!isSelf && canModerate(us, member, support)) {
    const has = (mode: string): boolean => {
      const prefix = prefixForMode(mode, support);
      return prefix !== undefined && member.prefixes.includes(prefix);
    };
    const toggle = (mode: string, giveLabel: string, removeLabel: string): void => {
      if (prefixForMode(mode, support) === undefined) {
        return;
      }
      items.push({
        id: mode,
        label: has(mode) ? removeLabel : giveLabel,
        onSelect: () => callbacks.onSend(`MODE ${target} ${has(mode) ? '-' : '+'}${mode} ${nick}`),
        startsGroup: items.length === 2,
      });
    };

    toggle('o', 'Make an operator', 'Remove operator');
    toggle('h', 'Make a half-op', 'Remove half-op');
    toggle('v', 'Give voice', 'Remove voice');

    items.push({
      id: 'kick',
      label: 'Remove from channel',
      destructive: true,
      startsGroup: true,
      onSelect: () =>
        callbacks.onKickBuilder !== undefined
          ? callbacks.onKickBuilder(member)
          : callbacks.onSend(`KICK ${target} ${nick}`),
    });
    items.push({
      id: 'ban',
      label: 'Ban',
      destructive: true,
      onSelect: () =>
        callbacks.onBanBuilder !== undefined
          ? callbacks.onBanBuilder(member)
          : callbacks.onSend(`MODE ${target} +b ${nick}!*@*`),
    });
  }

  if (!isSelf && callbacks.onIgnore !== undefined) {
    items.push({
      id: 'ignore',
      label: 'Ignore',
      startsGroup: true,
      onSelect: () => callbacks.onIgnore?.(nick),
    });
  }

  return items;
}
