/**
 * Interface state.
 *
 * Kept strictly separate from `@marmotter/client`'s network state, which knows
 * nothing about what the user is looking at. Everything here dies with the
 * window and none of it is worth persisting — except the settings at the
 * bottom, which the app layer persists on desktop and deliberately does not on
 * web.
 *
 * Nothing in this file holds message content. That is the rule from CLAUDE.md
 * that has no exceptions on any platform.
 */

import {
  DEFAULT_CTCP_POLICY,
  type CtcpPolicy,
  type DccSend,
  type XdccPack,
} from '@marmotter/protocol';
import { create } from 'zustand';

/** A conversation the interface can be showing. */
export interface TargetRef {
  readonly networkId: string;
  /** Channel or nick. Undefined means the network's own server tab. */
  readonly target: string | undefined;
}

export type Pane =
  'chat' | 'raw-log' | 'settings' | 'channel-browser' | 'people' | 'account' | 'dcc';

/** How far a file offered over DCC has got. */
export type DccStatus =
  | 'available'
  /** An XDCC pack has been requested; waiting for the bot to start sending. */
  | 'requested'
  | 'downloading'
  | 'downloaded'
  | 'failed';

/**
 * How a file was advertised.
 *
 * `dcc` is a direct `DCC SEND` — an address and port to connect to now. `xdcc`
 * is a catalogue line from a serving bot: it names a pack, and fetching it means
 * asking the bot (`XDCC SEND #n`), which then replies with a `DCC SEND`.
 */
export type DccOfferKind = 'dcc' | 'xdcc';

/**
 * A file the monitor has seen advertised, over a direct `DCC SEND` or an XDCC
 * pack listing.
 *
 * Held only in memory, like everything else here: an offer is a live thing that
 * stops meaning anything once the sender goes away, and none of it is message
 * content worth persisting.
 */
export interface DccOfferRecord {
  readonly id: string;
  readonly kind: DccOfferKind;
  readonly networkId: string;
  /** The network's display name, kept so the browser can show it once. */
  readonly networkName: string;
  /** Who advertised the file — the sender for DCC, the bot for XDCC. */
  readonly from: string;
  /** The conversation it arrived in — a channel, or the sender for a query. */
  readonly target: string;
  readonly filename: string;
  /** Size in bytes, where known. */
  readonly size?: number;
  /** When the offer was seen, epoch milliseconds. */
  readonly receivedAt: number;
  readonly status: DccStatus;
  /** Why a download failed, in plain words, when it did. */
  readonly error?: string;
  /** Where the file was written, once it was. */
  readonly savedPath?: string;
  /** Bytes received so far, while a download is in flight. */
  readonly received?: number;
  /** A passive (reverse) DCC offer, which the receive-only monitor cannot fetch. */
  readonly passive: boolean;
  /** The address to connect to, for a direct DCC offer. */
  readonly host?: string;
  /** The port to connect to, for a direct DCC offer. */
  readonly port?: number;
  /** The pack number, for an XDCC offer. */
  readonly pack?: number;
  /** How many times the bot has sent this pack, for an XDCC offer. */
  readonly gets?: number;
}

/**
 * Options that belong to the person, not to any one network.
 *
 * The DCC file monitor lives here: off by default, and it cannot be switched on
 * until a download folder is chosen, because a downloader with nowhere to put
 * anything is a trap rather than a feature.
 */
export interface UserOptions {
  /** Whether the DCC file monitor is switched on at all. */
  readonly dccMonitorEnabled: boolean;
  /** Where downloaded files are written. Undefined until the user picks one. */
  readonly downloadFolder: string | undefined;
}

export const DEFAULT_USER_OPTIONS: UserOptions = {
  dccMonitorEnabled: false,
  downloadFolder: undefined,
};

export interface Unread {
  /** Messages since the conversation was last read. */
  readonly count: number;
  /**
   * Whether any of them mentioned the user.
   *
   * Kept apart from the count because a highlight is the one thing worth
   * interrupting for, and folding it into a number loses that.
   */
  readonly highlight: boolean;
}

