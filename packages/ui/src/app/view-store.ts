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
  type XdccResponse,
} from '@marmotter/protocol';
import { defaultLoggingPolicy, type LoggingPolicy } from '@marmotter/shared';
import { DEFAULT_THEME, type ThemeId } from '../themes.js';
import { create } from 'zustand';

/** A conversation the interface can be showing. */
export interface TargetRef {
  readonly networkId: string;
  /** Channel or nick. Undefined means the network's own server tab. */
  readonly target: string | undefined;
}

export type Pane =
  | 'chat'
  | 'raw-log'
  | 'settings'
  | 'channel-browser'
  | 'people'
  | 'account'
  | 'dcc'
  /** Searching what has been written to disk, rather than what is in memory. */
  | 'log-search';

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
 * Whether the user has acted on this row, rather than merely been shown it.
 *
 * A packlist channel offers thousands of files and only a handful are ever
 * asked for, so the ones that were are pinned above the catalogue instead of
 * being left to scroll away among everything the monitor happened to see.
 */
export function isTrackedTransfer(status: DccStatus): boolean {
  return status !== 'available';
}

/**
 * Whether a transfer is actually running and would be lost if its row went away.
 *
 * Clearing the list keeps these: dropping the row of a file that is still
 * arriving would leave it downloading with nothing to show it, and no way to
 * stop it.
 *
 * `requested` is deliberately **not** one of them. Nothing is running there —
 * an XDCC request is a message sent to a bot that may never answer — and
 * treating it as in flight made a request that went unanswered impossible to
 * clear: the row pinned itself to the top of the list with no control on it and
 * survived every Clear.
 */
export function isTransferInFlight(status: DccStatus): boolean {
  return status === 'downloading';
}

/**
 * Whether two advertised names are the same file.
 *
 * A serving bot does not always send back the name it advertised: spaces become
 * underscores, dots become spaces, case wanders. Comparing only the letters and
 * digits matches the file through all of that, and is still strict enough that
 * two different episodes never collide.
 */
export function sameFilename(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const reduce = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const left = reduce(a);
  return left !== '' && left === reduce(b);
}

/**
 * Which queued XDCC request a `DCC SEND` is answering, if any.
 *
 * A bot sends a queue in whatever order suits it, re-offers a pack every few
 * seconds until somebody connects, and may answer a request minutes after the
 * next one was made. Taking the front of the queue for each offer therefore
 * went wrong in three ways at once: the wrong row downloaded, a re-offer ate
 * a request that had not been answered yet, and once the queue had been eaten
 * the remaining answers matched nothing at all and were dropped in silence —
 * a bot announcing it was ready to send while nothing ever connected.
 *
 * So the filename decides. `queue` is the ids of this bot's outstanding
 * requests, `rows` the monitor's rows for that same bot, and the answer is the
 * queued row this offer names. Falling back to the head of the queue is kept
 * for a name that matches nothing on the list — a bot that renamed the file
 * beyond recognition — but not for one that matches a row outside the queue,
 * where the row itself is the better answer.
 */
export function matchPendingRequest(
  queue: readonly string[],
  rows: readonly Pick<DccOfferRecord, 'id' | 'filename'>[],
  filename: string,
): string | undefined {
  const named = queue.find((id) =>
    rows.some((row) => row.id === id && sameFilename(row.filename, filename)),
  );
  if (named !== undefined) {
    return named;
  }
  if (rows.some((row) => sameFilename(row.filename, filename))) {
    return undefined;
  }
  return queue[0];
}

/**
 * What to do with a `DCC SEND` that did not answer a request still waiting in
 * the queue but does match a file already on the list.
 *
 * `retry` — the row is waiting to be sent or its last attempt failed, and this
 * is the serving bot's own offer of it: connect, at the address this offer
 * carries. Serving bots re-send every few seconds precisely because the first
 * connection often races their listening socket and is refused, and a row left
 * at `requested` is exactly the row a late answer belongs to.
 *
 * `refuse` — the same, but the offer is a passive one the monitor cannot fetch:
 * the row is failed with a reason rather than left waiting on a transfer that
 * will never start.
 *
 * `ignore` — a duplicate of a row that is mid-transfer, already saved, or
 * sitting there waiting for the user to start it; nothing to do.
 *
 * `record` — no such row: a genuinely new, unsolicited offer to list.
 */
export type DccReofferAction = 'retry' | 'refuse' | 'ignore' | 'record';

