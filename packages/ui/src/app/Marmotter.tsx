import {
  CHANNEL_LIST_LIMIT,
  createReconnectingTransport,
  type Member,
  type NetworkState,
  type Session,
  type SessionOptions,
  connectErrorReason,
  createSession,
  requestOlder,
  useNetworks,
} from '@marmotter/client';
import {
  fold,
  isChannel,
  type DccSend,
  type SuggestedAction,
  type XdccPack,
  type XdccResponse,
  parseXdccRequest,
} from '@marmotter/protocol';
import type { CloseReason } from '@marmotter/shared';
import { effectivePolicy, retentionCutoff } from '@marmotter/client';
import {
  EMPTY_IDENTITY,
  type DefaultIdentity,
  type LogLocation,
  type LogStore,
  type LoggingPolicy,
  type NetworkProfile,
  type PreferenceStore,
  type SecretStore,
  type StoredPreferences,
  secretRefsOf,
  type Transport,
} from '@marmotter/shared';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TabBar } from '../layout/TabBar.js';
import { NavBar } from '../layout/NavBar.js';
import { TitleBar, type TitleBarProps } from '../layout/TitleBar.js';
import { WindowResizeHandles, type WindowEdge } from '../layout/WindowResizeHandles.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { IconButton } from '../primitives/IconButton.js';
import { Modal } from '../primitives/Modal.js';
import { ToastRegion, type ToastMessage } from '../primitives/Toast.js';
import { foldNotice, shouldAnnounceDownload, type Notice, type ShellNotice } from './notices.js';
import { AccountMenu } from './AccountMenu.js';
import { AccountPanel } from './AccountPanel.js';
import { AddNetwork } from './AddNetwork.js';
import { AppShell, useBreakpoint } from './AppShell.js';
import { ChannelBrowser } from './ChannelBrowser.js';
import { ChannelPanel, type TabValue as ChannelPanelTab } from './ChannelPanel.js';
import { Composer } from './Composer.js';
import { DccBrowser, type DccBrowserProps } from './DccBrowser.js';
import { DccMonitorPanel } from './DccMonitorPanel.js';
import type { DccCapability } from './dcc.js';
import { InviteBanner } from './Invites.js';
import { Launch } from './Launch.js';
import { connectionStatus, connectionStatusText } from './network-status.js';
import { CreateChannel, createChannelLines } from './CreateChannel.js';
import { ListPrompt } from './ListPrompt.js';
import { describeWait, listReadiness } from './list-guard.js';
import { readSecret } from './secrets.js';
import { BanDialog, KickDialog } from './MemberDialogs.js';
import { MemberList } from './MemberList.js';
import { MessageList } from './MessageList.js';
import {
  MessageSearchBar,
  MessageSearchResults,
  findMatches,
  type SearchScope,
} from './MessageSearch.js';
import { RawLog } from './RawLog.js';
import { PeoplePanel } from './PeoplePanel.js';
import { Settings } from './Settings.js';
import { LogSearch } from './LogSearch.js';
import { readStoredSettings, writeStoredSettings } from './stored-settings.js';
import { ExportConfig, ImportConfig } from './ConfigTransfer.js';
import { APP_VERSION } from './version.js';
import {
  buildConfig,
  serializeConfig,
  type ConfigImport,
  type DevicePaths,
} from './config-transfer.js';
import { FirstRun } from './FirstRun.js';
import { useMessageLogging, usePurge } from './logging.js';
import {
  type ServiceName,
  serviceCommandBody,
  serviceCommandLabel,
  serviceCommands,
  serviceDisplayName,
  serviceForTarget,
} from './service-commands.js';
import { Sidebar } from './Sidebar.js';
import { TextPrompt } from './TextPrompt.js';
import { WhoisCard } from './WhoisCard.js';
import { parseInput } from './commands.js';
import { isAutojoined, toggleAutojoin } from './autojoin.js';
import {
  canModerateChannel,
  memberActions,
  nickActions,
  type MemberActionCallbacks,
} from './member-actions.js';
import {
  type Notifier,
  buildNotification,
  createWebNotifier,
  shouldNotify,
  windowIsFocused,
} from './notify.js';
import { ContextMenu, type MenuItem } from '../primitives/ContextMenu.js';
import {
  DEFAULT_LOGGING,
  type DccOfferRecord,
  type TargetRef,
  applyXdccResponse,
  classifyDccReoffer,
  matchPendingRequest,
  networkForHost,
  sameFilename,
  draftFor,
  isTransferInFlight,
  isHighlight,
  orderNetworks,
  sameRef,
  selectViewWithoutOffers,
  unreadFor,
  useView,
} from './view-store.js';
import { useShallow } from 'zustand/react/shallow';

/**
 * The ceiling on one export.
 *
 * An export reads every matching line into memory to write it out, so it has to
 * have one. High enough that an ordinary person exports everything they have;
 * the number is stated in the file when it bites.
 */
const EXPORT_LIMIT = 1_000_000;

/**
 * What to say when a connection has gone and retrying has not brought it back.
 *
 * Names what happened and what to do, per CLAUDE.md's copy rules, and never
 * apologises. The reasons are told apart because the answers differ: a network
 * that refused us is not the same problem as a laptop with no wifi, and telling
 * somebody to check their connection when the server rejected them wastes their
 * time.
 */
export function lostConnectionText(name: string, reason: CloseReason): string {
  switch (reason.kind) {
    case 'timeout':
      return `${name} did not respond. It may be down, or the address may have changed.`;
    case 'server':
      return `${name} closed the connection and did not accept a new one.`;
    case 'tls-error':
      return `Could not verify ${name}'s certificate, so the connection was not made.`;
    case 'network-error':
      return reason.message === ''
        ? `Lost the connection to ${name}. Check your internet connection.`
        : `Lost the connection to ${name}. ${reason.message}`;
    case 'user':
      return `Disconnected from ${name}.`;
  }
}

/**
 * Whether to put the setup screen in front of somebody on launch.
 *
 * Two conditions, and the second is the one that is easy to lose. There has to
 * be no name yet — and there has to be somewhere to keep the answer. A platform
 * with no preference store, which is the browser build, would otherwise show
 * the same modal on every page load forever and never remember what was typed.
 * Asking a question you will ask again in thirty seconds is worse than not
 * asking; the name is entered on the "Add a network" form there instead, which
 * is the path Skip already relies on.
 *
 * Pure and exported because losing this is invisible in every unit test and
 * shows up only as a modal nobody can dismiss for good.
 */
export function shouldAskForIdentity(identity: DefaultIdentity, canRemember: boolean): boolean {
  return identity.nick === '' && canRemember;
}

/**
 * Saving and opening one settings file, through the platform's file dialogs.
 *
 * Injected like every other capability, and optional like the ones a platform
 * may not have. `save` and `open` both resolve to undefined when the user
 * cancels, which is not an error and must not be reported as one.
 */
export interface ConfigFileAccess {
  /** Writes the text where the user chooses, resolving to the path written. */
  save(suggestedName: string, text: string): Promise<string | undefined>;
  /** Reads a file the user chooses, resolving to its text. */
  open(): Promise<string | undefined>;
}

export interface MarmotterProps {
  /**
   * Builds a transport for a profile.
   *
   * The one thing that genuinely differs between desktop and web. Everything
   * else in this component is shared, which is what keeps the two builds from
   * drifting apart.
   */
  readonly createTransport: (profile: NetworkProfile) => Transport;
  /** Reads secrets from the platform's store, where it has one. */
  readonly resolveSecret?: SessionOptions['resolveSecret'];
  /**
   * Whether this platform keeps anything between sessions.
   *
   * False on web, and not negotiable there: no profile, no scrollback, and no
   * message content survives the tab.
   */
  readonly persists?: boolean;
  /**
   * How the platform raises a notification.
   *
   * Desktop passes a Tauri-backed one, because WebView2 has no web
   * Notification API and the browser fallback would do nothing on Windows.
   */
  readonly notifier?: Notifier;
  /**
   * The DCC file monitor's platform hooks: a folder picker and a downloader.
   *
   * Desktop passes a Tauri-backed one; web passes nothing, and the whole file
   * monitor is absent there — a browser tab has no folder to write to and
   * cannot open an arbitrary TCP connection to fetch a file.
   */
  readonly dcc?: DccCapability;
  /**
   * Opens a link in the platform's own browser.
   *
   * Desktop passes a Tauri-backed one, because the app's own webview cannot
   * navigate to an arbitrary page and would simply fail to open it. Web passes
   * nothing and the shell falls back to a new tab, which is what a browser does
   * with a link anyway.
   */
  readonly openExternal?: (url: string) => void;
  /**
   * Builds the store conversations are written to.
   *
   * Desktop passes a factory; **web passes nothing, and must keep passing
   * nothing**. There being no implementation is what guarantees the browser
   * build cannot persist message content — see CLAUDE.md and
   * `packages/shared/src/logging.ts`.
   *
   * A factory rather than a store, because the format and the folder are the
   * user's to change and each answer is a different store. Rebuilt when either
   * moves; the lines already written stay where they were written.
   */
  readonly createLogStore?: (options: {
    readonly policy: LoggingPolicy;
    /** Maps a network's display name back to its ID, for plaintext logs. */
    readonly networkIdFor: (networkName: string) => string;
  }) => Promise<LogStore>;
  /** Opens the platform folder picker for where logs are written. */
  readonly chooseLogFolder?: () => Promise<string | undefined>;
  /** Opens the platform save dialog for an export, returning the chosen path. */
  readonly chooseExportFile?: () => Promise<string | undefined>;
  /**
   * Saving and opening a settings file, where the platform has file dialogs.
   *
   * Desktop passes one. Android and web pass nothing, and there the settings
   * move as text on the clipboard — which every platform can do, and which is
   * why the file is the extra rather than the feature.
   */
  readonly configFile?: ConfigFileAccess;
  /**
   * Where settings are kept between launches.
   *
   * Desktop passes a file-backed one. Web passes nothing and the identity given
   * at first run lives in memory for the session — which still saves typing
   * across several networks added in one sitting, and keeps nothing after the
   * tab closes.
   */
  readonly preferences?: PreferenceStore;
  /**
   * Where passwords are kept between launches.
   *
   * Desktop passes one backed by the OS keychain. **Web passes nothing**, and a
   * password typed there lives in memory for the session — the only honest
   * option, since a browser has nowhere to put a secret that a page cannot also
   * read.
   */
  readonly secrets?: SecretStore;
  /**
   * The window this is running in, for a build that draws its own chrome.
   *
   * Desktop passes what the shell knows about the window and the shell draws
   * the bar, rather than passing a finished bar: the app's own controls live
   * in it — settings, today — and those belong here, not to the platform
   * layer. Web passes nothing and there is no bar.
   */
  readonly windowChrome?: Omit<TitleBarProps, 'leading' | 'trailing'>;
  /**
   * Begins resizing the window from one of its edges.
   *
   * Passed by a build that draws its own window frame: with the OS's
   * decorations off there is no resize border, so the shell draws grips along
   * its own edges and hands the drag back here. Web passes nothing and none are
   * drawn.
   */
  readonly resizeWindow?: (edge: WindowEdge) => void;
  /**
   * Told how many networks are currently connected, whenever that changes.
   *
   * Android passes one: a phone will stop a backgrounded process holding open
   * sockets unless the app is running a foreground service, so the shell has to
   * say when there is a connection worth keeping alive and when there is not.
   * Desktop and web pass nothing — neither platform kills an app for having a
   * socket open, and a phone is the only one where staying connected has to be
   * declared.
   */
  readonly onConnectionsChanged?: (connected: number) => void;
}