export interface Appearance {
  /** Fixed nick column width, in characters. */
  readonly nickColumnWidth: number;
  /** Right-aligns nicks against the message text, as HexChat does. */
  readonly alignNicksRight: boolean;
  /** Folds join, part, quit and nick changes into one summary row. */
  readonly foldEvents: boolean;
  readonly showTimestamps: boolean;
  /**
   * Fetches a preview for links in messages.
   *
   * Off by default and staying that way: unfurling asks an arbitrary host for a
   * page, which tells that host the user's IP. CLAUDE.md makes that the user's
   * explicit choice.
   */
  readonly unfurlLinks: boolean;
  /** Words that count as a mention, beyond the user's own nick. */
  readonly highlightWords: readonly string[];
  readonly notificationsEnabled: boolean;
  /**
   * Keeps a "Browse channels" shortcut visible under every network's channel
   * list. Somebody new to a network reaches for this — leaving it there rather
   * than only when the list is empty means it does not vanish the moment they
   * take the action they came for.
   */
  readonly showBrowseChannelsShortcut: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  nickColumnWidth: 12,
  alignNicksRight: true,
  foldEvents: true,
  showTimestamps: true,
  unfurlLinks: false,
  highlightWords: [],
  notificationsEnabled: true,
  showBrowseChannelsShortcut: true,
};

const keyOf = (ref: TargetRef): string => `${ref.networkId} ${ref.target ?? ''}`;

export interface ViewState {
  readonly selection: TargetRef | undefined;
  readonly pane: Pane;
  /** Keyed by network+target. */
  readonly unread: ReadonlyMap<string, Unread>;
  /** Unsent composer text, kept per conversation so switching does not lose it. */
  readonly drafts: ReadonlyMap<string, string>;
  /** Networks whose channel list is collapsed in the sidebar. */
  readonly collapsed: ReadonlySet<string>;
  /** Network IDs in the order the user dragged them into. */
  readonly networkOrder: readonly string[];
  readonly sidebarCollapsed: boolean;
  readonly memberListOpen: boolean;
  readonly commandBarOpen: boolean;
  readonly appearance: Appearance;
  /**
   * Which automatic replies to strangers' requests are switched on.
   *
   * Not part of `Appearance`: this is not about how anything looks, it is about
   * what this client tells people who ask.
   */
  readonly ctcp: CtcpPolicy;
  /** Per-person options, including the DCC file monitor. */
  readonly userOptions: UserOptions;
  /**
   * Whether the monitor is actively collecting offers right now.
   *
   * Separate from `userOptions.dccMonitorEnabled`: the panel's Stop button
   * pauses collection without switching the whole feature off, so a burst of
   * offers can be silenced without losing the folder and the toggle.
   */
  readonly dccActive: boolean;
  /** Files seen advertised over DCC this session, newest last. */
  readonly dccOffers: readonly DccOfferRecord[];

  select(ref: TargetRef): void;
  setPane(pane: Pane): void;
  /** Records activity in a conversation that is not the one being looked at. */
  noteActivity(ref: TargetRef, highlight: boolean): void;
  markRead(ref: TargetRef): void;
  setDraft(ref: TargetRef, text: string): void;
  toggleCollapsed(networkId: string): void;
  reorderNetworks(order: readonly string[]): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setMemberListOpen(open: boolean): void;
  setCommandBarOpen(open: boolean): void;
  updateAppearance(changes: Partial<Appearance>): void;
  updateCtcp(changes: Partial<CtcpPolicy>): void;
  updateUserOptions(changes: Partial<UserOptions>): void;
  /** Starts or pauses collection of DCC offers. */
  setDccActive(active: boolean): void;
  /**
   * Records an offer the monitor saw, unless it is a duplicate.
   *
   * A no-op when the monitor is off or paused, so a caller can wire it to every
   * offer without having to check first. Returns nothing; the store is the one
   * that knows whether it is listening.
   */
  recordDccOffer(offer: {
    readonly networkId: string;
    readonly networkName: string;
    readonly from: string;
    readonly target: string;
    readonly send: DccSend;
    readonly at: number;
  }): void;
  /**
   * Records a file a bot advertised over XDCC, unless it is a duplicate.
   *
   * The same no-op-when-off rule as `recordDccOffer`, and deduped on the bot and
   * pack number so a channel that re-lists its catalogue does not pile up rows.
   */
  recordXdccOffer(offer: {
    readonly networkId: string;
    readonly networkName: string;
    readonly from: string;
    readonly target: string;
    readonly pack: XdccPack;
    readonly at: number;
  }): void;
  /** Updates a single offer's transfer state. */
  setDccOfferStatus(
    id: string,
    patch: { status: DccStatus; error?: string; savedPath?: string },
  ): void;
  /**
   * Records how far a download has got. Moves the row to downloading and fills
   * in the total size when the transfer reports one the advertisement lacked.
   */
  setDccOfferProgress(id: string, received: number, total?: number): void;
  /** Forgets every offer seen so far. */
  clearDccOffers(): void;
  /** Drops everything for a network that has been removed. */
  forgetNetwork(networkId: string): void;
}