/**
 * Decides how an incoming `DCC SEND` relates to the file monitor's rows.
 *
 * Pure so the matching rule can be reasoned about on its own: it is the one bit
 * of the download flow where a wrong call either drops a file the user asked
 * for or piles up duplicate rows. `existing` is the row that already matches the
 * offer's sender and filename, if any.
 */
export function classifyDccReoffer(
  existing: Pick<DccOfferRecord, 'status'> | undefined,
  send: { readonly passive: boolean },
): DccReofferAction {
  if (existing === undefined) {
    return 'record';
  }
  if (existing.status === 'failed' || existing.status === 'requested') {
    return send.passive ? 'refuse' : 'retry';
  }
  return 'ignore';
}

/**
 * Which connected network an `irc://` link is pointing at.
 *
 * A pasted request carries the server it came from, and the person pasting it
 * is usually connected to several. Matching the link to a network rather than
 * assuming the one on screen is what stops a request going to a bot on the
 * wrong network, where the nick means somebody else entirely.
 *
 * Exact host first, then either name being a suffix of the other, so a link to
 * `abc.xyz` finds the profile connected to `irc.abc.xyz` — the same server
 * under the name the round-robin answers to. Generic over the profile so this
 * stays a pure comparison with nothing imported to test it against.
 */
export function networkForHost<
  P extends { readonly servers: readonly { readonly host: string }[] },
>(profiles: ReadonlyMap<string, P>, host: string): string | undefined {
  const wanted = host.trim().toLowerCase();
  if (wanted === '') {
    return undefined;
  }
  const hosts = (profile: P): string[] =>
    profile.servers.map((server) => server.host.toLowerCase());

  for (const [id, profile] of profiles) {
    if (hosts(profile).includes(wanted)) {
      return id;
    }
  }
  for (const [id, profile] of profiles) {
    if (
      hosts(profile).some((known) => known.endsWith(`.${wanted}`) || wanted.endsWith(`.${known}`))
    ) {
      return id;
    }
  }
  return undefined;
}

/**
 * What a bot's answer to a pack request means for the row that is waiting.
 *
 * Pure, and separate from the event plumbing, because this is the whole of the
 * translation the client exists to do: a bot says "** XDCC SEND denied, you
 * must be on a known channel", and the row has to say what to do about it in
 * words that assume nothing. The `settled` flag is the other half — a refusal
 * ends the wait, a queue position does not, and getting that backwards either
 * strands a request or discards one that was still coming.
 */
export interface XdccResponseOutcome {
  readonly status: DccStatus;
  /** A short line under a row still waiting, e.g. `Queued, position 4`. */
  readonly note?: string;
  /** Why it will not arrive, when it will not. */
  readonly error?: string;
  /** Whether the request should stop being waited on. */
  readonly settled: boolean;
  /**
   * Whether the bot now holds a transfer for us rather than a queue place.
   *
   * The two are undone by different commands — a queue place by `XDCC REMOVE`,
   * a transfer the bot has opened by `XDCC CANCEL` — and sending the wrong one
   * leaves the bot holding a slot it will not free until its own timeout, which
   * is what makes the next request bounce.
   */
  readonly awaitingTransfer?: boolean;
}

/**
 * Turns a serving bot's notice into the state of the row that asked for it.
 *
 * Two of the answers deliberately leave the row waiting. A queue position is
 * good news — the request was taken — and "you already have that queued" means
 * the same thing said less kindly: in both cases the file is still coming, and
 * failing the row would throw away a request the bot is still holding.
 */