/** The whole client. */
export function Marmotter({
  createTransport,
  resolveSecret,
  persists = false,
  notifier,
  dcc,
  openExternal,
  createLogStore,
  chooseLogFolder,
  chooseExportFile,
  configFile,
  preferences,
  secrets,
  windowChrome,
  resizeWindow,
  onConnectionsChanged,
}: MarmotterProps): ReactNode {
  const registry = useNetworks();
  // Deliberately not `useView()`: that subscribes to every field, and the list
  // of offered files changes on every catalogue line a serving bot posts and
  // every megabyte of every download. Reading it here made each of those a
  // render of the whole client. The two places that show offers subscribe to
  // them on their own, below.
  const view = useView(useShallow(selectViewWithoutOffers));
  const breakpoint = useBreakpoint();
  /**
   * How many transfers are running, for the badge on the phone's Files tab.
   *
   * A count rather than the offers themselves, deliberately: the note above
   * about not subscribing to `dccOffers` here is about re-rendering the whole
   * client on every megabyte, and a number that only changes when a transfer
   * starts or stops does not do that.
   */
  const activeTransfers = useView((state) => {
    let count = 0;
    for (const offer of state.dccOffers) {
      if (isTransferInFlight(offer.status)) {
        count += 1;
      }
    }
    return count;
  });

  const [adding, setAdding] = useState(false);
  const [exportingConfig, setExportingConfig] = useState(false);
  const [importingConfig, setImportingConfig] = useState(false);
  /** The network whose saved settings are open for changing, if any. */
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  /** The network a channel is being created on, if the form is open. */
  const [creatingOn, setCreatingOn] = useState<string | undefined>(undefined);
  /** The network waiting to be asked for its channel list, and with what. */
  const [listing, setListing] = useState<{ networkId: string; pattern: string } | undefined>(
    undefined,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toasts, setToasts] = useState<readonly ShellNotice[]>([]);
  /**
   * Whether the launch screen is in front of everything.
   *
   * Opened on a launch that restored networks, which is every launch after the
   * first, and closed for good once somebody has either connected or waved it
   * away. Not shown on a fresh install: there is nothing to pick from, and the
   * screen behind it already says to add a network.
   */
  const [launchOpen, setLaunchOpen] = useState(false);
  /** A network waiting for a channel name from the "Join a channel" prompt. */
  const [joiningNetwork, setJoiningNetwork] = useState<string | undefined>(undefined);
  /** A channel that turned a join down for want of a password, pending one. */
  const [channelKeyFor, setChannelKeyFor] = useState<
    { readonly networkId: string; readonly channel: string } | undefined
  >(undefined);
  /** Whose profile card is open, if any. */
  const [profileNick, setProfileNick] = useState<string | undefined>(undefined);
  /**
   * A name right-clicked in the message list, and where.
   *
   * Held here rather than in the row it opened from: the list is virtualized,
   * so scrolling unmounts that row and would take the menu with it.
   */
  const [nickMenu, setNickMenu] = useState<
    { readonly nick: string; readonly x: number; readonly y: number } | undefined
  >(undefined);
  /** Whether the channel settings and moderation sheet is open. */
  const [channelPanelOpen, setChannelPanelOpen] = useState(false);
  /** Which tab the channel panel opens on, when something opened it at one. */
  const [channelPanelTab, setChannelPanelTab] = useState<ChannelPanelTab>('settings');
  /** Somebody a server operator has chosen to disconnect, pending a reason. */
  const [killing, setKilling] = useState<Member | undefined>(undefined);
  /** Where the logs are and what they cost, once the store has been asked. */
  const [logLocation, setLogLocation] = useState<LogLocation | undefined>(undefined);
  /** The store itself, rebuilt when the format or the folder changes. */
  const [logs, setLogs] = useState<LogStore | undefined>(undefined);
  /**
   * The name and fallbacks given at first run.
   *
   * Held here rather than in the view store because it is the one piece of
   * interface state a platform may persist, and the store's own comment says
   * nothing in it is worth persisting. Undefined means "not yet loaded", which
   * is different from "loaded and empty" — the setup screen must not flash up
   * before the file has been read.
   */
  const [identity, setIdentity] = useState<DefaultIdentity | undefined>(undefined);
  /** Whether the setup screen is open, either at first run or from Settings. */
  const [settingUp, setSettingUp] = useState(false);
  /**
   * The identity and the session builder, reachable from effects that run once.
   *
   * Both change as the component renders; the restore effect and the save path
   * must see the current one without being rebuilt, since rebuilding either
   * would re-register profiles over live sessions.
   */
  const identityRef = useRef<DefaultIdentity | undefined>(undefined);
  /** Whether this machine has a keychain, so the password field can say so. */
  const [remembersPasswords, setRemembersPasswords] = useState(false);
  const startSessionRef = useRef<
    (profile: NetworkProfile, options?: { readonly connect?: boolean }) => void
  >(() => {});
  const reconnectRef = useRef<(networkId: string) => void>(() => {});
  /** In-conversation search: whether it is open, what for, and where in the hits. */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('text');
  const [searchIndex, setSearchIndex] = useState(0);
  /** A link from a message waiting for the user to confirm before it opens. */
  const [linkToOpen, setLinkToOpen] = useState<string | undefined>(undefined);
  /** The open services-command menu, anchored under the button that opened it. */
  const [serviceMenu, setServiceMenu] = useState<
    | {
        readonly label: string;
        readonly items: readonly MenuItem[];
        readonly x: number;
        readonly y: number;
      }
    | undefined
  >(undefined);
  /** The member a ban or a removal is being built for, and which of the two. */
  const [acting, setActing] = useState<{ member: Member; kind: 'ban' | 'kick' } | undefined>(
    undefined,
  );

  /**
   * Raises a notice, folding it into one already saying the same thing.
   *
   * The rules — what counts as the same notice, what a repeat does to the one
   * on screen, how many may be up at once — are in `notices.ts`, where they can
   * be read and tested without a client around them.
   */
  const notify = useCallback((notice: Notice) => {
    setToasts((current) => foldNotice(current, notice, `${Date.now()}-${Math.random()}`));
  }, []);

  const toast = useCallback(
    (text: string, tone: ToastMessage['tone'] = 'info', action?: ToastMessage['action']) => {
      notify({ text, tone, ...(action === undefined ? {} : { action }) });
    },
    [notify],
  );

  // Stable, so the toasts are not handed a new one on every render. They no
  // longer time their countdown off it, but there is no reason to churn it.
  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const networks = useMemo(
    () =>
      orderNetworks([...registry.profiles.keys()], view.networkOrder).flatMap((id) => {
        const state = registry.networks.get(id);
        return state === undefined ? [] : [state];
      }),
    [registry.profiles, registry.networks, view.networkOrder],
  );

  // Registered rather than merely connected: a socket that is still negotiating
  // has nothing to lose yet, and one that is reconnecting on its own backoff is
  // not a reason to hold a phone awake.
  const connectedCount = networks.filter((state) => state.phase === 'registered').length;

  useEffect(() => {
    onConnectionsChanged?.(connectedCount);
  }, [connectedCount, onConnectionsChanged]);

  const editingProfile = editingId === undefined ? undefined : registry.profiles.get(editingId);
  const listingNetwork =
    listing === undefined ? undefined : registry.networks.get(listing.networkId);
  const creatingNetwork = creatingOn === undefined ? undefined : registry.networks.get(creatingOn);

  const selection = view.selection;
  const network = selection === undefined ? undefined : registry.networks.get(selection.networkId);
  const session = selection === undefined ? undefined : registry.sessionOf(selection.networkId);

  const conversation = useMemo(() => {
    if (network === undefined || selection?.target === undefined) {
      return undefined;
    }
    const key = fold(selection.target, network.support.caseMapping);
    return network.channels.get(key) ?? network.queries.get(key);
  }, [network, selection]);

  // In-conversation search. Switching conversations closes it — a search is
  // about the messages in front of you, and carrying it across would highlight
  // a term nobody asked to find here.
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIndex(0);
  }, [selection?.networkId, selection?.target]);
  // The scope is deliberately not reset with the query: somebody looking
  // through one person's messages is usually about to do it in the next
  // channel too, and having to switch back every time would be the kind of
  // small friction that stops a feature being used.

  const searchMatches = useMemo(
    () =>
      searchOpen && conversation !== undefined
        ? findMatches(conversation.messages, searchQuery, searchScope)
        : [],
    [searchOpen, conversation, searchQuery, searchScope],
  );
  const searchMatchIds = useMemo(
    () => new Set(searchMatches.map((match) => match.id)),
    [searchMatches],
  );
  // Keep the cursor inside the set as it shrinks under a longer query.
  const activeSearchPos = searchMatches.length === 0 ? 0 : searchIndex % searchMatches.length;
  const activeSearchId = searchMatches[activeSearchPos]?.id;

  const stepSearch = (delta: number): void => {
    setSearchIndex((current) => {
      const count = searchMatches.length;
      return count === 0 ? 0 : (((current + delta) % count) + count) % count;
    });
  };

  const closeSearch = (): void => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIndex(0);
  };

  // Whether this network was set up by somebody who operates it, which is what
  // decides whether the services command menus and their operator-level entries
  // are offered at all.
  const isOperator =
    network !== undefined && registry.profiles.get(network.id)?.operatorCommands === true;

  // Which service, if either, the open conversation is with — so NickServ and
  // ChanServ get a command menu the other conversations do not.
  const conversationService =
    conversation !== undefined ? serviceForTarget(selection?.target) : undefined;

  // Opening a services conversation and asking it for its help listing, from the
  // buttons on the server tab. The reply lands in the conversation as an ordinary
  // message, which is the whole point — no `/msg` for anybody to have typed.
  const openServiceHelp = (service: ServiceName): void => {
    if (network === undefined) {
      return;
    }
    const target = serviceDisplayName(service);
    view.select({ networkId: network.id, target });
    registry.sessionOf(network.id)?.sendMessage(target, 'HELP');
  };

  // The command menu for a services conversation, anchored under its button.
  // Picking a command drops its shape into the composer for this conversation
  // rather than sending it, because most of them take an argument only the user
  // has and a services command sent by mistake is not always reversible.
  const openServiceMenu = (service: ServiceName, at: { x: number; y: number }): void => {
    if (selection === undefined) {
      return;
    }
    const commands = serviceCommands(service, { operator: isOperator });
    const items: MenuItem[] = commands.map((command, index) => ({
      id: `${command.name}-${index}`,
      label: serviceCommandLabel(command),
      detail: command.summary,
      startsGroup: command.operator === true && commands[index - 1]?.operator !== true,
      onSelect: () => view.setDraft(selection, serviceCommandBody(command)),
    }));
    setServiceMenu({
      label: `${serviceDisplayName(service)} commands`,
      items,
      x: at.x,
      y: at.y,
    });
  };

  /** The same menu, hung under the button in the header that opens it. */
  const openServiceMenuUnder = (service: ServiceName, anchor: HTMLElement): void => {
    const rect = anchor.getBoundingClientRect();
    openServiceMenu(service, { x: rect.left, y: rect.bottom + 4 });
  };

  // Opening a link the user has confirmed. The platform's own browser where the
  // shell has one — the app's webview cannot navigate to an arbitrary page — and
  // a new tab otherwise, which is what a browser does with a link anyway.
  const openConfirmedLink = (): void => {
    const url = linkToOpen;
    setLinkToOpen(undefined);
    if (url === undefined) {
      return;
    }
    if (openExternal !== undefined) {
      openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // The newest message seen in each conversation, so the same one is never
  // counted or notified twice. Recording a conversation the first time it is
  // seen without acting on it is what keeps a `draft/chathistory` backfill from
  // arriving as a burst of notifications the moment a channel is joined.
  const seen = useRef(new Map<string, string>());
  const platformNotifier = useMemo(
    () => notifier ?? createWebNotifier((ref) => view.select(ref)),
    // The store's `select` is stable; rebuilding the notifier on every render
    // would hand each notification a listener the next render orphans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notifier],
  );
  /** Undefined until the platform has been asked; false once it has refused. */
  const permission = useRef<boolean | undefined>(undefined);
  /** Whether that question is currently outstanding, so it is only asked once. */
  const asking = useRef(false);

  // Loading what was saved: the name, and the networks that were set up.
  //
  // Restored networks are registered but **not connected**. A client that dials
  // out the moment it opens cannot be started to change a setting, and somebody
  // who left three networks configured has not thereby asked to be signed in to
  // all three the next time they open the app. Each comes back as a row in the
  // sidebar with Connect on its right-click menu.
  //
  // Runs once. Re-running it would re-register profiles over live sessions and
  // tear down their sockets.
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) {
      return;
    }
    restored.current = true;

    let live = true;
    const finish = (
      loaded: DefaultIdentity,
      networks: readonly NetworkProfile[],
      settings: Readonly<Record<string, unknown>> | undefined,
    ): void => {
      if (!live) {
        return;
      }
      // Applied before anything renders against them, so the window does not
      // flash the defaults on the way to the chosen layout. A file with no
      // settings in it — an install from before they were kept — reads as the
      // defaults rather than as nothing.
      useView.getState().applySettings(readStoredSettings(settings ?? {}));
      setIdentity(loaded);
      for (const profile of networks) {
        startSessionRef.current(profile, { connect: false });
      }
      // Restored, still disconnected, and now asked about rather than left as a
      // sidebar of grey dots somebody has to right-click one at a time.
      setLaunchOpen(networks.length > 0);
      // Somebody who skips is not asked again this session either: they get it
      // on the next launch, which is less rude than a screen that will not take
      // no for an answer. Settings opens it on request either way.
      if (shouldAskForIdentity(loaded, preferences !== undefined)) {
        setSettingUp(true);
      }
    };

    if (preferences === undefined) {
      finish(EMPTY_IDENTITY, [], undefined);
      return () => {
        live = false;
      };
    }

    void preferences
      .load()
      .then((stored) =>
        finish(stored?.identity ?? EMPTY_IDENTITY, stored?.networks ?? [], stored?.settings),
      )
      // A settings file that cannot be read starts blank rather than stopping
      // the client. Nothing in it is needed to connect.
      .catch(() => finish(EMPTY_IDENTITY, [], undefined));

    return () => {
      live = false;
    };
  }, [preferences]);

  /**
   * Writes the settings file.
   *
   * The whole file each time rather than a patch: it is small, and one writer
   * means the identity and the network list cannot drift apart. Reads the
   * registry at call time so a save triggered by one change carries every other.
   */
  const persist = useCallback(
    (changes: { identity?: DefaultIdentity; networks?: readonly NetworkProfile[] } = {}): void => {
      if (preferences === undefined) {
        return;
      }
      const view = useView.getState();
      const next: StoredPreferences = {
        identity: changes.identity ?? identityRef.current ?? EMPTY_IDENTITY,
        networks: changes.networks ?? [...registry.profiles.values()],
        settings: writeStoredSettings({
          appearance: view.appearance,
          ctcp: view.ctcp,
          userOptions: view.userOptions,
          logging: view.logging,
        }),
      };
      void preferences.save(next).catch((error: unknown) => {
        toast(`Could not save your settings. ${String(error)}`, 'error');
      });
    },
    [preferences, registry.profiles, toast],
  );

  identityRef.current = identity;

  /**
   * Putting the chosen theme on the window.
   *
   * One attribute on the root element, which is the whole of it: every colour
   * in the interface is a token, and `tokens.css` redefines the primitives
   * under `[data-theme]`. Written to the document rather than to a React
   * context so anything rendered outside the tree — a portal, a sheet — is
   * inside the theme too.
   */
  const theme = view.appearance.theme;
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  // Asked once. Probing writes to the keychain, so it is not a thing to do on
  // every render of a form.
  useEffect(() => {
    let live = true;
    void secrets
      ?.available()
      .then((yes) => {
        if (live) {
          setRemembersPasswords(yes);
        }
      })
      .catch(() => setRemembersPasswords(false));
    return () => {
      live = false;
    };
  }, [secrets]);

  /**
   * Writing the settings back as they are changed.
   *
   * Debounced, because a stepper held down fires a change per tick and each one
   * would otherwise be a disk write. Held off until the initial load has
   * finished, so the defaults are never written over what is on disk in the
   * moment between the component mounting and the file being read.
   */
  const settingsToSave = `${JSON.stringify(view.appearance)}${JSON.stringify(view.ctcp)}${JSON.stringify(view.userOptions)}${JSON.stringify(view.logging)}`;
  const savedSettings = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (identity === undefined) {
      // Still loading; the file has not been read yet.
      return;
    }
    if (savedSettings.current === undefined) {
      // First pass after the load: record what is on disk without rewriting it.
      savedSettings.current = settingsToSave;
      return;
    }
    if (savedSettings.current === settingsToSave) {
      return;
    }
    const timer = window.setTimeout(() => {
      savedSettings.current = settingsToSave;
      persist();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [settingsToSave, identity, persist]);

  /** Saves the identity, and carries on if the platform cannot keep it. */
  const saveIdentity = (next: DefaultIdentity): void => {
    setIdentity(next);
    setSettingUp(false);
    persist({ identity: next });
  };

  // ---------------------------------------------------------------- logging
  //
  // Building the store. Keyed on the format and the folder alone: those are the
  // two answers that make it a different store, and rebuilding it whenever the
  // scope or the retention changed would drop lines waiting to be written for
  // no reason.
  const logFormat = view.logging.format;
  const logPath = view.logging.path;
  const profileNames = registry.profiles;

  useEffect(() => {
    if (createLogStore === undefined) {
      return;
    }
    let live = true;
    void createLogStore({
      policy: {
        ...DEFAULT_LOGGING,
        format: logFormat,
        ...(logPath === undefined ? {} : { path: logPath }),
      },
      // Plaintext logs are filed under a network's name, since a folder has to
      // make sense to somebody reading it without the app. This maps a folder
      // back to the network it belongs to; a folder whose network has since
      // been removed resolves to nothing rather than to a guess.
      networkIdFor: (name) => {
        for (const [id, profile] of profileNames) {
          if (profile.name === name) {
            return id;
          }
        }
        return '';
      },
    })
      .then((store) => {
        if (live) {
          setLogs(store);
        }
      })
      .catch((error: unknown) => {
        // No store rather than a broken one. The logging settings are absent
        // without it, which is honest: there is nowhere to write, and a switch
        // that wrote nothing would be worse than no switch.
        setLogs(undefined);
        toast(`Could not open your logs. ${String(error)}`, 'error');
      });
    return () => {
      live = false;
    };
    // `profileNames` is read inside the resolver, which is called later rather
    // than now; rebuilding the store whenever a profile changes would discard
    // pending writes for a name lookup that is already current by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createLogStore, logFormat, logPath, toast]);

  // The policy a network follows: its own where it carries one, the global one
  // otherwise. Merged rather than either-or, so switching logging off globally
  // switches it off everywhere — an override that kept writing past that would
  // be a setting that lies.
  const policyFor = useCallback(
    (networkId: string) => effectivePolicy(view.logging, registry.profiles.get(networkId)?.logging),
    [view.logging, registry.profiles],
  );

  const logError = useCallback(
    (message: string) => toast(`Could not write to your logs. ${message}`, 'error'),
    [toast],
  );

  useMessageLogging({
    networks,
    store: logs,
    policyFor,
    isChannelTarget: (networkId, target) => {
      const support = registry.networks.get(networkId)?.support;
      return support !== undefined && isChannel(target, support);
    },
    onError: logError,
  });

  usePurge({
    store: logs,
    networkIds: networks.map((state) => state.id),
    cutoffFor: (networkId) => retentionCutoff(policyFor(networkId), new Date()),
    onError: logError,
  });

  /** Asks the store where it is and what it costs, for the settings screen. */
  const refreshLogLocation = useCallback(() => {
    if (logs === undefined) {
      return;
    }
    void logs
      .location()
      .then(setLogLocation)
      .catch(() => setLogLocation(undefined));
  }, [logs]);

  // Refreshed when the settings screen opens rather than continuously: it is a
  // disk measurement, and nobody watches a number tick up while they read.
  useEffect(() => {
    if (view.pane === 'settings') {
      refreshLogLocation();
    }
  }, [view.pane, refreshLogLocation]);

  /**
   * The things the logging settings do.
   *
   * All of them report what happened rather than acting silently: these touch
   * files on somebody's own disk, and "did that work" should not need checking
   * in a file manager.
   */
  const changeLogFolder = (): void => {
    if (chooseLogFolder === undefined) {
      return;
    }
    void chooseLogFolder().then((folder) => {
      if (folder === undefined) {
        return;
      }
      // Only where new logs go. Moving what is already written is the user's to
      // do — a client that quietly relocated somebody's files would be making a
      // decision about their disk that is not its to make.
      view.updateLogging({ path: folder });
      refreshLogLocation();
      toast(`New logs will be written to ${folder}. What is already written stays where it is.`);
    });
  };

  const openLogFolder = (): void => {
    void logs?.reveal?.().catch((error: unknown) => logError(String(error)));
  };

  const exportLogs = (): void => {
    if (logs === undefined || chooseExportFile === undefined) {
      return;
    }
    void chooseExportFile().then((path) => {
      if (path === undefined) {
        return;
      }
      void logs
        .export({ text: '', limit: EXPORT_LIMIT }, path)
        .then((written) => toast(`Logs written to ${written}.`))
        .catch((error: unknown) => toast(`Could not write the export. ${String(error)}`, 'error'));
    });
  };

  const clearLogs = (): void => {
    void logs
      ?.clear()
      .then((removed) => {
        refreshLogLocation();
        toast(removed === 1 ? 'Deleted one logged line.' : `Deleted ${removed} logged lines.`);
      })
      .catch((error: unknown) => logError(String(error)));
  };

  const purgeLogsNow = (): void => {
    if (logs === undefined) {
      return;
    }
    void (async () => {
      let removed = 0;
      for (const state of networks) {
        const cutoff = retentionCutoff(policyFor(state.id), new Date());
        if (cutoff !== undefined) {
          removed += await logs.purge(cutoff, state.id);
        }
      }
      refreshLogLocation();
      toast(
        removed === 0
          ? 'Nothing was old enough to delete.'
          : `Deleted ${removed} logged ${removed === 1 ? 'line' : 'lines'}.`,
      );
    })().catch((error: unknown) => logError(String(error)));
  };

  // A change to what strangers may ask takes effect now, not at the next
  // reconnect — somebody who switches off answering VERSION means this one.
  useEffect(() => {
    for (const state of networks) {
      registry.sessionOf(state.id)?.setCtcpPolicy(view.ctcp);
    }
  }, [view.ctcp, networks, registry]);

  // Unread, highlight, and notification tracking. Watching the tail of each
  // buffer rather than every message keeps this out of the reducer, where a
  // "have I read this" question does not belong.
  useEffect(() => {
    for (const state of networks) {
      for (const [key, channel] of [...state.channels, ...state.queries]) {
        const newest = channel.messages[channel.messages.length - 1];
        if (newest === undefined) {
          continue;
        }
        const seenKey = `${state.id} ${key}`;
        const previous = seen.current.get(seenKey);
        seen.current.set(seenKey, newest.id);
        if (previous === newest.id) {
          continue;
        }

        const ref: TargetRef = { networkId: state.id, target: channel.name };
        const watching = sameRef(ref, view.selection) && view.pane === 'chat';
        const mentions = (text: string): boolean =>
          isHighlight(text, state.nick, view.appearance.highlightWords);

        if (newest.kind === 'privmsg' && !watching) {
          view.noteActivity(ref, mentions(newest.text));
        }

        // First sight of a conversation is not news, whatever is in it.
        if (previous === undefined) {
          continue;
        }

        const reason = shouldNotify({
          message: newest,
          network: state,
          ref,
          watching: watching && windowIsFocused(),
          enabled: view.appearance.notificationsEnabled,
          isHighlight: mentions,
        });
        if (reason !== undefined) {
          const request = buildNotification(reason, newest, state, ref);
          if (permission.current === true) {
            platformNotifier.show(request);
          } else if (permission.current === undefined && !asking.current) {
            // Asked once, lazily. A burst of messages must not turn into a
            // stack of permission prompts.
            asking.current = true;
            void platformNotifier.ensurePermission().then((granted) => {
              permission.current = granted;
              asking.current = false;
              if (granted) {
                platformNotifier.show(request);
              }
            });
          }
        }
      }
    }
    // Deliberately keyed on the networks array identity: the store hands back a
    // new one whenever any conversation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networks]);

  // Building the session, registering it, and dialling out. Shared by adding a
  // network and reconnecting one, so a reconnect gets a fresh transport rather
  // than reusing a spent socket.
  const startSession = useCallback(
    (profile: NetworkProfile, options: { readonly connect?: boolean } = {}): void => {
      /**
       * The reconnecting wrapper, around a fresh transport per attempt.
       *
       * This was built in Phase 2 and, until now, never used: the shell handed
       * the session a bare transport, so a dropped connection stayed dropped
       * and nothing retried. It works down the profile's endpoint list with
       * backoff and jitter, and gives up after three attempts so somebody is
       * told rather than left watching a window that looks connected.
       */
      const transport = createReconnectingTransport({
        endpoints: profile.servers,
        // A used transport is never reconnected; each attempt gets its own.
        createTransport: () => createTransport(profile),
        autoReconnect: profile.autoReconnect,
      });

      const built: Session = createSession({
        profile,
        transport,
        ctcp: useView.getState().ctcp,
        // The platform's own store first, where it has one, and the session
        // store behind it. A password typed into the form this run is in the
        // second and not yet in the first, and has to work either way.
        resolveSecret: async (ref) => (await resolveSecret?.(ref)) ?? readSecret(ref),
      });

      built.on((sessionEvent) => {
        if (sessionEvent.kind === 'auth-failed') {
          toast(sessionEvent.reason, 'error');
        } else if (sessionEvent.kind === 'closed' && sessionEvent.reason.kind === 'tls-error') {
          handleTlsError.current(profile);
        } else if (sessionEvent.kind === 'closed' && sessionEvent.reason.kind !== 'user') {
          // Reconnection has already been tried and given up — the wrapper only
          // reports a close once it is out of attempts — so this is the point
          // at which somebody needs telling, with the way back in the same
          // notice rather than somewhere they have to go looking.
          reportLostConnection.current(profile, sessionEvent.reason);
        } else if (sessionEvent.kind === 'channel-error') {
          // A refused join used to leave the sentence in the server tab, which
          // is not where somebody who clicked Join is looking: the channel row
          // simply never appeared. The notice carries the plain-English reason
          // and, where there is one, the way out of it.
          reportChannelError.current(profile.id, sessionEvent);
        } else if (sessionEvent.kind === 'dcc-offer') {
          // Routed through a ref so this long-lived listener always runs the
          // latest logic — the pending-request map and the folder both change
          // over the session's life.
          handleDccOffer.current(
            profile.id,
            profile.name,
            sessionEvent.from,
            sessionEvent.target,
            sessionEvent.send,
          );
        } else if (sessionEvent.kind === 'xdcc-offer') {
          handleXdccOffer.current(
            profile.id,
            profile.name,
            sessionEvent.from,
            sessionEvent.target,
            sessionEvent.pack,
          );
        } else if (sessionEvent.kind === 'xdcc-response') {
          handleXdccResponse.current(profile.id, sessionEvent.from, sessionEvent.response);
        }
      });

      registry.addProfile(profile, built);
      if (options.connect === false) {
        return;
      }
      void built.connect().catch((error: unknown) => {
        // A certificate that would not verify is offered a way to trust it,
        // rather than reported as an unreachable server — the same prompt a
        // mid-session TLS failure raises.
        if (connectErrorReason(error)?.kind === 'tls-error') {
          handleTlsError.current(profile);
          return;
        }
        toast(`Could not reach ${profile.name}. ${describe(error)}`, 'error');
      });
    },
    [createTransport, resolveSecret, registry, toast],
  );

  // Reachable from the restore effect, which runs once and must not be rebuilt
  // when this is: rebuilding it would re-register every profile over its own
  // live session.
  startSessionRef.current = startSession;

  /**
   * Moves the passwords a form just took into the platform's keychain.
   *
   * They arrive in the in-memory store as a `SecretRef`; this copies the value
   * the reference stands for into the keychain under the same key, so the
   * profile written to disk resolves on the next launch. A machine with no
   * keychain simply keeps them in memory, and the network asks again next time
   * — which the "Add a network" form says up front.
   */
  const keepSecrets = useCallback(
    (profile: NetworkProfile): void => {
      if (secrets === undefined) {
        return;
      }
      for (const ref of secretRefsOf(profile)) {
        const value = readSecret(ref);
        if (value === undefined) {
          continue;
        }
        void secrets.save(ref, value).catch(() => {
          // Not worth interrupting for: the session in front of them works, and
          // the form already said passwords may not be remembered here.
        });
      }
    },
    [secrets],
  );

  const addNetwork = (profile: NetworkProfile): void => {
    startSession(profile);
    keepSecrets(profile);
    persist({ networks: [...registry.profiles.values(), profile] });
    view.select({ networkId: profile.id, target: undefined });
  };

  const reconnect = (networkId: string): void => {
    const profile = registry.profiles.get(networkId);
    if (profile !== undefined) {
      startSession(profile);
    }
  };

  /**
   * Connecting the networks chosen on the launch screen.
   *
   * All of them at once is the point: each connection is independent, so a
   * network that is slow to answer holds nothing else up, and one that fails
   * reports itself the way any other failed connection does. The first is
   * selected afterwards so the window lands somewhere rather than on the screen
   * that has just been answered.
   */
  const connectNetworks = (networkIds: readonly string[]): void => {
    setLaunchOpen(false);
    for (const networkId of networkIds) {
      reconnect(networkId);
    }
    const first = networkIds[0];
    if (first !== undefined) {
      view.select({ networkId: first, target: undefined });
    }
  };

  // Reachable from the long-lived session listener, which is built once per
  // session and cannot close over a function that changes every render.
  reconnectRef.current = reconnect;

  // Saving an edit. The transport is built around the profile's endpoints and
  // the identity goes out during registration, so a changed profile reaches the
  // wire only through a new session — which is why this rebuilds one rather
  // than only writing the profile back. A network that was connected reconnects
  // on the new settings; one that was not stays as it was, on them.
  const saveNetwork = (profile: NetworkProfile): void => {
    const live = registry.networks.get(profile.id)?.phase !== 'disconnected';
    // Registering the session writes the profile back with it, so there is
    // nothing to save separately.
    startSession(profile, { connect: live });
    keepSecrets(profile);
    persist({
      networks: [...registry.profiles.values()].map((entry) =>
        entry.id === profile.id ? profile : entry,
      ),
    });
    setEditingId(undefined);
    toast(
      live
        ? `Reconnecting to ${profile.name} with the new settings.`
        : `Saved. ${profile.name} will connect with the new settings.`,
    );
  };

  const removeNetwork = (networkId: string): void => {
    const profile = registry.profiles.get(networkId);
    registry.removeProfile(networkId);
    view.forgetNetwork(networkId);
    persist({
      networks: [...registry.profiles.values()].filter((entry) => entry.id !== networkId),
    });
    // A password for a network nobody has any more is left in the keychain
    // otherwise, which is somebody's credential outliving their decision to
    // delete it.
    if (profile !== undefined && secrets !== undefined) {
      for (const ref of secretRefsOf(profile)) {
        void secrets.forget(ref).catch(() => {});
      }
    }
  };

  const disconnect = (networkId: string): void => {
    registry.sessionOf(networkId)?.disconnect();
  };

  /**
   * This device's folders, which an exported document deliberately carries none
   * of and an imported one is given from here.
   *
   * A download folder and a log folder are facts about one machine — and on
   * Android they are not even the user's to choose. Carrying the desktop's
   * across would point a phone at a path it has no such thing as; leaving them
   * out and filling them in here keeps the settings that were about the folder
   * rather than about the device.
   */
  const devicePaths: DevicePaths = useMemo(
    () => ({
      ...(view.userOptions.downloadFolder === undefined
        ? {}
        : { downloadFolder: view.userOptions.downloadFolder }),
      ...(view.logging.path === undefined ? {} : { logPath: view.logging.path }),
    }),
    [view.userOptions.downloadFolder, view.logging.path],
  );

  /**
   * The document for what is configured right now.
   *
   * Built when the sheet opens rather than held in state: it is a view of the
   * live configuration, and a copy of it taken at mount would quietly export
   * whatever was set up ten minutes ago.
   */
  const configText = useMemo(
    () =>
      !exportingConfig
        ? ''
        : serializeConfig(
            buildConfig({
              identity: identity ?? EMPTY_IDENTITY,
              networks: [...registry.profiles.values()],
              settings: {
                appearance: view.appearance,
                ctcp: view.ctcp,
                userOptions: view.userOptions,
                logging: view.logging,
              },
              ...(APP_VERSION === undefined ? {} : { app: APP_VERSION }),
            }),
          ),
    [
      exportingConfig,
      identity,
      registry.profiles,
      view.appearance,
      view.ctcp,
      view.userOptions,
      view.logging,
    ],
  );

  /**
   * Replacing this device's configuration with another's.
   *
   * The order matters. Networks that are not in the document go first, so their
   * rows and their unread counts are gone rather than left pointing at a
   * session that has been released; then the settings, so nothing renders
   * against the old layout on the way; then the profiles, registered but *not
   * connected*, for the same reason a restart does not dial out — somebody who
   * imported their settings has not thereby asked to be signed in to five
   * networks.
   *
   * Secrets are the careful part. A network being dropped has its passwords
   * forgotten, as removing one by hand does — except where the incoming
   * document references the same one, which is what re-importing on the device
   * that wrote it does. Forgetting those would take away the passwords the
   * import is about to need.
   */
  const applyConfig = (config: ConfigImport): void => {
    const arriving = new Set(config.networks.map((profile) => profile.id));
    const stillNeeded = new Set(
      config.networks.flatMap((profile) => secretRefsOf(profile).map((ref) => ref.id)),
    );

    for (const [networkId, profile] of [...registry.profiles]) {
      if (arriving.has(networkId)) {
        continue;
      }
      registry.removeProfile(networkId);
      view.forgetNetwork(networkId);
      if (secrets !== undefined) {
        for (const ref of secretRefsOf(profile)) {
          if (!stillNeeded.has(ref.id)) {
            void secrets.forget(ref).catch(() => {});
          }
        }
      }
    }

    useView.getState().applySettings(config.settings);
    setIdentity(config.identity);
    for (const profile of config.networks) {
      startSession(profile, { connect: false });
    }
    persist({ identity: config.identity, networks: config.networks });

    setImportingConfig(false);
    toast(
      config.networks.length === 0
        ? 'Settings imported. There were no networks in that file.'
        : `Settings imported. ${config.networks.length === 1 ? '1 network is' : `${config.networks.length} networks are`} ready to connect.`,
    );
  };

  // Choosing where downloaded files go. Reading the platform's own folder
  // picker, so the path is a real one the shell can write to rather than
  // something typed by hand.
  //
  // Undefined where the platform has no picker to read. Android is that
  // platform, and there the folder is not the user's to choose — an app writes
  // inside its own storage or it asks for a permission to read the whole
  // device — so the shell names it instead, below.
  const picker = dcc?.chooseDownloadFolder;
  const chooseDownloadFolder = useMemo(
    () =>
      picker === undefined
        ? undefined
        : (): void => {
            void picker.call(dcc).then((folder) => {
              if (folder !== undefined && folder !== '') {
                useView.getState().updateUserOptions({ downloadFolder: folder });
              }
            });
          },
    [dcc, picker],
  );

  /**
   * Filling in the download folder on a platform that picks it for us.
   *
   * Asked for once, and only where there is no picker: with one, an unset
   * folder means the user has not chosen yet and choosing for them would be
   * deciding where their files go. Without one there is nothing to decide —
   * there is exactly one folder the app may write to — and leaving it unset
   * would leave the file monitor switched off behind a Choose button that
   * cannot open anything.
   */
  const defaultFolder = dcc?.defaultDownloadFolder;
  useEffect(() => {
    if (defaultFolder === undefined || picker !== undefined) {
      return;
    }
    if (useView.getState().userOptions.downloadFolder !== undefined) {
      return;
    }
    void defaultFolder
      .call(dcc)
      .then((folder) => {
        if (folder !== '' && useView.getState().userOptions.downloadFolder === undefined) {
          useView.getState().updateUserOptions({ downloadFolder: folder });
        }
      })
      .catch(() => {
        // Downloads stay blocked and the settings screen says the folder is
        // not set, which is the honest state. Nothing to interrupt anyone with.
      });
  }, [dcc, defaultFolder, picker]);

  /**
   * Says how a download got on, unless the file list is already saying it.
   *
   * Requesting a pack, a file arriving, a transfer stopped: the row in the file
   * list shows every one of those, in the words the button used. Repeating it
   * over the top of the very list it describes is noise, and a queue of files
   * turned that into a wall of it. Somewhere else in the client there is nothing
   * else showing it, so it is said there.
   *
   * Failures do not come through here. Those want a decision, and the row's
   * truncated error line is not the place to make it.
   */
  const announceDownload = useCallback(
    (notice: Notice) => {
      if (!shouldAnnounceDownload(useView.getState().pane)) {
        return;
      }
      notify(notice);
    },
    [notify],
  );

  // Downloads in flight, keyed by the row that started them, each with the
  // handle used to cancel it. A row can only have one transfer at a time, so the
  // id is a fine key; the entry is cleared when the transfer settles.
  const transfers = useRef(new Map<string, { cancel: () => void }>());
  // Rows the user cancelled, so the transfer's own rejection is recognised as a
  // deliberate stop and not surfaced as a download failure.
  const cancelledOffers = useRef(new Set<string>());

  // Fetching one direct DCC transfer into the chosen folder, updating a given
  // row as it goes. The optimistic status flips to downloading at once and
  // settles to saved or failed when the shell reports back, so a slow transfer
  // is visibly in progress rather than an unresponsive button. Shared by the
  // Download button on a direct offer and by the XDCC path, which lands here
  // once the bot answers a request with a real DCC SEND.
  const fetchIntoFolder = useCallback(
    (
      offerId: string,
      source: { host: string; port: number; filename: string; size?: number },
    ): void => {
      const folder = useView.getState().userOptions.downloadFolder;
      if (dcc === undefined || folder === undefined) {
        useView
          .getState()
          .setDccOfferStatus(offerId, { status: 'failed', error: 'No download folder is set.' });
        toast('Choose a download folder first.', 'error');
        return;
      }
      // A fresh attempt clears any earlier cancel mark, so a row downloaded,
      // cancelled, and started again is treated on its own terms.
      cancelledOffers.current.delete(offerId);
      // The name is written back to the row: a pack asked for by number had
      // only its number until now, and a bot that renamed the file has just
      // said what it will actually be saved as.
      useView
        .getState()
        .setDccOfferStatus(offerId, { status: 'downloading', filename: source.filename });
      const transfer = dcc.download(
        {
          host: source.host,
          port: source.port,
          filename: source.filename,
          folder,
          ...(source.size === undefined ? {} : { size: source.size }),
        },
        (received, total) => useView.getState().setDccOfferProgress(offerId, received, total),
      );
      transfers.current.set(offerId, transfer);
      transfer.done
        .then((savedPath) => {
          transfers.current.delete(offerId);
          useView.getState().setDccOfferStatus(offerId, { status: 'downloaded', savedPath });
          announceDownload({
            key: 'dcc-saved',
            text: (saved) => (saved === 1 ? `Saved ${source.filename}.` : `Saved ${saved} files.`),
          });
        })
        .catch((error: unknown) => {
          transfers.current.delete(offerId);
          // A cancel rejects the transfer too; that is the user's own doing, so
          // the row is already back to available and no failure is shown.
          if (cancelledOffers.current.delete(offerId)) {
            return;
          }
          useView
            .getState()
            .setDccOfferStatus(offerId, { status: 'failed', error: describe(error) });
          // Keyed to the row, not the wording: a serving bot re-offers a pack
          // every few seconds and each re-offer is another attempt, so one file
          // that will not come is one notice that keeps count, not a tower of
          // them. Failures are said whether or not the file list is open —
          // unlike a file arriving, they need a decision.
          notify({
            key: `dcc-failed-${offerId}`,
            tone: 'error',
            text: (attempts) =>
              attempts === 1
                ? `Couldn't download ${source.filename}. ${describe(error)}`
                : `Couldn't download ${source.filename} after ${attempts} attempts. ${describe(error)}`,
          });
        });
    },
    [announceDownload, dcc, notify, toast],
  );

  // Stopping a download that is under way. The row goes straight back to
  // available so it can be started again, and the shell is asked to abort the
  // socket; the transfer's rejection is then swallowed as a deliberate cancel.
  const cancelOffer = useCallback(
    (offer: DccOfferRecord): void => {
      const transfer = transfers.current.get(offer.id);
      if (transfer === undefined) {
        return;
      }
      cancelledOffers.current.add(offer.id);
      transfer.cancel();
      useView.getState().setDccOfferStatus(offer.id, { status: 'available' });
      announceDownload({
        key: 'dcc-stopped',
        text: (stopped) =>
          stopped === 1
            ? `Stopped downloading ${offer.filename}.`
            : `Stopped ${stopped} downloads.`,
      });
    },
    [announceDownload],
  );

  /**
   * Forgetting an XDCC request we are still waiting on.
   *
   * Without this, dropping a `requested` row would leave its id in the pending
   * queue, and a bot answering late would be matched back to a row that no
   * longer exists — a file downloading with nothing on screen to show or stop
   * it. Forgotten, a late answer is simply an unsolicited offer, which is what
   * it now is.
   */
  const forgetPendingRequest = useCallback((offerId: string): void => {
    for (const [key, queue] of pendingXdcc.current) {
      const rest = queue.filter((id) => id !== offerId);
      if (rest.length === queue.length) {
        continue;
      }
      if (rest.length === 0) {
        pendingXdcc.current.delete(key);
      } else {
        pendingXdcc.current.set(key, rest);
      }
    }
  }, []);

  /**
   * Telling a bot to drop a pack we are no longer waiting for.
   *
   * Forgetting the row locally is not the same as leaving the queue: the bot
   * still holds the request, and answers it eventually by opening a transfer
   * for a file nobody is expecting any more. Serving bots take `XDCC REMOVE`
   * for exactly this, so a row taken off the list is taken out of the queue too.
   * Best-effort — a bot that does not understand it simply says nothing, which
   * is no worse than never having asked.
   */
  const cancelPackRequest = useCallback(
    (offer: DccOfferRecord): void => {
      if (offer.kind !== 'xdcc' || offer.status !== 'requested' || offer.pack === undefined) {
        return;
      }
      registry
        .sessionOf(offer.networkId)
        ?.send(`PRIVMSG ${offer.from} :XDCC REMOVE #${offer.pack}`);
    },
    [registry],
  );

  /**
   * Taking a row off the list, whatever state it is in.
   *
   * The way out of a row nothing else can shift: a pack a bot never answered
   * sits at `requested` with no control on it, and used to survive Clear too.
   * Anything still running is stopped first — removing the row of a live
   * transfer without cancelling it would leave the socket running with nothing
   * on screen to stop it, which is the thing Clear was avoiding.
   */
  const dismissOffer = useCallback(
    (offer: DccOfferRecord): void => {
      const transfer = transfers.current.get(offer.id);
      if (transfer !== undefined) {
        cancelledOffers.current.add(offer.id);
        transfer.cancel();
      }
      cancelPackRequest(offer);
      forgetPendingRequest(offer.id);
      useView.getState().removeDccOffer(offer.id);
    },
    [cancelPackRequest, forgetPendingRequest],
  );

  /** Clearing the list, and leaving the queues the dropped rows were waiting in. */
  const clearOffers = useCallback((): void => {
    for (const offer of useView.getState().dccOffers) {
      if (!isTransferInFlight(offer.status)) {
        cancelPackRequest(offer);
        forgetPendingRequest(offer.id);
      }
    }
    useView.getState().clearDccOffers();
  }, [cancelPackRequest, forgetPendingRequest]);

  // Opening the file manager on a saved download. Only wired where the platform
  // can do it — desktop — and only ever on a path the shell itself returned.
  const revealOffer = useCallback(
    (offer: DccOfferRecord): void => {
      if (dcc?.revealFile === undefined || offer.savedPath === undefined) {
        return;
      }
      dcc.revealFile(offer.savedPath).catch((error: unknown) => {
        toast(`Couldn't open the folder. ${describe(error)}`, 'error');
      });
    },
    [dcc, toast],
  );

  // Reconnecting to a network with certificate checking switched off, and saving
  // that so it holds next time. Reached only after the user is told the
  // certificate could not be verified and chooses to trust it anyway, so nobody
  // ends up on an unverified connection without having said so.
  const acceptUnverifiedCert = useCallback(
    (profile: NetworkProfile): void => {
      const servers = profile.servers.map((endpoint) =>
        endpoint.tls.mode === 'tls' && endpoint.tls.verifyCert
          ? { ...endpoint, tls: { mode: 'tls' as const, verifyCert: false as const } }
          : endpoint,
      );
      const trusting: NetworkProfile = { ...profile, servers };
      // Clear what is on screen first: the certificate warning has been answered,
      // and any duplicate of it from an earlier attempt goes with it, so the
      // decision does not leave its own prompt behind.
      setToasts([]);
      // Registering the rebuilt session writes the profile back with it, so the
      // choice is saved by the same step that reconnects on it.
      startSession(trusting, { connect: true });
      view.select({ networkId: trusting.id, target: undefined });
      toast(`Connecting to ${profile.name} without checking its certificate. Saved for next time.`);
    },
    [startSession, view, toast],
  );

  // A certificate that would not verify. The connection is refused rather than
  // silently trusted; the user is told plainly and offered a one-click way to
  // trust it and remember the choice. Held in a ref so the long-lived session
  // listener always runs the current version.
  /**
   * Telling somebody the connection is gone, once retrying has stopped.
   *
   * Held in a ref for the same reason as the TLS handler: the session listener
   * outlives every render, and a closure captured at build time would keep
   * calling last week's `toast`.
   *
   * Deliberately not raised for each failed attempt. Three notices for one
   * outage is noise, and the sidebar's own status dot already shows the network
   * is not up while it is trying.
   */
  const reportLostConnection = useRef<(profile: NetworkProfile, reason: CloseReason) => void>(
    () => {},
  );
  reportLostConnection.current = (profile, reason) => {
    toast(`${lostConnectionText(profile.name, reason)}`, 'error', {
      label: 'Try again',
      onSelect: () => reconnectRef.current(profile.id),
    });
  };

  const handleTlsError = useRef<(profile: NetworkProfile) => void>(() => {});
  handleTlsError.current = (profile) => {
    const verifying = profile.servers.some(
      (endpoint) => endpoint.tls.mode === 'tls' && endpoint.tls.verifyCert,
    );
    if (!verifying) {
      toast(
        `Couldn't verify ${profile.name}'s certificate. Check the network's security setting.`,
        'error',
      );
      return;
    }
    // Asked rather than reported, so it waits to be answered. Timed out, the
    // network would simply not connect with nothing left on screen saying why.
    notify({
      text: `Couldn't verify ${profile.name}'s certificate — it isn't signed by an authority your device recognises. Connect without checking it?`,
      tone: 'error',
      persistent: true,
      action: { label: 'Connect anyway', onSelect: () => acceptUnverifiedCert(profile) },
    });
  };

  /**
   * What to say when a network refuses something about a channel.
   *
   * The copy comes from the protocol layer, which is where the numeric is
   * turned into a sentence; what this adds is the way out of it, where there is
   * one. A channel that wants a password gets a field to type it into, and a
   * channel that wants an account gets the account screen — which beats telling
   * somebody what is wrong and leaving them to find the fix.
   *
   * Held in a ref for the same reason as the others here: the session listener
   * outlives every render.
   */
  const reportChannelError = useRef<
    (
      networkId: string,
      failure: { channel: string; message: string; action: SuggestedAction },
    ) => void
  >(() => {});
  reportChannelError.current = (networkId, failure) => {
    switch (failure.action) {
      case 'enter-channel-password':
        toast(failure.message, 'error', {
          label: 'Enter password',
          onSelect: () => setChannelKeyFor({ networkId, channel: failure.channel }),
        });
        return;
      case 'sign-in':
        toast(failure.message, 'error', {
          label: 'Open account',
          onSelect: () => {
            view.select({ networkId, target: undefined });
            view.setPane('account');
          },
        });
        return;
      default:
        toast(failure.message, 'error');
    }
  };

  // XDCC downloads requested but not yet answered, keyed by network + folded bot
  // nick, each a queue of offer ids. The bot's eventual DCC SEND is matched back
  // to the request it names — a bot sends its queue in its own order, so the
  // oldest outstanding request is often not the one being answered.
  const pendingXdcc = useRef(new Map<string, string[]>());

  // What to do when a bot advertises a pack. Held in a ref so the long-lived
  // session listener always calls the current version.
  const handleXdccOffer = useRef<
    (networkId: string, networkName: string, from: string, target: string, pack: XdccPack) => void
  >(() => {});
  handleXdccOffer.current = (networkId, networkName, from, target, pack) => {
    useView
      .getState()
      .recordXdccOffer({ networkId, networkName, from, target, pack, at: Date.now() });
  };

  // The folded-nick key a pending request lives under.
  const pendingKey = useCallback(
    (networkId: string, nick: string): string => {
      const mapping = registry.networks.get(networkId)?.support.caseMapping;
      return `${networkId} ${mapping === undefined ? nick.toLowerCase() : fold(nick, mapping)}`;
    },
    [registry],
  );

  /**
   * A serving bot's answer to a pack we asked for.
   *
   * Only ever applied to a row still waiting on that same bot: a notice is
   * ordinary text anyone can send, and the pending queue is what makes this a
   * reply to us rather than something a stranger typed. The pack number picks
   * the row where the bot named one; with a single request outstanding there is
   * nothing to pick between.
   */
  const handleXdccResponse = useRef<
    (networkId: string, from: string, response: XdccResponse) => void
  >(() => {});
  handleXdccResponse.current = (networkId, from, response) => {
    const queue = pendingXdcc.current.get(pendingKey(networkId, from)) ?? [];
    if (queue.length === 0) {
      return;
    }
    const rows = useView.getState().dccOffers;
    const named =
      response.pack === undefined
        ? undefined
        : queue.find((id) => rows.some((row) => row.id === id && row.pack === response.pack));
    const targetId = named ?? (queue.length === 1 ? queue[0] : undefined);
    if (targetId === undefined) {
      return;
    }
    // A transfer that has already started says more than anything the bot is
    // still narrating, so a late notice never drags a live download backwards.
    if (rows.find((row) => row.id === targetId)?.status !== 'requested') {
      return;
    }

    const outcome = applyXdccResponse(response);
    useView.getState().setDccOfferStatus(targetId, {
      status: outcome.status,
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
      ...(outcome.note === undefined ? {} : { note: outcome.note }),
    });
    if (outcome.settled) {
      forgetPendingRequest(targetId);
    }
  };

  // A direct DCC SEND arriving. If it answers an XDCC request we made, it fills
  // that row and downloads; otherwise it is an unsolicited offer of its own.
  const handleDccOffer = useRef<
    (networkId: string, networkName: string, from: string, target: string, send: DccSend) => void
  >(() => {});
  handleDccOffer.current = (networkId, networkName, from, target, send) => {
    const key = pendingKey(networkId, from);
    const queue = pendingXdcc.current.get(key) ?? [];
    // Every row this same bot advertised, which is what an answer is matched
    // against: both the queue and the re-offer rule work on the filename, so
    // they have to be looking at the same list.
    const rows = useView
      .getState()
      .dccOffers.filter((entry) => pendingKey(entry.networkId, entry.from) === key);

    const refuse = (offerId: string): void => {
      useView.getState().setDccOfferStatus(offerId, {
        status: 'failed',
        error: "The bot sent a passive transfer, which Marmotter can't fetch.",
      });
    };
    const fetchInto = (offerId: string): void => {
      fetchIntoFolder(offerId, {
        host: send.host,
        port: send.port,
        filename: send.filename,
        ...(send.size === undefined ? {} : { size: send.size }),
      });
    };

    const answered = matchPendingRequest(queue, rows, send.filename);
    if (answered !== undefined) {
      // Only the request that was answered leaves the queue. Taking the head
      // instead meant a re-offer of one pack consumed the request for another,
      // and the answers that followed matched nothing.
      const rest = queue.filter((id) => id !== answered);
      if (rest.length > 0) {
        pendingXdcc.current.set(key, rest);
      } else {
        pendingXdcc.current.delete(key);
      }
      if (send.passive) {
        refuse(answered);
      } else {
        fetchInto(answered);
      }
      return;
    }

    // Not matched to a request still in its queue. A DCC SEND that matches a
    // file already on the list is the serving bot offering it again — a row
    // still waiting on a request whose queue entry has already been used, or
    // one whose last attempt failed — rather than a new file; the classifier
    // decides whether that means connecting, ignoring a duplicate, or listing
    // a genuinely new offer.
    const existing = rows.find((entry) => sameFilename(entry.filename, send.filename));
    switch (classifyDccReoffer(existing, send)) {
      case 'retry':
        // `existing` is defined on this branch; connect for that same row at
        // the address this offer advertises.
        if (existing !== undefined) {
          fetchInto(existing.id);
        }
        return;
      case 'refuse':
        if (existing !== undefined) {
          refuse(existing.id);
        }
        return;
      case 'ignore':
        return;
      case 'record':
        useView
          .getState()
          .recordDccOffer({ networkId, networkName, from, target, send, at: Date.now() });
        return;
    }
  };

  // The Download button. A direct offer is fetched straight away; an XDCC pack
  // is requested from the bot, and the answering DCC SEND is caught above.
  const downloadOffer = useCallback(
    (offer: DccOfferRecord): void => {
      if (useView.getState().userOptions.downloadFolder === undefined) {
        toast('Choose a download folder first.', 'error');
        return;
      }
      if (offer.kind === 'xdcc') {
        const session = registry.sessionOf(offer.networkId);
        if (session === undefined || offer.pack === undefined) {
          toast(`Can't reach ${offer.from} to request that file.`, 'error');
          return;
        }
        pendingXdcc.current.set(pendingKey(offer.networkId, offer.from), [
          ...(pendingXdcc.current.get(pendingKey(offer.networkId, offer.from)) ?? []),
          offer.id,
        ]);
        session.send(`PRIVMSG ${offer.from} :XDCC SEND #${offer.pack}`);
        useView.getState().setDccOfferStatus(offer.id, { status: 'requested' });
        announceDownload({
          key: 'dcc-requested',
          text: (requested) =>
            requested === 1
              ? `Requested pack #${offer.pack} from ${offer.from}.`
              : `Requested ${requested} packs.`,
        });
        return;
      }
      if (offer.host === undefined || offer.port === undefined) {
        toast(`That offer has no address to connect to.`, 'error');
        return;
      }
      fetchIntoFolder(offer.id, {
        host: offer.host,
        port: offer.port,
        filename: offer.filename,
        ...(offer.size === undefined ? {} : { size: offer.size }),
      });
    },
    [announceDownload, registry, toast, fetchIntoFolder, pendingKey],
  );

  /**
   * Requesting a pack from a line pasted out of an XDCC index.
   *
   * Every index on the web hands a person the same two strings — an `irc://`
   * link and a literal `/msg Bot xdcc send #42` — so those, rather than a form
   * with a nick field and a number field, are what somebody arrives holding.
   * Reading them is the whole feature: the link says which network, the message
   * says which bot and which pack, and the row it makes behaves from then on
   * exactly like one the monitor saw advertised.
   */
  const requestPastedPack = useCallback(
    (text: string): void => {
      const request = parseXdccRequest(text);
      if (request === undefined) {
        toast(
          "That doesn't look like a pack request. Paste a line like /msg bot xdcc send #42.",
          'error',
        );
        return;
      }

      // The link decides the network where it names one we are on; with no
      // link, the network being looked at is the only sensible reading.
      const linked =
        request.host === undefined ? undefined : networkForHost(registry.profiles, request.host);
      const networkId = linked ?? selection?.networkId;
      if (networkId === undefined) {
        toast(
          request.host === undefined
            ? 'Open a network first, so Marmotter knows who to ask.'
            : `You're not connected to ${request.host}. Add it as a network first.`,
          'error',
        );
        return;
      }

      const profile = registry.profiles.get(networkId);
      const session = registry.sessionOf(networkId);
      if (profile === undefined || session === undefined) {
        toast(`Can't reach ${request.nick} to request that file.`, 'error');
        return;
      }

      // Bots on most packlist networks refuse anyone who is not in one of their
      // channels — the single most common reason a request is answered with
      // silence — so a link that names one joins it before asking.
      if (
        request.channel !== undefined &&
        registry.networks.get(networkId)?.channels.get(request.channel) === undefined
      ) {
        session.join(request.channel);
      }

      const id = useView.getState().recordXdccRequest({
        networkId,
        networkName: profile.name,
        from: request.nick,
        pack: request.pack,
        at: Date.now(),
      });
      const row =
        id === undefined
          ? undefined
          : useView.getState().dccOffers.find((entry) => entry.id === id);
      if (row === undefined) {
        return;
      }
      downloadOffer(row);
    },
    [downloadOffer, registry, selection, toast],
  );

  // Joining a channel from the GUI: the sidebar's "+" asks for a name here and
  // the session sends the JOIN, so nobody has to know the command exists.
  const joinChannel = (name: string): void => {
    const target = joiningNetwork;
    setJoiningNetwork(undefined);
    if (target === undefined) {
      return;
    }
    const channelName = /^[#&]/.test(name) ? name : `#${name}`;
    registry.sessionOf(target)?.join(channelName);
    view.select({ networkId: target, target: channelName });
  };

  // The channel browser. Opening it does not fetch anything by itself — a bare
  // LIST on a large network is thousands of rows, and asking for them should be
  // something the user did on purpose.
  const browseChannels = (networkId: string): void => {
    view.select({ networkId, target: undefined });
    view.setPane('channel-browser');
  };

  // Every route to a channel list goes through here, because every one of them
  // can flood the window: the browser's own button, and `/list` typed into the
  // composer. A request that already names a pattern is somebody who has
  // narrowed it on purpose and is sent as asked; a bare one asks first.
  //
  // Both wait out the network's own gate first. A `LIST` sent in the first
  // minute and a half comes back as "unknown command", which is what the server
  // said and not what it meant, and passing that on teaches somebody that the
  // feature is broken rather than that it is early.
  const askForList = (networkId: string, pattern?: string): void => {
    const state = registry.networks.get(networkId);
    const readiness = listReadiness(state ?? { registeredAt: undefined });
    if (!readiness.ready) {
      toast(describeWait(state?.name ?? 'This network', readiness.waitSeconds), 'error');
      return;
    }
    if (pattern !== undefined && pattern !== '') {
      registry.sessionOf(networkId)?.listChannels(pattern);
      return;
    }
    setListing({ networkId, pattern: '' });
  };

  // Making a channel. There is no CREATE on IRC — a channel exists because
  // somebody is in it — so this joins a name nobody is using and then sets what
  // was asked for, which the join itself gives us the standing to do.
  const createChannel = (options: Parameters<typeof createChannelLines>[0]): void => {
    const networkId = creatingOn;
    setCreatingOn(undefined);
    if (networkId === undefined) {
      return;
    }
    const target = registry.sessionOf(networkId);
    for (const line of createChannelLines(options)) {
      target?.send(line);
    }
    view.select({ networkId, target: options.name });
  };

  const joinFromBrowser = (channel: string): void => {
    if (network === undefined) {
      return;
    }
    registry.sessionOf(network.id)?.join(channel);
    view.select({ networkId: network.id, target: channel });
  };

  /** Opens a direct message with someone, creating the conversation. */
  const messageMember = (nick: string): void => {
    if (network !== undefined) {
      view.select({ networkId: network.id, target: nick });
    }
  };

  // "View details" asks the network who somebody is and opens the profile card.
  // The card fills in as the reply arrives, so nobody sees the numerics behind
  // it — which is the whole point of the abstraction layer.
  const openProfile = (nick: string): void => {
    session?.send(`WHOIS ${nick} ${nick}`);
    setProfileNick(nick);
  };

  // The right-click / ⋯ menu for a member, built from what the user is actually
  // allowed to do on this network. This is the abstraction layer: the person
  // picks "Make an operator" and the MODE goes out underneath.
  /**
   * What each item in that menu does.
   *
   * Shared, because the same menu is opened from two places — the member list
   * on the right, and a name in the message list — and two copies of this is
   * how the two menus drift into offering different things.
   */
  const memberCallbacks = (target: Session): MemberActionCallbacks => ({
    onMessage: messageMember,
    onWhois: openProfile,
    onIgnore: (nick) => {
      target.addIgnore(nick);
      toast(`Ignoring ${nick}. You won't see their messages.`);
    },
    onSend: (line) => target.send(line),
    // Neither of these acts immediately. A ban is a decision about how wide
    // to cast it, and a removal is one somebody should be able to explain —
    // so both open a builder rather than firing a default.
    onBanBuilder: (member) => setActing({ member, kind: 'ban' }),
    onKickBuilder: (member) => setActing({ member, kind: 'kick' }),
    // The tables, which fetch what they show. This is the route to lifting
    // a ban the client has not seen yet, and the reason the menu's own
    // lift entries can be honest about only knowing what they know.
    onOpenList: (kind) => {
      setChannelPanelTab(kind);
      setChannelPanelOpen(true);
    },
    onKillBuilder: (member) => setKilling(member),
  });

  const memberMenu = (member: Member): readonly MenuItem[] => {
    if (network === undefined || conversation === undefined || session === undefined) {
      return [];
    }
    return memberActions(member, {
      network,
      channel: conversation,
      ourNick: network.nick,
      operator: isOperator,
      callbacks: memberCallbacks(session),
    });
  };

  // The same menu, opened from a name in the message list. Somebody who has
  // just read a line looks at the name on it, not at the column on the right,
  // and every other IRC client puts the actions there too.
  const nickMenuItems = (nick: string): readonly MenuItem[] => {
    if (network === undefined || session === undefined) {
      return [];
    }
    return nickActions(nick, {
      network,
      channel: conversation,
      ourNick: network.nick,
      operator: isOperator,
      callbacks: memberCallbacks(session),
    });
  };

  // The right-click menu for a network in the sidebar. Everything here is
  // reachable elsewhere; what right-click adds is reaching it from the thing
  // itself, which is where somebody looks first.
  const networkSidebarMenu = (state: NetworkState): readonly MenuItem[] => {
    const connected = state.phase === 'registered' || state.phase === 'registering';
    return [
      ...(connected
        ? [
            {
              id: 'join',
              label: 'Join a channel…',
              onSelect: () => setJoiningNetwork(state.id),
            },
            {
              id: 'browse',
              label: 'Browse channels',
              onSelect: () => browseChannels(state.id),
            },
          ]
        : []),
      {
        id: 'edit',
        label: 'Edit this network…',
        onSelect: () => setEditingId(state.id),
        startsGroup: connected,
      },
      {
        id: 'raw',
        label: 'Show the raw log',
        onSelect: () => {
          view.select({ networkId: state.id, target: undefined });
          view.setPane('raw-log');
        },
      },
      connected
        ? { id: 'disconnect', label: 'Disconnect', onSelect: () => disconnect(state.id) }
        : {
            id: 'connect',
            label: state.phase === 'connecting' ? 'Connecting…' : 'Connect',
            disabled: state.phase === 'connecting',
            onSelect: () => reconnect(state.id),
          },
      {
        id: 'remove',
        label: 'Remove this network',
        destructive: true,
        startsGroup: true,
        onSelect: () => removeNetwork(state.id),
      },
    ];
  };

  /** The right-click menu for a channel or a private conversation. */
  /** Whether a channel is on its network's automatic-join list. */
  const autojoinedOn = (networkId: string, target: string): boolean =>
    isAutojoined(
      registry.profiles.get(networkId)?.autojoin ?? [],
      target,
      registry.networks.get(networkId)?.support.caseMapping,
    );

  /**
   * Puts a channel on the automatic-join list, or takes it off.
   *
   * The profile is written back and saved, but the session is deliberately not
   * restarted: this changes what happens on the *next* connection, and
   * reconnecting somebody's network because they ticked a box would be a
   * startling amount of consequence for a menu item.
   */
  const toggleNetworkAutojoin = (state: NetworkState, target: string): void => {
    const profile = registry.profiles.get(state.id);
    if (profile === undefined) {
      return;
    }
    const autojoin = toggleAutojoin(profile.autojoin, target, state.support.caseMapping);
    registry.updateProfile(state.id, { autojoin });
    persist({
      networks: [...registry.profiles.values()].map((entry) =>
        entry.id === state.id ? { ...entry, autojoin } : entry,
      ),
    });
    toast(
      isAutojoined(autojoin, target, state.support.caseMapping)
        ? `${target} will be joined whenever ${state.name} connects.`
        : `${target} will no longer be joined automatically.`,
    );
  };

  const conversationSidebarMenu = (
    state: NetworkState,
    target: string,
    kind: 'channel' | 'person',
  ): readonly MenuItem[] => {
    const ref: TargetRef = { networkId: state.id, target };
    return [
      { id: 'open', label: 'Open', onSelect: () => view.select(ref) },
      {
        id: 'read',
        label: 'Mark as read',
        disabled: unreadFor(view, ref).count === 0,
        onSelect: () => view.markRead(ref),
      },
      {
        id: 'copy',
        label: kind === 'channel' ? 'Copy channel name' : 'Copy name',
        onSelect: () => void navigator.clipboard?.writeText(target),
      },
      // Whether this channel comes back on its own next time. The list has
      // always been in the profile and sent after registration; this is the
      // place somebody actually decides it, from the channel they are standing
      // in rather than by retyping its name into a form.
      ...(kind === 'channel'
        ? [
            {
              id: 'autojoin',
              label: autojoinedOn(state.id, target)
                ? 'Stop joining automatically'
                : 'Join automatically',
              startsGroup: true,
              onSelect: () => toggleNetworkAutojoin(state, target),
            },
          ]
        : []),
      // The keyboard and right-click path to what double-clicking the channel
      // name opens, so channel settings are not pointer-only.
      ...(kind === 'channel'
        ? [
            {
              id: 'settings',
              label: 'Channel settings…',
              onSelect: () => {
                view.select(ref);
                setChannelPanelTab('settings');
                setChannelPanelOpen(true);
              },
            },
          ]
        : []),
      kind === 'channel'
        ? {
            id: 'leave',
            label: 'Leave channel',
            destructive: true,
            startsGroup: true,
            onSelect: () => {
              registry.sessionOf(state.id)?.part(target);
              if (sameRef(view.selection, ref)) {
                view.select({ networkId: state.id, target: undefined });
              }
            },
          }
        : {
            id: 'close',
            label: 'Close conversation',
            destructive: true,
            startsGroup: true,
            onSelect: () => {
              registry.sessionOf(state.id)?.closeQuery(target);
              if (sameRef(view.selection, ref)) {
                view.select({ networkId: state.id, target: undefined });
              }
            },
          },
    ];
  };

  const send = (text: string): void => {
    if (session === undefined || selection === undefined || network === undefined) {
      return;
    }
    const parsed = parseInput(text, { target: selection.target, nick: network.nick });

    switch (parsed.kind) {
      case 'message':
        if (selection.target === undefined) {
          toast('Pick a conversation first, or use a command.', 'error');
          return;
        }
        session.sendMessage(selection.target, parsed.text);
        return;
      case 'line':
        // `/list` is the one command whose answer has nowhere to go in the
        // message list — a numeric per channel is exactly what CLAUDE.md says
        // never to render — so typing it opens the browser that consumes it,
        // and goes through the same guard as the button beside it.
        if (parsed.command.name === 'list') {
          view.setPane('channel-browser');
          askForList(network.id, parsed.line.slice('LIST'.length).trim());
          return;
        }
        session.send(parsed.line);
        return;
      case 'handled':
        // Only /me reaches here with a target, and only when there is none.
        toast(`${parsed.command.name} needs a conversation to act on.`, 'error');
        return;
      case 'unknown':
        toast(`No command called ${parsed.name}. Type / to see what there is.`, 'error');
    }
  };

  const loadOlder = (): void => {
    if (session === undefined || selection?.target === undefined || network === undefined) {
      return;
    }
    // The session applies its own guard; asking twice is harmless.
    if (requestOlder(network, selection.target).ok) {
      session.loadOlder(selection.target);
    }
  };

  // Empty where the window's bar carries the name, so the column below is
  // headed by whatever it is actually showing.
  const appName = windowChrome === undefined ? 'Marmotter' : '';

  const title =
    view.pane === 'channel-browser'
      ? `Channels on ${network?.name ?? 'this network'}`
      : view.pane === 'people'
        ? 'People'
        : view.pane === 'account'
          ? 'Your account'
          : view.pane === 'settings'
            ? 'Settings'
            : view.pane === 'dcc'
              ? 'Files'
              : selection === undefined
                ? // Nothing open, so nothing to name. Where the window has a
                  // bar of its own it already says which app this is, and
                  // repeating it here would be saying it twice; a browser tab
                  // has no such bar, so there it stays.
                  appName
                : (selection.target ?? network?.name ?? appName);

  // The right-hand column carries the member list, for a channel. The DCC file
  // monitor used to sit under it here; it now lives at the foot of the sidebar
  // instead, so it has a home whether or not a channel is open.
  // Whether this conversation has a member list at all, which is a different
  // question from whether it is open — and the one the control that opens it
  // has to be able to ask.
  const membersAvailable =
    conversation !== undefined &&
    selection?.target !== undefined &&
    network !== undefined &&
    isChannel(selection.target, network.support);
  const showMembers = view.memberListOpen && membersAvailable;
  const showDccPanel = view.userOptions.dccMonitorEnabled && dcc !== undefined;
  // While searching, the right-hand column shows the hits instead of the member
  // list — that is where CLAUDE-md-style the user asked to see every instance,
  // and it closes from its own corner as well as from the search bar.
  const showSearchResults = searchOpen && view.pane === 'chat' && conversation !== undefined;
  const asideOpen = showSearchResults || showMembers;
  const asideNode = showSearchResults ? (
    <MessageSearchResults
      query={searchQuery}
      scope={searchScope}
      matches={searchMatches}
      activeId={activeSearchId}
      onPick={(index) => setSearchIndex(index)}
      onClose={closeSearch}
      {...(network === undefined
        ? {}
        : { fold: (text: string) => fold(text, network.support.caseMapping) })}
    />
  ) : !showMembers || network === undefined || conversation === undefined ? undefined : (
    <div className="flex h-full w-full flex-col bg-[var(--bg-elevated)]">
      <MemberList
        className="min-h-0 flex-1"
        network={network}
        channel={conversation}
        menuFor={memberMenu}
        onMessage={messageMember}
        onOpenProfile={openProfile}
      />
    </div>
  );

  const toggleSettings = (): void => view.setPane(view.pane === 'settings' ? 'chat' : 'settings');

  // Settings live in the window's bar where there is one, next to the buttons
  // that drive the window, and in the sidebar header otherwise. One gear
  // either way: two would be two places to look.
  const titleBarNode =
    windowChrome === undefined ? undefined : (
      <TitleBar
        {...windowChrome}
        trailing={
          <IconButton
            label="Settings"
            size="small"
            pressed={view.pane === 'settings'}
            icon={<span aria-hidden="true">⚙</span>}
            onClick={toggleSettings}
          />
        }
      />
    );

  // The file monitor's home in the left column, under the networks.
  const dccMonitorNode = showDccPanel ? (
    <DccMonitorStrip
      active={view.dccActive}
      onStart={() => view.setDccActive(true)}
      onStop={() => view.setDccActive(false)}
      onOpen={() => view.setPane('dcc')}
    />
  ) : undefined;

  const main = (
    <>
      <NavBar
        title={title}
        {...(view.pane !== 'chat' ||
        conversation?.topic?.text === undefined ||
        conversation.topic.text === ''
          ? // The topic belongs to the conversation, not to the window: a pane
            // that has taken the column over — Files, Settings, the channel
            // browser — is named by its own title, and leaving the last
            // channel's topic under it described something nobody is looking at.
            {}
          : { subtitle: conversation.topic.text })}
        {...(view.pane === 'chat' &&
        conversation !== undefined &&
        selection?.target !== undefined &&
        network !== undefined &&
        isChannel(selection.target, network.support)
          ? {
              onTitleActivate: () => {
                setChannelPanelTab('settings');
                setChannelPanelOpen(true);
              },
              titleHint: 'Double-click to open channel settings',
            }
          : {})}
        {...(breakpoint === 'mobile'
          ? // No leading control on a phone. The channel list is opened by the
            // handle against the left edge of the conversation, which points at
            // where the panel comes from rather than sitting in a bar.
            {}
          : {
              leading: (
                <IconButton
                  label={view.sidebarCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
                  icon={<span aria-hidden="true">◧</span>}
                  onClick={() => view.setSidebarCollapsed(!view.sidebarCollapsed)}
                />
              ),
            })}
        trailing={
          <>
            {network === undefined || session === undefined ? null : (
              <AccountMenu
                network={network}
                onSetAway={(text) => session.setAway(text)}
                onChangeNick={(next) => session.send(`NICK ${next}`)}
                onOpenPeople={() => view.setPane('people')}
                onOpenAccount={() => view.setPane('account')}
              />
            )}
            {/* The raw log is the network's whole line stream, not one
                conversation's, so it belongs to the network rather than to
                whatever channel happens to be open. It appears on the server
                tab, which is the thing in the sidebar that means "the network
                itself" — from a channel it read as though it were that
                channel's log, which it never was. Selecting a conversation
                returns the pane to chat on its own. */}
            {network === undefined || selection?.target !== undefined ? null : (
              <IconButton
                label={view.pane === 'raw-log' ? 'Back to messages' : 'Show the raw log'}
                icon={<span aria-hidden="true">{'</>'}</span>}
                pressed={view.pane === 'raw-log'}
                onClick={() => view.setPane(view.pane === 'raw-log' ? 'chat' : 'raw-log')}
              />
            )}
            {view.pane === 'chat' &&
            conversation !== undefined &&
            selection?.target !== undefined &&
            network !== undefined ? (
              <>
                {/* Search takes the spot the channel-settings gear used to hold;
                    settings now open by double-clicking the channel name. */}
                <IconButton
                  label={searchOpen ? 'Close search' : 'Search this conversation'}
                  icon={<span aria-hidden="true">⌕</span>}
                  pressed={searchOpen}
                  onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
                />
                {conversationService !== undefined && isOperator ? (
                  <IconButton
                    label={`${serviceDisplayName(conversationService)} commands`}
                    icon={<span aria-hidden="true">⌘</span>}
                    pressed={serviceMenu !== undefined}
                    onClick={(event) =>
                      openServiceMenuUnder(conversationService, event.currentTarget)
                    }
                  />
                ) : null}
                {/* On a phone the member list has its own handle against the
                    right edge, so the bar keeps only what a wider layout needs:
                    there, the panel is a column and has no edge to come from. */}
                {breakpoint !== 'mobile' && isChannel(selection.target, network.support) ? (
                  <IconButton
                    label={view.memberListOpen ? 'Hide the member list' : 'Show the member list'}
                    icon={<span aria-hidden="true">≡</span>}
                    pressed={view.memberListOpen}
                    onClick={() => view.setMemberListOpen(!view.memberListOpen)}
                  />
                ) : null}
              </>
            ) : null}
          </>
        }
      />

      {view.pane === 'settings' ? (
        <Settings
          className="flex-1 overflow-y-auto"
          networks={networks}
          appearance={view.appearance}
          onAppearanceChange={view.updateAppearance}
          ctcp={view.ctcp}
          onCtcpChange={view.updateCtcp}
          userOptions={view.userOptions}
          onUserOptionsChange={view.updateUserOptions}
          {...(identity === undefined
            ? {}
            : { identity: { nick: identity.nick, onEdit: () => setSettingUp(true) } })}
          {...(logs === undefined
            ? {}
            : {
                logging: {
                  policy: view.logging,
                  onChange: view.updateLogging,
                  location: logLocation,
                  // Each of these is offered only where the platform can
                  // actually do it. Android has no folder picker, no save
                  // dialog, and no file manager that will open an app's own
                  // storage; a button that quietly did nothing would be worse
                  // than no button.
                  ...(chooseLogFolder === undefined ? {} : { onChooseFolder: changeLogFolder }),
                  ...(logs.reveal === undefined ? {} : { onOpenFolder: openLogFolder }),
                  ...(chooseExportFile === undefined ? {} : { onExport: exportLogs }),
                  onClear: clearLogs,
                  onPurgeNow: purgeLogsNow,
                  onSearch: () => view.setPane('log-search'),
                },
              })}
          dccAvailable={dcc !== undefined}
          {...(chooseDownloadFolder === undefined
            ? {}
            : { onChooseDownloadFolder: chooseDownloadFolder })}
          onReconnect={reconnect}
          onDisconnect={disconnect}
          onEdit={setEditingId}
          onRemove={removeNetwork}
          onAddNetwork={() => setAdding(true)}
          onExportConfig={() => setExportingConfig(true)}
          onImportConfig={() => setImportingConfig(true)}
          onResetSettings={() => {
            view.resetSettings();
            toast('Settings are back to their defaults. Your networks are untouched.');
          }}
        />
      ) : view.pane === 'dcc' ? (
        <DccBrowserPane
          className="flex-1 overflow-y-auto"
          downloadFolder={view.userOptions.downloadFolder}
          onDownload={downloadOffer}
          onCancel={cancelOffer}
          {...(chooseDownloadFolder === undefined ? {} : { onChooseFolder: chooseDownloadFolder })}
          {...(dcc?.revealFile === undefined ? {} : { onReveal: revealOffer })}
          onClear={clearOffers}
          onDismiss={dismissOffer}
          onRequestPack={requestPastedPack}
        />
      ) : view.pane === 'log-search' && logs !== undefined ? (
        <LogSearch className="min-h-0 flex-1" store={logs} />
      ) : view.pane === 'raw-log' && network !== undefined ? (
        <RawLog network={network} onCopy={(text) => void navigator.clipboard?.writeText(text)} />
      ) : view.pane === 'account' && network !== undefined && session !== undefined ? (
        <AccountPanel
          className="flex-1 overflow-y-auto"
          network={network}
          onSend={(line) => session.send(line)}
        />
      ) : view.pane === 'people' && network !== undefined && session !== undefined ? (
        <PeoplePanel
          className="flex-1 overflow-y-auto"
          network={network}
          onWatch={(nick) => {
            const rejected = session.addNotify([nick]);
            if (rejected.length > 0) {
              toast(`${network.name} will not watch any more names right now.`, 'error');
            }
          }}
          onUnwatch={(nick) => session.removeNotify([nick])}
          onMessage={messageMember}
          onIgnore={(mask, ignoreOptions) => session.addIgnore(mask, ignoreOptions)}
          onUnignore={(mask) => session.removeIgnore(mask)}
        />
      ) : view.pane === 'channel-browser' && network !== undefined ? (
        <ChannelBrowser
          network={network}
          onRefresh={(pattern) => askForList(network.id, pattern)}
          onJoin={joinFromBrowser}
          onCreate={() => setCreatingOn(network.id)}
          joined={
            new Set(
              [...network.channels.values()]
                .filter((channel) => channel.joined)
                .map((channel) => channel.name.toLowerCase()),
            )
          }
        />
      ) : launchOpen && networks.length > 0 && selection === undefined ? (
        <Launch
          className="flex-1"
          networks={networks.map((state) => ({
            id: state.id,
            name: state.name,
            status: connectionStatus(state),
            statusText: connectionStatusText(state),
            autojoin: (registry.profiles.get(state.id)?.autojoin ?? []).map(
              (entry) => entry.target,
            ),
          }))}
          onConnect={connectNetworks}
          onSkip={() => setLaunchOpen(false)}
          onAddNetwork={() => setAdding(true)}
        />
      ) : network === undefined || selection === undefined ? (
        <EmptyState
          className="flex-1"
          title={networks.length === 0 ? 'Nothing open yet' : 'Nothing open'}
          description={
            networks.length === 0
              ? 'Add a network to start talking.'
              : 'Pick a conversation on the left, or connect to a network you have set up.'
          }
          action={
            networks.length === 0 ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add a network
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setLaunchOpen(true)}>
                Choose networks to connect
              </Button>
            )
          }
        />
      ) : (
        <>
          <InviteBanner
            invites={network.invites}
            onAccept={(channelName) => {
              session?.join(channelName);
              view.select({ networkId: network.id, target: channelName });
            }}
            onDismiss={(channelName) => session?.dismissInvite(channelName)}
          />

          {conversation === undefined ? (
            <ServerPane
              network={network}
              onReconnect={() => reconnect(network.id)}
              onOpenRawLog={() => view.setPane('raw-log')}
              onBrowseChannels={() => browseChannels(network.id)}
              {...(isOperator ? { onServiceHelp: openServiceHelp } : {})}
            />
          ) : (
            <>
              {searchOpen ? (
                <MessageSearchBar
                  query={searchQuery}
                  onQueryChange={(next) => {
                    setSearchQuery(next);
                    setSearchIndex(0);
                  }}
                  scope={searchScope}
                  onScopeChange={(next) => {
                    setSearchScope(next);
                    setSearchIndex(0);
                  }}
                  matchCount={searchMatches.length}
                  activeOrdinal={searchMatches.length === 0 ? 0 : activeSearchPos + 1}
                  onPrev={() => stepSearch(-1)}
                  onNext={() => stepSearch(1)}
                  onClose={closeSearch}
                />
              ) : null}
              <MessageList
                network={network}
                conversation={conversation}
                nickWidth={view.appearance.nickColumnWidth}
                alignNicksRight={view.appearance.alignNicksRight}
                showTimestamps={view.appearance.showTimestamps}
                foldEvents={view.appearance.foldEvents}
                onLoadOlder={loadOlder}
                isHighlight={(message) =>
                  isHighlight(message.text, network.nick, view.appearance.highlightWords)
                }
                onNickClick={(nick) => view.select({ networkId: network.id, target: nick })}
                onNickMenu={(nick, at) => setNickMenu({ nick, ...at })}
                onOpenLink={(href) => setLinkToOpen(href)}
                {...(searchOpen ? { searchMatchIds } : {})}
                {...(activeSearchId === undefined ? {} : { searchActiveId: activeSearchId })}
              />
            </>
          )}

          {/* The composer is on the server tab too, where it takes commands
              only. Without it there is nowhere to type `/join` before the
              first channel exists, and a client you cannot get into a channel
              from is not a client. */}
          <Composer
            value={draftFor(view, selection)}
            onChange={(text) => view.setDraft(selection, text)}
            onSend={send}
            target={selection.target ?? network.name}
            commandsOnly={conversation === undefined}
            nicks={
              conversation === undefined
                ? []
                : [...conversation.members.values()].map((entry) => entry.nick)
            }
            channels={[...network.channels.values()].map((entry) => entry.name)}
            fold={(text) => fold(text, network.support.caseMapping)}
            operatorCommands={registry.profiles.get(network.id)?.operatorCommands === true}
            {...(conversationService !== undefined && isOperator
              ? {
                  onServiceMenu: (at: { x: number; y: number }) =>
                    openServiceMenu(conversationService, at),
                }
              : {})}
            disabled={network.phase !== 'registered'}
            disabledReason="Not connected yet"
          />
        </>
      )}
    </>
  );

  return (
    <>
      {resizeWindow === undefined ? null : <WindowResizeHandles onResize={resizeWindow} />}
      <AppShell
        {...(titleBarNode === undefined ? {} : { titleBar: titleBarNode })}
        sidebarCollapsed={view.sidebarCollapsed}
        sidebarOpen={drawerOpen}
        onCloseSidebar={() => setDrawerOpen(false)}
        // The shell draws the handles against the screen edges; the bottom bar
        // carries the same two controls otherwise. One placement or the other,
        // never both — two ways to open one panel is one too many.
        {...(view.appearance.sidePanelsAtEdges
          ? {
              onOpenSidebar: () => setDrawerOpen(true),
              ...(membersAvailable ? { onOpenAside: () => view.setMemberListOpen(true) } : {}),
            }
          : {})}
        asideOpen={asideOpen}
        onCloseAside={() => view.setMemberListOpen(false)}
        sidebar={
          <Sidebar
            networks={networks}
            selection={view.selection}
            onSelect={(ref) => {
              view.select(ref);
              setDrawerOpen(false);
            }}
            unreadFor={(ref) => unreadFor(view, ref)}
            collapsed={view.collapsed}
            onToggleCollapsed={view.toggleCollapsed}
            onReorder={view.reorderNetworks}
            onAddNetwork={() => setAdding(true)}
            onOpenSettings={toggleSettings}
            settingsOpen={view.pane === 'settings'}
            showSettingsButton={windowChrome === undefined}
            onJoinChannel={(networkId) => setJoiningNetwork(networkId)}
            onBrowseChannels={browseChannels}
            showBrowseChannelsShortcut={view.appearance.showBrowseChannelsShortcut}
            networkMenu={networkSidebarMenu}
            conversationMenu={conversationSidebarMenu}
            {...(dccMonitorNode === undefined ? {} : { footer: dccMonitorNode })}
          />
        }
        aside={asideNode}
        tabBar={
          breakpoint === 'mobile' ? (
            <TabBar
              value={view.pane === 'chat' ? 'chats' : view.pane === 'dcc' ? 'dcc' : 'settings'}
              onChange={(value) =>
                view.setPane(value === 'chats' ? 'chat' : value === 'dcc' ? 'dcc' : 'settings')
              }
              // The two side panels, at the ends of the row where a thumb
              // already is. Moved to the screen edges by a setting, and then
              // drawn there instead of here rather than as well.
              {...(view.appearance.sidePanelsAtEdges
                ? {}
                : {
                    leading: (
                      <IconButton
                        label="Show channels"
                        size="small"
                        icon={<span aria-hidden="true">›</span>}
                        onClick={() => setDrawerOpen(true)}
                      />
                    ),
                    ...(membersAvailable
                      ? {
                          trailing: (
                            <IconButton
                              label={
                                view.memberListOpen
                                  ? 'Hide the member list'
                                  : 'Show the member list'
                              }
                              size="small"
                              pressed={view.memberListOpen}
                              icon={<span aria-hidden="true">‹</span>}
                              onClick={() => view.setMemberListOpen(!view.memberListOpen)}
                            />
                          ),
                        }
                      : {}),
                  })}
              // Files earns a tab only once the monitor is switched on, and
              // then it needs one: its home everywhere else is the foot of the
              // sidebar, and on a phone the sidebar is a drawer — so a download
              // in progress would be two gestures and a scroll away, behind
              // something a person opened to change channel.
              items={[
                { value: 'chats', label: 'Chats', icon: <span aria-hidden="true">◍</span> },
                ...(showDccPanel
                  ? [
                      {
                        value: 'dcc' as const,
                        label: 'Files',
                        icon: <span aria-hidden="true">⤓</span>,
                        ...(activeTransfers === 0 ? {} : { badge: activeTransfers }),
                      },
                    ]
                  : []),
                { value: 'settings', label: 'Settings', icon: <span aria-hidden="true">⚙</span> },
              ]}
            />
          ) : undefined
        }
        main={main}
      />

      <ExportConfig
        open={exportingConfig}
        onClose={() => setExportingConfig(false)}
        text={configText}
        {...(configFile === undefined ? {} : { onSaveFile: configFile.save })}
        onReport={toast}
      />

      <ImportConfig
        open={importingConfig}
        onClose={() => setImportingConfig(false)}
        onApply={applyConfig}
        {...(configFile === undefined ? {} : { onOpenFile: configFile.open })}
        paths={devicePaths}
        onReport={toast}
      />

      <AddNetwork
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={addNetwork}
        {...(identity === undefined ? {} : { defaultIdentity: identity })}
        remembersPasswords={remembersPasswords}
      />

      {editingProfile === undefined ? null : (
        <AddNetwork
          open
          editing={editingProfile}
          onClose={() => setEditingId(undefined)}
          onAdd={saveNetwork}
          remembersPasswords={remembersPasswords}
        />
      )}

      {listingNetwork === undefined || listing === undefined ? null : (
        <ListPrompt
          open
          networkName={listingNetwork.name}
          {...(listingNetwork.channelCount === undefined
            ? {}
            : { channelCount: listingNetwork.channelCount })}
          limit={CHANNEL_LIST_LIMIT}
          initialPattern={listing.pattern}
          onCancel={() => setListing(undefined)}
          onConfirm={(pattern) => {
            registry.sessionOf(listing.networkId)?.listChannels(pattern);
            setListing(undefined);
          }}
        />
      )}

      {creatingNetwork === undefined ? null : (
        <CreateChannel
          open
          networkName={creatingNetwork.name}
          prefix={creatingNetwork.support.chanTypes[0] ?? '#'}
          supportsSecret={creatingNetwork.support.chanModes.flag.includes('s')}
          onCreate={createChannel}
          onCancel={() => setCreatingOn(undefined)}
        />
      )}

      {/* The first thing Marmotter asks, and the thing Settings reopens. Held
          back until the saved identity has been read, so it does not flash up
          in front of somebody who answered it last week. */}
      {identity === undefined ? null : (
        <FirstRun
          open={settingUp}
          initial={identity}
          confirmLabel={identity.nick === '' ? 'Continue' : 'Save'}
          onDone={saveIdentity}
          onSkip={() => setSettingUp(false)}
        />
      )}

      <TextPrompt
        open={joiningNetwork !== undefined}
        title="Join a channel"
        label="Channel name"
        placeholder="#marmotter"
        hint="The # is added for you if you leave it off."
        confirmLabel="Join"
        onConfirm={joinChannel}
        onCancel={() => setJoiningNetwork(undefined)}
      />

      {/* The second half of a refused join: the network said the channel needs
          a password, and this is where it goes. Typing it retries the join —
          nobody should have to find the command that carries one. */}
      <TextPrompt
        open={channelKeyFor !== undefined}
        title={
          channelKeyFor === undefined ? 'Channel password' : `Password for ${channelKeyFor.channel}`
        }
        label="Password"
        placeholder="The channel's password"
        hint="Whoever runs the channel sets this and passes it on. Marmotter does not keep it."
        confirmLabel="Join"
        onConfirm={(key) => {
          const pending = channelKeyFor;
          setChannelKeyFor(undefined);
          if (pending === undefined || key.trim() === '') {
            return;
          }
          registry.sessionOf(pending.networkId)?.join(pending.channel, key.trim());
          view.select({ networkId: pending.networkId, target: pending.channel });
        }}
        onCancel={() => setChannelKeyFor(undefined)}
      />

      {/* Disconnecting somebody is a server operator's action and asks for a
          reason, because the person on the other end is shown it and because a
          reason is the difference between a record and a mystery. It does not
          keep them off the network — they can reconnect — and the copy says so
          rather than letting somebody expect otherwise. */}
      <TextPrompt
        open={killing !== undefined}
        title={killing === undefined ? 'Disconnect' : `Disconnect ${killing.nick}`}
        label="Reason"
        placeholder="Why they are being disconnected"
        hint="They are shown this, and can reconnect straight away. To keep somebody out of a channel, ban them instead."
        confirmLabel="Disconnect"
        onConfirm={(reason) => {
          const target = killing;
          setKilling(undefined);
          if (target === undefined || session === undefined) {
            return;
          }
          session.send(`KILL ${target.nick} :${reason.trim()}`);
          toast(`Asked the network to disconnect ${target.nick}.`);
        }}
        onCancel={() => setKilling(undefined)}
      />

      {network === undefined ||
      conversation === undefined ||
      session === undefined ||
      selection?.target === undefined ||
      !isChannel(selection.target, network.support) ? null : (
        <>
          <ChannelPanel
            open={channelPanelOpen}
            initialTab={channelPanelTab}
            onClose={() => setChannelPanelOpen(false)}
            network={network}
            channel={conversation}
            onSend={(line) => session.send(line)}
            canModerate={canModerateChannel(network, conversation, network.nick)}
            onInvite={(nick) => {
              session.invite(nick, conversation.name);
              toast(`Invited ${nick} to ${conversation.name}.`);
            }}
            inviteSuggestions={[...network.notify.values()]
              .filter((entry) => entry.online)
              .map((entry) => entry.nick)}
          />

          {acting === undefined ? null : acting.kind === 'ban' ? (
            <BanDialog
              open
              onClose={() => setActing(undefined)}
              network={network}
              channel={conversation}
              member={acting.member}
              onSend={(line) => session.send(line)}
            />
          ) : (
            <KickDialog
              open
              onClose={() => setActing(undefined)}
              channel={conversation}
              member={acting.member}
              onSend={(line) => session.send(line)}
            />
          )}
        </>
      )}

      {profileNick === undefined || network === undefined ? null : (
        <WhoisCard
          open
          nick={profileNick}
          network={network}
          onClose={() => setProfileNick(undefined)}
          onMessage={messageMember}
        />
      )}

      <Modal
        open={linkToOpen !== undefined}
        onClose={() => setLinkToOpen(undefined)}
        title="Open this link?"
        confirmLabel="Open link"
        onConfirm={openConfirmedLink}
        message={
          <>
            <p>
              This opens in your web browser, outside Marmotter. Links can be unsafe — open one only
              if you trust where it goes.
            </p>
            {linkToOpen === undefined ? null : (
              <p className="mt-2 font-mono text-footnote break-all text-[var(--label-tertiary)]">
                {linkToOpen}
              </p>
            )}
          </>
        }
      />

      {nickMenu === undefined ? null : (
        <ContextMenu
          open
          label={`Actions for ${nickMenu.nick}`}
          at={{ x: nickMenu.x, y: nickMenu.y }}
          items={nickMenuItems(nickMenu.nick)}
          onClose={() => setNickMenu(undefined)}
        />
      )}

      {serviceMenu === undefined ? null : (
        <ContextMenu
          open
          label={serviceMenu.label}
          at={{ x: serviceMenu.x, y: serviceMenu.y }}
          items={serviceMenu.items}
          onClose={() => setServiceMenu(undefined)}
        />
      )}

      <ToastRegion
        toasts={toasts}
        dismissMs={view.userOptions.toastSeconds * 1000}
        onDismiss={dismissToast}
      />

      {persists ? null : (
        <p className="sr-only">
          Nothing is stored on this device. Closing this tab discards the conversation.
        </p>
      )}
    </>
  );
}

/**
 * The file monitor strip, subscribed to the offer count on its own.
 *
 * The count is the one thing here that moves, and on a packlist channel it moves
 * thousands of times a minute. Reading it in this small component keeps those
 * updates to this strip rather than re-rendering the client around it.
 */
function DccMonitorStrip({
  active,
  onStart,
  onStop,
  onOpen,
}: {
  active: boolean;
  onStart: () => void;
  onStop: () => void;
  onOpen: () => void;
}): ReactNode {
  const seen = useView((state) => state.dccOffers.length);
  return (
    <DccMonitorPanel
      active={active}
      seen={seen}
      onStart={onStart}
      onStop={onStop}
      onOpen={onOpen}
    />
  );
}

/**
 * The file browser, subscribed to the offer list on its own.
 *
 * Same reason as the strip above, and it matters most here: a download reports
 * progress every megabyte, and each of those has to redraw the row it belongs
 * to. It must not also redraw the message list behind this pane.
 */
function DccBrowserPane(props: Omit<DccBrowserProps, 'offers'>): ReactNode {
  const offers = useView((state) => state.dccOffers);
  return <DccBrowser {...props} offers={offers} />;
}

/** The server tab: the network's own notices and MOTD. */
function ServerPane({
  network,
  onReconnect,
  onOpenRawLog,
  onBrowseChannels,
  onServiceHelp,
}: {
  network: NetworkState;
  onReconnect: () => void;
  onOpenRawLog?: () => void;
  onBrowseChannels?: () => void;
  /** Opens NickServ / ChanServ and asks for its help. Operator networks only. */
  onServiceHelp?: (service: ServiceName) => void;
}): ReactNode {
  // The services shortcuts, shown on the server tab of a network the user
  // operates: a one-click way into the NickServ and ChanServ conversations,
  // where the command menus live.
  const servicesBar =
    onServiceHelp === undefined || network.phase !== 'registered' ? null : (
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-footnote text-[var(--label-tertiary)]">Services:</span>
        <Button variant="secondary" size="small" onClick={() => onServiceHelp('nickserv')}>
          NickServ help
        </Button>
        <Button variant="secondary" size="small" onClick={() => onServiceHelp('chanserv')}>
          ChanServ help
        </Button>
      </div>
    );
  // A dropped or refused connection is shown as what it is, with the reason and
  // a way to try again — not as an indefinite "connecting" that never resolves,
  // which is what the server tab used to do for every failure.
  if (network.phase === 'disconnected' && network.lastClose?.kind !== 'user') {
    // The server's own last word — a ban message, a G-line reason — is more
    // specific than the transport's close reason, so it leads when there is one.
    const serverReason = [...network.serverNotices]
      .reverse()
      .find((notice) => notice.kind === 'error');

    return (
      <EmptyState
        className="flex-1"
        title={`Couldn't connect to ${network.name}`}
        description={serverReason?.text ?? describeClose(network)}
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={onReconnect}>
              Try again
            </Button>
            {onOpenRawLog === undefined ? null : (
              <Button variant="secondary" onClick={onOpenRawLog}>
                See what happened
              </Button>
            )}
          </div>
        }
      />
    );
  }

  if (network.phase === 'connecting' || network.phase === 'registering') {
    return (
      <EmptyState
        className="flex-1"
        title={network.phase === 'connecting' ? 'Connecting…' : 'Signing in…'}
        description={`Reaching ${network.name}.`}
      />
    );
  }

  if (network.serverNotices.length === 0 && network.motd.length === 0) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        {servicesBar === null ? null : <div className="px-4 pt-3">{servicesBar}</div>}
        <EmptyState
          className="flex-1"
          title={network.phase === 'registered' ? 'Connected' : 'Not connected'}
          description={
            network.phase === 'registered'
              ? 'Browse what this network has, or join a channel by name from the sidebar.'
              : 'This network is not connected.'
          }
          {...(network.phase !== 'registered'
            ? {
                action: (
                  <Button variant="primary" onClick={onReconnect}>
                    Connect
                  </Button>
                ),
              }
            : onBrowseChannels === undefined
              ? {}
              : {
                  action: (
                    <Button variant="primary" onClick={onBrowseChannels}>
                      Browse channels
                    </Button>
                  ),
                })}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2">
      {servicesBar}
      {network.motd.length === 0 ? null : (
        <details className="mb-3 rounded-card bg-[var(--bg-elevated)] p-3">
          <summary className="cursor-pointer text-subhead text-[var(--label-secondary)]">
            Message of the day
          </summary>
          <pre className="mt-2 font-mono text-caption-1 whitespace-pre-wrap text-[var(--label-tertiary)]">
            {network.motd.join('\n')}
          </pre>
        </details>
      )}

      <ol className="flex flex-col gap-0.5">
        {network.serverNotices.map((notice) => (
          <li
            key={notice.id}
            className={
              notice.kind === 'error'
                ? 'font-mono text-footnote text-[var(--danger)]'
                : 'font-mono text-footnote text-[var(--label-secondary)]'
            }
          >
            {notice.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : 'The connection could not be opened.';

/** A close reason as a sentence, for the server tab. */
function describeClose(network: NetworkState): string {
  const close = network.lastClose;
  if (close === undefined || close.kind === 'user') {
    return 'Not connected.';
  }
  switch (close.kind) {
    case 'tls-error':
      return `The server's certificate could not be verified: ${close.message}. If this is your own server, change its security setting when you add it.`;
    case 'timeout':
      return 'The server did not respond in time. It may be down, or the address or port may be wrong.';
    case 'server':
      return 'The server closed the connection before sign-in finished.';
    case 'network-error':
      return close.message === ''
        ? 'The server could not be reached. Check the address and port.'
        : `The server could not be reached: ${close.message}`;
  }
}