/** A stable id for a direct DCC offer, so the same file seen twice is one row. */
function dccOfferId(offer: {
  readonly networkId: string;
  readonly from: string;
  readonly send: DccSend;
}): string {
  const { send } = offer;
  return `${offer.networkId} dcc ${offer.from} ${send.filename} ${send.host}:${send.port} ${send.size ?? ''}`;
}

/** A stable id for an XDCC pack, so a re-listed catalogue is one row per pack. */
function xdccOfferId(offer: {
  readonly networkId: string;
  readonly from: string;
  readonly pack: number;
}): string {
  return `${offer.networkId} xdcc ${offer.from} #${offer.pack}`;
}

export const useView = create<ViewState>((set, get) => ({
  selection: undefined,
  pane: 'chat',
  unread: new Map(),
  drafts: new Map(),
  collapsed: new Set(),
  networkOrder: [],
  sidebarCollapsed: false,
  memberListOpen: true,
  commandBarOpen: false,
  appearance: DEFAULT_APPEARANCE,
  ctcp: DEFAULT_CTCP_POLICY,
  userOptions: DEFAULT_USER_OPTIONS,
  dccActive: true,
  dccOffers: [],

  select(ref) {
    // Selecting a conversation reads it. Anything else means a badge that
    // stays lit while the user is looking straight at the messages.
    get().markRead(ref);
    set({ selection: ref, pane: 'chat' });
  },

  setPane: (pane) => set({ pane }),

  noteActivity(ref, highlight) {
    const { selection, pane } = get();
    const looking =
      pane === 'chat' &&
      selection !== undefined &&
      selection.networkId === ref.networkId &&
      selection.target === ref.target;
    if (looking) {
      return;
    }

    set((current) => {
      const unread = new Map(current.unread);
      const existing = unread.get(keyOf(ref)) ?? { count: 0, highlight: false };
      unread.set(keyOf(ref), {
        count: existing.count + 1,
        highlight: existing.highlight || highlight,
      });
      return { unread };
    });
  },

  markRead(ref) {
    set((current) => {
      if (!current.unread.has(keyOf(ref))) {
        return {};
      }
      const unread = new Map(current.unread);
      unread.delete(keyOf(ref));
      return { unread };
    });
  },

  setDraft(ref, text) {
    set((current) => {
      const drafts = new Map(current.drafts);
      if (text === '') {
        drafts.delete(keyOf(ref));
      } else {
        drafts.set(keyOf(ref), text);
      }
      return { drafts };
    });
  },

  toggleCollapsed(networkId) {
    set((current) => {
      const collapsed = new Set(current.collapsed);
      if (collapsed.has(networkId)) {
        collapsed.delete(networkId);
      } else {
        collapsed.add(networkId);
      }
      return { collapsed };
    });
  },

  reorderNetworks: (order) => set({ networkOrder: [...order] }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setMemberListOpen: (memberListOpen) => set({ memberListOpen }),
  setCommandBarOpen: (commandBarOpen) => set({ commandBarOpen }),

  updateAppearance: (changes) =>
    set((current) => ({ appearance: { ...current.appearance, ...changes } })),

  updateCtcp: (changes) => set((current) => ({ ctcp: { ...current.ctcp, ...changes } })),

  updateUserOptions: (changes) =>
    set((current) => ({ userOptions: { ...current.userOptions, ...changes } })),

  setDccActive: (dccActive) => set({ dccActive }),

  recordDccOffer(offer) {
    const { userOptions, dccActive } = get();
    if (!userOptions.dccMonitorEnabled || !dccActive) {
      return;
    }
    const id = dccOfferId(offer);
    set((current) => {
      // The same file advertised again is the same row, not a new one — some
      // clients re-send the offer every few seconds until it is accepted.
      if (current.dccOffers.some((entry) => entry.id === id)) {
        return {};
      }
      const record: DccOfferRecord = {
        id,
        kind: 'dcc',
        networkId: offer.networkId,
        networkName: offer.networkName,
        from: offer.from,
        target: offer.target,
        filename: offer.send.filename,
        host: offer.send.host,
        port: offer.send.port,
        ...(offer.send.size === undefined ? {} : { size: offer.send.size }),
        passive: offer.send.passive,
        receivedAt: offer.at,
        status: 'available',
      };
      return { dccOffers: [...current.dccOffers, record] };
    });
  },

  recordXdccOffer(offer) {
    const { userOptions, dccActive } = get();
    if (!userOptions.dccMonitorEnabled || !dccActive) {
      return;
    }
    const id = xdccOfferId({ networkId: offer.networkId, from: offer.from, pack: offer.pack.pack });
    set((current) => {
      // A packlist channel re-lists its whole catalogue on a timer, so the same
      // pack arrives again and again; it is one row, refreshed, not a new one.
      const existing = current.dccOffers.find((entry) => entry.id === id);
      if (existing !== undefined) {
        // Only the "gets" count is worth refreshing; leave a download in
        // progress or done exactly as it is.
        if (existing.status === 'available' && existing.gets !== offer.pack.gets) {
          return {
            dccOffers: current.dccOffers.map((entry) =>
              entry.id === id ? { ...entry, gets: offer.pack.gets } : entry,
            ),
          };
        }
        return {};
      }
      const record: DccOfferRecord = {
        id,
        kind: 'xdcc',
        networkId: offer.networkId,
        networkName: offer.networkName,
        from: offer.from,
        target: offer.target,
        filename: offer.pack.filename,
        ...(offer.pack.sizeBytes === undefined ? {} : { size: offer.pack.sizeBytes }),
        passive: false,
        pack: offer.pack.pack,
        gets: offer.pack.gets,
        receivedAt: offer.at,
        status: 'available',
      };
      return { dccOffers: [...current.dccOffers, record] };
    });
  },

  setDccOfferStatus(id, patch) {
    set((current) => ({
      dccOffers: current.dccOffers.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: patch.status,
              ...(patch.error === undefined ? {} : { error: patch.error }),
              ...(patch.savedPath === undefined ? {} : { savedPath: patch.savedPath }),
            }
          : entry,
      ),
    }));
  },

  setDccOfferProgress(id, received, total) {
    set((current) => ({
      dccOffers: current.dccOffers.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: 'downloading',
              received,
              // Fill in a size the advertisement did not carry, so the bar has a
              // denominator; never overwrite one it already had.
              ...(entry.size === undefined && total !== undefined ? { size: total } : {}),
            }
          : entry,
      ),
    }));
  },

  clearDccOffers: () => set({ dccOffers: [] }),

  forgetNetwork(networkId) {
    set((current) => {
      const prefix = `${networkId} `;
      const drop = <T>(map: ReadonlyMap<string, T>): Map<string, T> =>
        new Map([...map].filter(([key]) => !key.startsWith(prefix)));

      const collapsed = new Set(current.collapsed);
      collapsed.delete(networkId);

      return {
        unread: drop(current.unread),
        drafts: drop(current.drafts),
        collapsed,
        networkOrder: current.networkOrder.filter((id) => id !== networkId),
        selection: current.selection?.networkId === networkId ? undefined : current.selection,
        dccOffers: current.dccOffers.filter((entry) => entry.networkId !== networkId),
      };
    });
  },
}));