export function applyXdccResponse(response: XdccResponse): XdccResponseOutcome {
  switch (response.kind) {
    case 'sending':
      return {
        status: 'requested',
        note: 'The bot is starting the transfer.',
        settled: false,
        awaitingTransfer: true,
      };

    case 'awaiting-connection':
      return {
        status: 'requested',
        note: 'The bot is waiting for Marmotter to connect.',
        settled: false,
        awaitingTransfer: true,
      };

    case 'queued': {
      const place =
        response.position === undefined
          ? 'Waiting in the queue'
          : `Queued, position ${response.position}`;
      const wait = response.waitText === undefined ? '' : ` · about ${response.waitText}`;
      return { status: 'requested', note: `${place}${wait}.`, settled: false };
    }

    case 'dequeued':
      return {
        status: 'failed',
        error: 'The bot dropped this from its queue.',
        settled: true,
      };

    case 'denied':
      switch (response.reason) {
        case 'already-queued':
          return {
            status: 'requested',
            note: "Already in the bot's queue.",
            settled: false,
          };
        case 'not-in-channel':
          return {
            status: 'failed',
            error: "Join one of the bot's channels first — it only sends files to people there.",
            settled: true,
          };
        case 'slots-full':
          return {
            status: 'failed',
            error: "The bot's queue is full. Try again in a few minutes.",
            settled: true,
          };
        case 'transfer-limit':
          return {
            status: 'failed',
            error: 'The bot allows you only so many downloads at once. Finish one and ask again.',
            settled: true,
          };
        case 'no-such-pack':
          return {
            status: 'failed',
            error: "The bot doesn't have that file any more.",
            settled: true,
          };
        case 'dcc-timeout':
          return {
            status: 'failed',
            // Not a refusal: the bot opened the transfer and nothing arrived.
            // What sits between the two machines is the thing to look at, so
            // the message says that rather than blaming the bot.
            error:
              "Marmotter couldn't reach the bot's transfer before it gave up. A firewall or router between you may be blocking it.",
            settled: true,
          };
        case 'closed':
          return {
            status: 'failed',
            error: "The bot isn't taking requests at the moment.",
            settled: true,
          };
        default:
          return { status: 'failed', error: 'The bot turned down the request.', settled: true };
      }
  }
}

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
  /**
   * What the bot last said about a request still waiting, in plain words.
   *
   * Separate from `error` because it is not one: a queue position is the row
   * working as intended, and the two read differently for that reason.
   */
  readonly note?: string;
  /**
   * Whether the bot is holding an open transfer for this row rather than a
   * queue place, which decides how the request is withdrawn.
   */
  readonly awaitingTransfer?: boolean;
  /** Where the file was written, once it was. */
  readonly savedPath?: string;
  /** Bytes received so far, while a download is in flight. */
  readonly received?: number;
  /** A passive (reverse) DCC offer, which the receive-only monitor cannot fetch. */
  readonly passive: boolean;
  /**
   * The token from a passive offer, which the reply has to carry back.
   *
   * It is how the sender ties our answer to the offer it made, so a row that
   * lost it could be shown but never accepted.
   */
  readonly token?: string;
  /** Whether the transfer's socket is TLS, from an `SSEND` offer. */
  readonly secure?: boolean;
  /** Whether the sender streams without waiting to be acknowledged (`TSEND`). */
  readonly turbo?: boolean;
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
  /**
   * The address to give a sender for a reverse transfer, where it must be said
   * rather than worked out.
   *
   * A reverse transfer is one Marmotter listens for, so the sender is told
   * where to dial. The shell reads that off the route to the sender, which is
   * right on a machine with its own public address and wrong behind a router —
   * there the address that reaches you is the router's, and only the person
   * running it knows it. Undefined means "use whatever the shell worked out",
   * which is the common case.
   */
  readonly dccAddress: string | undefined;
  /**
   * How long a notice at the bottom of the screen stays, in seconds.
   *
   * Reading speed is not a thing the interface can guess, and the same ten
   * seconds is too long for somebody who has read the message already and too
   * short for somebody who has not. Clamped where it is set rather than trusted
   * from storage.
   */
  readonly toastSeconds: number;
}

/** The bounds on the notice timeout: long enough to read, short enough to end. */
export const TOAST_SECONDS_RANGE = { min: 2, max: 60, default: 10 } as const;

/** Holds a chosen timeout inside the range, whatever it arrived as. */
export function clampToastSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return TOAST_SECONDS_RANGE.default;
  }
  return Math.min(TOAST_SECONDS_RANGE.max, Math.max(TOAST_SECONDS_RANGE.min, Math.round(seconds)));
}

export const DEFAULT_USER_OPTIONS: UserOptions = {
  dccMonitorEnabled: false,
  downloadFolder: undefined,
  dccAddress: undefined,
  toastSeconds: TOAST_SECONDS_RANGE.default,
};

/**
 * The logging policy every network follows unless it says otherwise.
 *
 * Interface state rather than network state, and the same shape as a network's
 * own override so the two merge without translation. Off, like the per-network
 * default — CLAUDE.md makes switching it on an explicit, informed choice.
 */
