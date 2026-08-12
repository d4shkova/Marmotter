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

import type { ChannelState, ListEntry, Member, NetworkState } from '@marmotter/client';
import { fold, prefixForMode, prefixRank } from '@marmotter/protocol';
import type { MenuItem } from '../primitives/ContextMenu.js';
import { hostmaskOf, matchesMask } from './mask.js';

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
  /**
   * Open the channel's ban or mute table.
   *
   * The way to lift something the menu cannot see. Lists are fetched when their
   * table is opened rather than on join, so most of the time the client does
   * not yet know what this channel bans — and a menu that silently offers
   * nothing would read as "they are not banned" rather than "we have not
   * looked".
   */
  readonly onOpenList?: (kind: 'ban' | 'quiet') => void;
  /** Disconnect them from the network. Server operators only. */
  readonly onKillBuilder?: (member: Member) => void;
}

export interface MemberActionOptions {
  readonly network: NetworkState;
  readonly channel: ChannelState;
  readonly ourNick: string;
  /**
   * Whether the profile says the user operates this network.
   *
   * Discovery, not permission — exactly as the command bar treats it. The
   * network decides what actually happens; this decides whether an alarming
   * verb is put in front of somebody who has no use for it.
   */
  readonly operator?: boolean;
  readonly callbacks: MemberActionCallbacks;
}

/** Entries in a list that would catch this member. */
function entriesCatching(
  member: Member,
  entries: readonly ListEntry[],
  account: string | undefined,
): readonly ListEntry[] {
  const hostmask = hostmaskOf(member);
  return entries.filter((entry) => {
    // An extban names an account rather than an address, so it is compared as
    // one. Anything else the client cannot interpret is left out rather than
    // guessed at: offering to lift a ban that does not catch them is worse than
    // not offering it.
    if (account !== undefined && entry.mask.endsWith(`:${account}`)) {
      return true;
    }
    return matchesMask(hostmask, entry.mask);
  });
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
export function memberActions(member: Member, options: MemberActionOptions): readonly MenuItem[] {
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

    // Lifting what is already set. Each list only knows what has been fetched,
    // so these appear when the client has actually seen a ban or a mute that
    // catches them — and the route into the tables is offered either way, which
    // is what makes "no entry here" mean "nothing to lift" rather than
    // "we never asked".
    const lifts: { readonly kind: 'ban' | 'quiet'; readonly mode: string; readonly one: string }[] =
      [
        { kind: 'ban', mode: 'b', one: 'Lift their ban' },
        { kind: 'quiet', mode: 'q', one: 'Lift their mute' },
      ];

    for (const lift of lifts) {
      if (!support.chanModes.list.includes(lift.mode)) {
        continue;
      }
      const caught = entriesCatching(member, channel.lists[lift.kind], member.account);
      if (caught.length > 0) {
        items.push({
          id: `un${lift.mode}`,
          label: caught.length === 1 ? lift.one : `${lift.one} (${caught.length})`,
          onSelect: () => {
            // One line each rather than one line with several masks: how many
            // parameters a MODE may carry differs by network, and a line the
            // server truncates would lift some of them and silently leave the
            // rest.
            for (const entry of caught) {
              callbacks.onSend(`MODE ${target} -${lift.mode} ${entry.mask}`);
            }
          },
        });
      }
    }

    if (callbacks.onOpenList !== undefined) {
      items.push({
        id: 'lists',
        label: 'Manage bans and mutes',
        onSelect: () => callbacks.onOpenList?.('ban'),
      });
    }
  }

  // Network-operator actions. Kept behind the profile's own flag and below a
  // separator, because "disconnect somebody from the network" alongside "send a
  // message" is a menu that invites an accident.
  if (!isSelf && options.operator === true && callbacks.onKillBuilder !== undefined) {
    items.push({
      id: 'kill',
      label: 'Disconnect from the network',
      destructive: true,
      startsGroup: true,
      onSelect: () => callbacks.onKillBuilder?.(member),
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
