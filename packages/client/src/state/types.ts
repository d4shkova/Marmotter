/**
 * Per-network and per-channel state.
 *
 * Everything here is plain data, keyed by network ID from the first field. There
 * is deliberately no "current network" or "current channel": that belongs to the
 * interface, and putting it here is what makes multi-network painful to retrofit.
 */

import type {
  CaseMapping,
  CapState,
  ChannelModeState,
  ISupport,
  ListKind,
  ModeChange,
  Source,
  Tags,
  WhoisProfile,
} from '@marmotter/protocol';
import type { CloseReason } from '@marmotter/shared';

/** One person in a channel. */
export interface Member {
  readonly nick: string;
  /** From extended-join or WHO. Empty until one of those arrives. */
  readonly user: string;
  readonly host: string;
  /** Services account, or undefined when logged out or unknown. */
  readonly account: string | undefined;
  readonly realname: string;
  readonly away: boolean;
  readonly bot: boolean;
  /** Status prefixes, ordered most privileged first per `PREFIX`. */
  readonly prefixes: string;
}

export interface ListEntry {
  readonly mask: string;
  readonly setBy: string | undefined;
  readonly at: Date | undefined;
}

/** What a line in the message list is. */
export type MessageKind =
  | 'privmsg'
  | 'notice'
  | 'action'
  | 'join'
  | 'part'
  | 'quit'
  | 'nick'
  | 'kick'
  | 'mode'
  | 'topic'
  | 'invite'
  /** A server notice, or a numeric that earned a visible line. */
  | 'server'
  /** An error rendered as plain English, with a suggested action. */
  | 'error';

/** Whether a message is an event that folds into a summary row. */
export const FOLDABLE_KINDS: ReadonlySet<MessageKind> = new Set<MessageKind>([
  'join',
  'part',
  'quit',
  'nick',
]);

export interface Message {
  /** `msgid` where the server provides one, generated otherwise. */
  readonly id: string;
  readonly kind: MessageKind;
  readonly at: Date;
  /**
   * Whether `at` came from the server's `server-time` tag.
   *
   * The interface shows the distinction on hover: a local clock can disagree
   * with the server by minutes.
   */
  readonly fromServerTime: boolean;
  readonly source: Source | undefined;
  /** Channel or nick this belongs to. */
  readonly target: string;
  readonly text: string;
  /** Services account of the sender, from `account-tag`. */
  readonly account: string | undefined;
  /** `msgid` this replies to, from `+draft/reply`. */
  readonly replyTo: string | undefined;
  /**
   * Sent optimistically and not yet confirmed.
   *
   * Cleared when `echo-message` returns it. Without that capability it stays
   * set, and the interface shows an un-acknowledged indicator.
   */
  readonly pending: boolean;
  readonly tags: Tags;
}

export interface Topic {
  readonly text: string;
  readonly setBy: string | undefined;
  readonly at: Date | undefined;
}

export interface ChannelState {
  /** As the server spells it. Lookups go through the casemapped key. */
  readonly name: string;
  /** False while parted or while a join is still in flight. */
  readonly joined: boolean;
  readonly topic: Topic | undefined;
  readonly modes: ChannelModeState;
  readonly created: Date | undefined;
  /** Keyed by casemapped nick, in the order the server listed them. */
  readonly members: ReadonlyMap<string, Member>;
  /** True while a NAMES burst is arriving. */
  readonly namesLoading: boolean;
  /**
   * Prefix changes received while a NAMES burst was in flight.
   *
   * A server computes its NAMES reply once and streams it, so an entry later in
   * the burst reflects the state before a MODE that arrived mid-burst — and
   * applying that entry would silently undo the mode. The changes are replayed
   * when the burst ends, because the mode is the newer information.
   */
  readonly pendingPrefixChanges: readonly ModeChange[];
  readonly lists: Readonly<Record<ListKind, readonly ListEntry[]>>;
  /** List kinds currently being fetched, so the panel can show progress. */
  readonly listsLoading: ReadonlySet<ListKind>;
  readonly messages: readonly Message[];
  /** True once history is known to reach the start of the conversation. */
  readonly historyComplete: boolean;
  /**
   * True when server history stopped short of what is already in the buffer.
   *
   * The interface must not imply a continuous conversation across a hole, so
   * this drives a "load the messages in between" affordance rather than being
   * hidden.
   */
  readonly historyGap: boolean;
  /** The history request in flight, or undefined when none is. */
  readonly historyPending: PendingHistory | undefined;
}

/**
 * A `chathistory` request awaiting its batch.
 *
 * The direction matters when the batch closes: a page taken from before the
 * oldest message we hold is contiguous by construction, while the newest page
 * on a network we have been away from may not reach back far enough.
 */
export interface PendingHistory {
  readonly kind: 'latest' | 'older' | 'missed';
  /**
   * Page size asked for.
   *
   * A page that comes back shorter than this is how the client learns it has
   * reached the start of the conversation, since no server says so explicitly.
   */
  readonly limit: number;
}

