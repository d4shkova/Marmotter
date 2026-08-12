import {
  CHANNEL_LIST_LIMIT,
  type Member,
  type NetworkState,
  type Session,
  type SessionOptions,
  connectErrorReason,
  createSession,
  requestOlder,
  useNetworks,
} from '@marmotter/client';
import { fold, isChannel, type DccSend, type XdccPack } from '@marmotter/protocol';
import { effectivePolicy, retentionCutoff } from '@marmotter/client';
import type {
  LogLocation,
  LogStore,
  LoggingPolicy,
  NetworkProfile,
  Transport,
} from '@marmotter/shared';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TabBar } from '../layout/TabBar.js';
import { NavBar } from '../layout/NavBar.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { IconButton } from '../primitives/IconButton.js';
import { Modal } from '../primitives/Modal.js';
import { ToastRegion, type ToastMessage } from '../primitives/Toast.js';
import { AccountMenu } from './AccountMenu.js';
import { AccountPanel } from './AccountPanel.js';
import { AddNetwork } from './AddNetwork.js';
import { AppShell, useBreakpoint } from './AppShell.js';
import { ChannelBrowser } from './ChannelBrowser.js';
import { ChannelPanel, type TabValue as ChannelPanelTab } from './ChannelPanel.js';
import { Composer } from './Composer.js';
import { DccBrowser } from './DccBrowser.js';
import { DccMonitorPanel } from './DccMonitorPanel.js';
import type { DccCapability } from './dcc.js';
import { InviteBanner } from './Invites.js';
import { CreateChannel, createChannelLines } from './CreateChannel.js';
import { ListPrompt } from './ListPrompt.js';
import { describeWait, listReadiness } from './list-guard.js';
import { readSecret } from './secrets.js';
import { BanDialog, KickDialog } from './MemberDialogs.js';
import { MemberList } from './MemberList.js';
import { MessageList } from './MessageList.js';
import { MessageSearchBar, MessageSearchResults, findMatches } from './MessageSearch.js';
import { RawLog } from './RawLog.js';
import { PeoplePanel } from './PeoplePanel.js';
import { Settings } from './Settings.js';
import { LogSearch } from './LogSearch.js';
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
import { canModerateChannel, memberActions } from './member-actions.js';
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
  classifyDccReoffer,
  draftFor,
  isHighlight,
  orderNetworks,
  sameRef,
  unreadFor,
  useView,
} from './view-store.js';

/**
 * The ceiling on one export.
 *
 * An export reads every matching line into memory to write it out, so it has to
 * have one. High enough that an ordinary person exports everything they have;
 * the number is stated in the file when it bites.
 */