export const DEFAULT_LOGGING = defaultLoggingPolicy;

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
  /**
   * Which set of colours the window is drawn in.
   *
   * The whole of it is a swap of the primitives in tokens.css, so this is one
   * attribute on the root element and nothing else — no per-component branch,
   * and no second palette to keep in step.
   */
  readonly theme: ThemeId;
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
  /**
   * Puts the two side-panel controls against the edges of the conversation
   * rather than at the ends of the bottom bar.
   *
   * Phone widths only — every wider layout has both panels on screen or in the
   * nav bar. The bar is the default because that is where a thumb already is
   * and it costs the conversation nothing; the edges are larger targets, and
   * sit beside the panel each one opens.
   */
  readonly sidePanelsAtEdges: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: DEFAULT_THEME,
  nickColumnWidth: 12,
  alignNicksRight: true,
  foldEvents: true,
  showTimestamps: true,
  unfurlLinks: false,
  highlightWords: [],
  notificationsEnabled: true,
  showBrowseChannelsShortcut: true,
  sidePanelsAtEdges: false,
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
  /** The logging policy networks follow unless they carry their own. */
  readonly logging: LoggingPolicy;
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
  updateLogging(changes: Partial<LoggingPolicy>): void;
  /**
   * Puts every setting back the way it shipped.
   *
   * Settings only. Networks, the saved name, and anything already written to
   * disk are somebody's data rather than a preference, and a button labelled
   * "reset settings" must not quietly take them.
   */
  resetSettings(): void;
  /** Applies settings read from disk, wholesale, at startup. */
  applySettings(settings: {
    appearance: Appearance;
    ctcp: CtcpPolicy;
    userOptions: UserOptions;
    logging: LoggingPolicy;
  }): void;
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
  /**
   * Updates a single offer's transfer state.
   *
   * `note` is replaced on every call rather than merged: it says what the row
   * is waiting on now, so a queue position from a minute ago must not survive
   * the state that made it true.
   */
  /**
   * Lists a pack somebody asked for by hand — pasted from an index site rather
   * than seen advertised — and returns the row's id.
   *
   * Returns the id of the row already listing that pack where there is one, so
   * pasting a request for a file the bot has advertised acts on the row that is
   * already there. Undefined when the monitor is off, like the other two.
   */
  recordXdccRequest(request: {
    readonly networkId: string;
    readonly networkName: string;
    readonly from: string;
    readonly pack: number;
    readonly at: number;
  }): string | undefined;
  /**
   * Lists an offer that arrived in a shape Marmotter could not read.
   *
   * Shown as a failed row carrying the raw line, because the alternative is
   * silence: somebody who asked a bot for a file and got nothing cannot
   * otherwise tell a bot that never answered from an answer this client did not
   * understand, and the second is the one worth reporting.
   */
  recordUnreadableOffer(offer: {
    readonly networkId: string;
    readonly networkName: string;
    readonly from: string;
    readonly target: string;
    readonly params: string;
    readonly at: number;
  }): void;
  setDccOfferStatus(
    id: string,
    patch: {
      status: DccStatus;
      error?: string;
      savedPath?: string;
      note?: string;
      filename?: string;
      awaitingTransfer?: boolean;
    },
  ): void;
  /**
   * Records how far a download has got. Moves the row to downloading and fills
   * in the total size when the transfer reports one the advertisement lacked.
   */
  setDccOfferProgress(id: string, received: number, total?: number): void;
  /**
   * Resets the list: forgets the whole observed catalogue along with the
   * transfers that have finished, failed, or been saved.
   *
   * Transfers still running are kept, since they are the one thing that cannot
   * be recovered by waiting for the next advertisement — the row is what shows
   * the progress and carries the button that stops it.
   */
  clearDccOffers(): void;
  /**
   * Drops one row, whatever state it is in.
   *
   * The escape hatch for a row nothing else can shift — a pack a bot never
   * answered, a transfer that failed in a way the retry cannot see past. The
   * caller is responsible for stopping anything still running first; the store
   * only knows about the row.
   */
  removeDccOffer(id: string): void;
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
  logging: DEFAULT_LOGGING,
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

  updateLogging: (changes) => set((current) => ({ logging: { ...current.logging, ...changes } })),

  resetSettings: () =>
    set({
      appearance: DEFAULT_APPEARANCE,
      ctcp: DEFAULT_CTCP_POLICY,
      userOptions: DEFAULT_USER_OPTIONS,
      logging: DEFAULT_LOGGING,
    }),

  applySettings: (settings) =>
    set({
      appearance: settings.appearance,
      ctcp: settings.ctcp,
      userOptions: settings.userOptions,
      logging: settings.logging,
    }),

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
        ...(offer.send.token === undefined ? {} : { token: offer.send.token }),
        ...(offer.send.secure ? { secure: true } : {}),
        ...(offer.send.turbo ? { turbo: true } : {}),
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

  recordXdccRequest(request) {
    const { userOptions, dccActive } = get();
    if (!userOptions.dccMonitorEnabled || !dccActive) {
      return undefined;
    }
    const id = xdccOfferId(request);
    const existing = get().dccOffers.find((entry) => entry.id === id);
    if (existing !== undefined) {
      return id;
    }
    // No advertisement to take a name or a size from — the whole point of a
    // pasted request is that the catalogue line was read somewhere else. The
    // pack number stands in until the bot answers with the real name, which is
    // what the download then fills in.
    const record: DccOfferRecord = {
      id,
      kind: 'xdcc',
      networkId: request.networkId,
      networkName: request.networkName,
      from: request.from,
      target: request.from,
      filename: `Pack #${request.pack}`,
      passive: false,
      pack: request.pack,
      receivedAt: request.at,
      status: 'available',
    };
    set((current) => ({ dccOffers: [...current.dccOffers, record] }));
    return id;
  },

  recordUnreadableOffer(offer) {
    const { userOptions, dccActive } = get();
    if (!userOptions.dccMonitorEnabled || !dccActive) {
      return;
    }
    const id = `${offer.networkId} unreadable ${offer.from} ${offer.params}`;
    set((current) => {
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
        // The raw parameters stand in for a name, since reading one out of them
        // is the very thing that failed. It is also exactly what a bug report
        // needs, sitting where the person is already looking.
        filename: offer.params,
        passive: false,
        receivedAt: offer.at,
        status: 'failed',
        error: "Marmotter couldn't read this offer. The raw line is in the network's raw log.",
      };
      return { dccOffers: [...current.dccOffers, record] };
    });
  },

  setDccOfferStatus(id, patch) {
    set((current) => ({
      dccOffers: current.dccOffers.map((entry) => {
        if (entry.id !== id) {
          return entry;
        }
        // The old note is dropped rather than merged: it described the state
        // this call is replacing, and a stale "position 4" under a failed row
        // would contradict the reason beside it.
        const { note: _previous, awaitingTransfer: _held, ...rest } = entry;
        return {
          ...rest,
          status: patch.status,
          ...(patch.error === undefined ? {} : { error: patch.error }),
          ...(patch.savedPath === undefined ? {} : { savedPath: patch.savedPath }),
          ...(patch.note === undefined ? {} : { note: patch.note }),
          // A bot does not always send back the name it advertised, and a row
          // asked for by pack number has no name at all until it does.
          ...(patch.filename === undefined ? {} : { filename: patch.filename }),
          ...(patch.awaitingTransfer === undefined
            ? {}
            : { awaitingTransfer: patch.awaitingTransfer }),
        };
      }),
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

  clearDccOffers: () =>
    set((current) => ({
      dccOffers: current.dccOffers.filter((entry) => isTransferInFlight(entry.status)),
    })),

  removeDccOffer: (id) =>
    set((current) => ({ dccOffers: current.dccOffers.filter((entry) => entry.id !== id) })),

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

/**
 * Everything in the view state except the list of offered files.
 *
 * The shell subscribes through this rather than to the whole store, and the two
 * places that show offers subscribe to `dccOffers` themselves. The list is by
 * far the busiest thing in here: a serving bot re-lists a catalogue of thousands
 * of packs on a timer, and a download reports progress every megabyte. Read
 * whole, each of those was a render of the entire client — sidebar, message
 * list, member list and all — which is what made switching screens crawl while
 * anything was downloading.
 *
 * Paired with zustand's `useShallow`, so the comparison is over the fields
 * rather than the object this rebuilds on each read.
 */
export type ViewWithoutOffers = Omit<ViewState, 'dccOffers'>;

/** Selects {@link ViewWithoutOffers}. Hoisted so it is one stable function. */
export function selectViewWithoutOffers(state: ViewState): ViewWithoutOffers {
  const { dccOffers: _offers, ...rest } = state;
  return rest;
}

/**
 * Unread state for a conversation.
 *
 * Takes only the field it reads, so a component holding a narrowed slice of the
 * store — as the shell does, to stay out of the offer list's way — can call it.
 */
export function unreadFor(state: Pick<ViewState, 'unread'>, ref: TargetRef): Unread {
  return state.unread.get(keyOf(ref)) ?? { count: 0, highlight: false };
}

/** The draft for a conversation. Narrowed for the same reason as `unreadFor`. */
export function draftFor(state: Pick<ViewState, 'drafts'>, ref: TargetRef): string {
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