/**
 * A batch the server has opened and not yet closed.
 *
 * The reducer sees one message at a time, so what a batch contained has to be
 * accumulated as it streams rather than read at the end.
 */
export interface OpenBatch {
  readonly reference: string;
  readonly type: string;
  readonly params: readonly string[];
  /** The enclosing batch, when this one is nested. */
  readonly parent: string | undefined;
  /** How many messages have arrived inside it. */
  readonly count: number;
  /** Oldest and newest timestamps seen inside, for gap detection. */
  readonly oldest: Date | undefined;
  readonly newest: Date | undefined;
  /**
   * The oldest message already in the target's buffer when the batch opened.
   *
   * Recorded here because once history is inserted the two are indistinguishable.
   */
  readonly liveOldest: Date | undefined;
}

/**
 * A client-side mute.
 *
 * Ignores never reach the server: nothing is sent, so the ignored person cannot
 * tell. Matching is against `nick!user@host` with `*` and `?` wildcards.
 */
export interface IgnoreRule {
  readonly mask: string;
  /** What the rule suppresses. An empty set would suppress nothing. */
  readonly scope: IgnoreScope;
  /** When the rule lapses. Undefined means it does not. */
  readonly expiresAt: Date | undefined;
  /** Free text the user wrote when adding it. */
  readonly note: string | undefined;
}

export interface IgnoreScope {
  readonly messages: boolean;
  readonly notices: boolean;
  readonly ctcp: boolean;
  readonly invites: boolean;
  /** Joins, parts, quits, nick changes, and mode changes by this person. */
  readonly events: boolean;
}

/** What an ignore suppresses unless the user narrows it. */
export const DEFAULT_IGNORE_SCOPE: IgnoreScope = {
  messages: true,
  notices: true,
  ctcp: true,
  invites: true,
  events: false,
};

export type ConnectionPhase =
  | 'disconnected'
  | 'connecting'
  /** Socket open, CAP and SASL in progress, registration not finished. */
  | 'registering'
  | 'registered';

export interface NetworkState {
  readonly id: string;
  readonly name: string;
  readonly phase: ConnectionPhase;
  readonly lastClose: CloseReason | undefined;

  /** Nick the server has us under, which may not be the one we asked for. */
  readonly nick: string;
  /** Nicks already tried and refused this registration. */
  readonly triedNicks: readonly string[];
  readonly userModes: ReadonlySet<string>;
  readonly account: string | undefined;
  readonly away: boolean;

  readonly support: ISupport;
  readonly caps: CapState;
  readonly serverName: string;
  /** MOTD lines, collapsed into one expandable item by the interface. */
  readonly motd: readonly string[];
  /** Server-info numerics, shown in the server tab. */
  readonly serverNotices: readonly Message[];

  /** Keyed by casemapped channel name. */
  readonly channels: ReadonlyMap<string, ChannelState>;
  /** Private conversations, keyed by casemapped nick. */
  readonly queries: ReadonlyMap<string, ChannelState>;

  /** Nicks being watched, keyed by casemapped nick. */
  readonly notify: ReadonlyMap<string, NotifyEntry>;
  /**
   * WHOIS replies assembled into profiles, keyed by casemapped nick.
   *
   * Kept so the profile card can open on the last reply and refresh in place
   * when a new one arrives, rather than being thrown away line by line.
   */
  readonly whois: ReadonlyMap<string, WhoisProfile>;
  /** Client-side mute list. */
  readonly ignores: readonly IgnoreRule[];

  /** Batches the server has opened and not yet closed, keyed by reference. */
  readonly batches: ReadonlyMap<string, OpenBatch>;

  /** The full bidirectional line stream, for the raw log tab. */
  readonly rawLog: readonly RawLine[];
}

/** Someone on the notify list. */
export interface NotifyEntry {
  /** As the user spelled it. */
  readonly nick: string;
  readonly online: boolean;
  /** False until the server has said either way. */
  readonly known: boolean;
}

export interface RawLine {
  readonly at: Date;
  readonly direction: 'in' | 'out';
  readonly line: string;
}

/** How many raw lines to keep. The raw log is a debugging aid, not a record. */
export const RAW_LOG_LIMIT = 2_000;

/** How many messages to keep per target before dropping the oldest. */
export const MESSAGE_LIMIT = 10_000;

export const emptyChannel = (name: string): ChannelState => ({
  name,
  joined: false,
  topic: undefined,
  modes: { flags: new Set(), params: new Map() },
  created: undefined,
  members: new Map(),
  namesLoading: false,
  pendingPrefixChanges: [],
  lists: { ban: [], except: [], invite: [], quiet: [] },
  listsLoading: new Set(),
  messages: [],
  historyComplete: false,
  historyGap: false,
  historyPending: undefined,
});

/** Whether a history request is in flight for a conversation. */
export const isHistoryLoading = (channel: ChannelState): boolean =>
  channel.historyPending !== undefined;

/** The casemapping in force, which every lookup key must go through. */
export const mappingOf = (state: NetworkState): CaseMapping => state.support.caseMapping;