const EXPORT_LIMIT = 1_000_000;

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
}: MarmotterProps): ReactNode {
  const registry = useNetworks();
  const view = useView();
  const breakpoint = useBreakpoint();

  const [adding, setAdding] = useState(false);
  /** The network whose saved settings are open for changing, if any. */
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  /** The network a channel is being created on, if the form is open. */
  const [creatingOn, setCreatingOn] = useState<string | undefined>(undefined);
  /** The network waiting to be asked for its channel list, and with what. */
  const [listing, setListing] = useState<{ networkId: string; pattern: string } | undefined>(
    undefined,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  /** A network waiting for a channel name from the "Join a channel" prompt. */
  const [joiningNetwork, setJoiningNetwork] = useState<string | undefined>(undefined);
  /** Whose profile card is open, if any. */
  const [profileNick, setProfileNick] = useState<string | undefined>(undefined);
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
  /** In-conversation search: whether it is open, what for, and where in the hits. */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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

  const toast = useCallback(
    (text: string, tone: ToastMessage['tone'] = 'info', action?: ToastMessage['action']) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((current) => [
        ...current,
        { id, text, tone, ...(action === undefined ? {} : { action }) },
      ]);
    },
    [],
  );

  const networks = useMemo(
    () =>
      orderNetworks([...registry.profiles.keys()], view.networkOrder).flatMap((id) => {
        const state = registry.networks.get(id);
        return state === undefined ? [] : [state];
      }),
    [registry.profiles, registry.networks, view.networkOrder],
  );

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

  const searchMatches = useMemo(
    () =>
      searchOpen && conversation !== undefined
        ? findMatches(conversation.messages, searchQuery)
        : [],
    [searchOpen, conversation, searchQuery],
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
    void logs?.reveal().catch((error: unknown) => logError(String(error)));
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
      const built: Session = createSession({
        profile,
        transport: createTransport(profile),
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

  const addNetwork = (profile: NetworkProfile): void => {
    startSession(profile);
    view.select({ networkId: profile.id, target: undefined });
  };

  const reconnect = (networkId: string): void => {
    const profile = registry.profiles.get(networkId);
    if (profile !== undefined) {
      startSession(profile);
    }
  };

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
    setEditingId(undefined);
    toast(
      live
        ? `Reconnecting to ${profile.name} with the new settings.`
        : `Saved. ${profile.name} will connect with the new settings.`,
    );
  };

  const removeNetwork = (networkId: string): void => {
    registry.removeProfile(networkId);
    view.forgetNetwork(networkId);
  };

  const disconnect = (networkId: string): void => {
    registry.sessionOf(networkId)?.disconnect();
  };

  // Choosing where downloaded files go. Reading the platform's own folder
  // picker, so the path is a real one the shell can write to rather than
  // something typed by hand.
  const chooseDownloadFolder = useCallback((): void => {
    if (dcc === undefined) {
      return;
    }
    void dcc.chooseDownloadFolder().then((folder) => {
      if (folder !== undefined && folder !== '') {
        useView.getState().updateUserOptions({ downloadFolder: folder });
      }
    });
  }, [dcc]);

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
      useView.getState().setDccOfferStatus(offerId, { status: 'downloading' });
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
          toast(`Saved ${source.filename}.`);
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
          toast(`Couldn't download ${source.filename}. ${describe(error)}`, 'error');
        });
    },
    [dcc, toast],
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
      toast(`Stopped downloading ${offer.filename}.`);
    },
    [toast],
  );

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
    toast(
      `Couldn't verify ${profile.name}'s certificate — it isn't signed by an authority your device recognises. Connect without checking it?`,
      'error',
      { label: 'Connect anyway', onSelect: () => acceptUnverifiedCert(profile) },
    );
  };

  // XDCC downloads requested but not yet answered, keyed by network + folded bot
  // nick, each a queue of offer ids. The bot's eventual DCC SEND is matched back
  // to the oldest outstanding request from that bot.
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

  // A direct DCC SEND arriving. If it answers an XDCC request we made, it fills
  // that row and downloads; otherwise it is an unsolicited offer of its own.
  const handleDccOffer = useRef<
    (networkId: string, networkName: string, from: string, target: string, send: DccSend) => void
  >(() => {});
  handleDccOffer.current = (networkId, networkName, from, target, send) => {
    const key = pendingKey(networkId, from);
    const queue = pendingXdcc.current.get(key);
    if (queue !== undefined && queue.length > 0) {
      const [offerId, ...rest] = queue;
      if (rest.length > 0) {
        pendingXdcc.current.set(key, rest);
      } else {
        pendingXdcc.current.delete(key);
      }
      if (offerId === undefined) {
        return;
      }
      if (send.passive) {
        useView.getState().setDccOfferStatus(offerId, {
          status: 'failed',
          error: "The bot sent a passive transfer, which Marmotter can't fetch.",
        });
        return;
      }
      fetchIntoFolder(offerId, {
        host: send.host,
        port: send.port,
        filename: send.filename,
        ...(send.size === undefined ? {} : { size: send.size }),
      });
      return;
    }
    // Not matched to a request still in its queue. A DCC SEND that matches a
    // file already on the list is the serving bot re-offering it, not a new
    // file; the classifier decides whether that means retrying a failed row,
    // ignoring a duplicate, or listing a genuinely new offer.
    const foldedFrom = pendingKey(networkId, from);
    const existing = useView
      .getState()
      .dccOffers.find(
        (entry) =>
          entry.filename === send.filename &&
          pendingKey(entry.networkId, entry.from) === foldedFrom,
      );
    switch (classifyDccReoffer(existing, send)) {
      case 'retry':
        // `existing` is defined on this branch; retry that same row at the
        // address this re-offer advertises.
        if (existing !== undefined) {
          fetchIntoFolder(existing.id, {
            host: send.host,
            port: send.port,
            filename: send.filename,
            ...(send.size === undefined ? {} : { size: send.size }),
          });
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
        toast(`Requested pack #${offer.pack} from ${offer.from}.`);
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
    [registry, toast, fetchIntoFolder, pendingKey],
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
  const memberMenu = (member: Member): readonly MenuItem[] => {
    if (network === undefined || conversation === undefined || session === undefined) {
      return [];
    }
    return memberActions(member, {
      network,
      channel: conversation,
      ourNick: network.nick,
      operator: isOperator,
      callbacks: {
        onMessage: messageMember,
        onWhois: openProfile,
        onIgnore: (nick) => {
          session.addIgnore(nick);
          toast(`Ignoring ${nick}. You won't see their messages.`);
        },
        onSend: (line) => session.send(line),
        // Neither of these acts immediately. A ban is a decision about how wide
        // to cast it, and a removal is one somebody should be able to explain —
        // so both open a builder rather than firing a default.
        onBanBuilder: (target) => setActing({ member: target, kind: 'ban' }),
        onKickBuilder: (target) => setActing({ member: target, kind: 'kick' }),
        // The tables, which fetch what they show. This is the route to lifting
        // a ban the client has not seen yet, and the reason the menu's own
        // lift entries can be honest about only knowing what they know.
        onOpenList: (kind) => {
          setChannelPanelTab(kind);
          setChannelPanelOpen(true);
        },
        onKillBuilder: (target) => setKilling(target),
      },
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
                ? 'Marmotter'
                : (selection.target ?? network?.name ?? 'Marmotter');

  // The right-hand column carries the member list, for a channel. The DCC file
  // monitor used to sit under it here; it now lives at the foot of the sidebar
  // instead, so it has a home whether or not a channel is open.
  const showMembers =
    view.memberListOpen &&
    conversation !== undefined &&
    selection?.target !== undefined &&
    network !== undefined &&
    isChannel(selection.target, network.support);
  const showDccPanel = view.userOptions.dccMonitorEnabled && dcc !== undefined;
  // While searching, the right-hand column shows the hits instead of the member
  // list — that is where CLAUDE-md-style the user asked to see every instance,
  // and it closes from its own corner as well as from the search bar.
  const showSearchResults = searchOpen && view.pane === 'chat' && conversation !== undefined;
  const asideOpen = showSearchResults || showMembers;
  const asideNode = showSearchResults ? (
    <MessageSearchResults
      query={searchQuery}
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

  // The file monitor's home in the left column, under the networks.
  const dccMonitorNode = showDccPanel ? (
    <DccMonitorPanel
      active={view.dccActive}
      seen={view.dccOffers.length}
      onStart={() => view.setDccActive(true)}
      onStop={() => view.setDccActive(false)}
      onOpen={() => view.setPane('dcc')}
    />
  ) : undefined;

  const main = (
    <>
      <NavBar
        title={title}
        {...(conversation?.topic?.text === undefined || conversation.topic.text === ''
          ? {}
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
        leading={
          breakpoint === 'mobile' ? (
            <IconButton
              label="Show channels"
              icon={<span aria-hidden="true">☰</span>}
              onClick={() => setDrawerOpen(true)}
            />
          ) : (
            <IconButton
              label={view.sidebarCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
              icon={<span aria-hidden="true">◧</span>}
              onClick={() => view.setSidebarCollapsed(!view.sidebarCollapsed)}
            />
          )
        }
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
                {isChannel(selection.target, network.support) ? (
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
          {...(logs === undefined
            ? {}
            : {
                logging: {
                  policy: view.logging,
                  onChange: view.updateLogging,
                  location: logLocation,
                  onChooseFolder: changeLogFolder,
                  onOpenFolder: openLogFolder,
                  onExport: exportLogs,
                  onClear: clearLogs,
                  onPurgeNow: purgeLogsNow,
                  onSearch: () => view.setPane('log-search'),
                },
              })}
          dccAvailable={dcc !== undefined}
          onChooseDownloadFolder={chooseDownloadFolder}
          onReconnect={reconnect}
          onDisconnect={disconnect}
          onEdit={setEditingId}
          onRemove={removeNetwork}
          onAddNetwork={() => setAdding(true)}
        />
      ) : view.pane === 'dcc' ? (
        <DccBrowser
          className="flex-1 overflow-y-auto"
          offers={view.dccOffers}
          downloadFolder={view.userOptions.downloadFolder}
          onDownload={downloadOffer}
          onCancel={cancelOffer}
          onChooseFolder={chooseDownloadFolder}
          {...(dcc?.revealFile === undefined ? {} : { onReveal: revealOffer })}
          onClear={view.clearDccOffers}
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
      ) : network === undefined || selection === undefined ? (
        <EmptyState
          className="flex-1"
          title="Nothing open yet"
          description="Add a network to start talking."
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add a network
            </Button>
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
      <AppShell
        sidebarCollapsed={view.sidebarCollapsed}
        sidebarOpen={drawerOpen}
        onCloseSidebar={() => setDrawerOpen(false)}
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
            onOpenSettings={() => view.setPane(view.pane === 'settings' ? 'chat' : 'settings')}
            settingsOpen={view.pane === 'settings'}
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
              value={view.pane === 'chat' ? 'chats' : view.pane}
              onChange={(value) => view.setPane(value === 'chats' ? 'chat' : 'settings')}
              items={[
                { value: 'chats', label: 'Chats', icon: <span aria-hidden="true">◍</span> },
                { value: 'settings', label: 'Settings', icon: <span aria-hidden="true">⚙</span> },
              ]}
            />
          ) : undefined
        }
        main={main}
      />

      <AddNetwork open={adding} onClose={() => setAdding(false)} onAdd={addNetwork} />

      {editingProfile === undefined ? null : (
        <AddNetwork
          open
          editing={editingProfile}
          onClose={() => setEditingId(undefined)}
          onAdd={saveNetwork}
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
        onDismiss={(id) => setToasts((current) => current.filter((entry) => entry.id !== id))}
      />

      {persists ? null : (
        <p className="sr-only">
          Nothing is stored on this device. Closing this tab discards the conversation.
        </p>
      )}
    </>
  );
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