/** Unread state for a conversation. */
export function unreadFor(state: ViewState, ref: TargetRef): Unread {
  return state.unread.get(keyOf(ref)) ?? { count: 0, highlight: false };
}

/** The draft for a conversation. */
export function draftFor(state: ViewState, ref: TargetRef): string {
  return state.drafts.get(keyOf(ref)) ?? '';
}

/** Whether two references name the same conversation. */
export function sameRef(left: TargetRef | undefined, right: TargetRef | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.networkId === right.networkId && left.target === right.target;
}

/** Networks in the user's order, with any not yet ordered kept at the end. */
export function orderNetworks(ids: readonly string[], order: readonly string[]): readonly string[] {
  const known = order.filter((id) => ids.includes(id));
  return [...known, ...ids.filter((id) => !known.includes(id))];
}

/**
 * Whether a message mentions the user.
 *
 * Matched on a word boundary rather than as a substring: somebody saying
 * "marmots" should not light up a notification for `marmot`.
 */
export function isHighlight(text: string, nick: string, extraWords: readonly string[]): boolean {
  const words = [nick, ...extraWords].filter((word) => word !== '');
  if (words.length === 0) {
    return false;
  }
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // A nick can contain characters `\b` does not treat as word characters, so
  // the boundary is spelled out as "not adjacent to a nick character".
  const pattern = new RegExp(
    `(^|[^\\w[\\]\\\\\`^{|}-])(${escaped.join('|')})($|[^\\w[\\]\\\\\`^{|}-])`,
    'i',
  );
  return pattern.test(text);
}
