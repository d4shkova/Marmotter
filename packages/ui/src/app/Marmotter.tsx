import {
  type Member,
  type NetworkState,
  type Session,
  type SessionOptions,
  createSession,
  requestOlder,
  useNetworks,
} from '@marmotter/client';
import { fold, isChannel } from '@marmotter/protocol';
import type { NetworkProfile, Transport } from '@marmotter/shared';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TabBar } from '../layout/TabBar.js';
import { NavBar } from '../layout/NavBar.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { IconButton } from '../primitives/IconButton.js';
import { ToastRegion, type ToastMessage } from '../primitives/Toast.js';
import { AddNetwork } from './AddNetwork.js';
import { AppShell, useBreakpoint } from './AppShell.js';
import { ChannelBrowser } from './ChannelBrowser.js';
import { ChannelPanel } from './ChannelPanel.js';
import { Composer } from './Composer.js';
import { BanDialog, KickDialog } from './MemberDialogs.js';
import { MemberList } from './MemberList.js';
import { MessageList } from './MessageList.js';
import { RawLog } from './RawLog.js';
import { Settings } from './Settings.js';
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
import type { MenuItem } from '../primitives/ContextMenu.js';
import {
  type TargetRef,
  draftFor,
  isHighlight,
  orderNetworks,
  sameRef,
  unreadFor,
  useView,
} from './view-store.js';

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
}

/** The whole client. */
export function Marmotter({
  createTransport,
  resolveSecret,
  persists = false,
  notifier,
}: MarmotterProps): ReactNode {
  const registry = useNetworks();
  const view = useView();
  const breakpoint = useBreakpoint();

  const [adding, setAdding] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  /** A network waiting for a channel name from the "Join a channel" prompt. */
  const [joiningNetwork, setJoiningNetwork] = useState<string | undefined>(undefined);
  /** Whose profile card is open, if any. */
  const [profileNick, setProfileNick] = useState<string | undefined>(undefined);
  /** Whether the channel settings and moderation sheet is open. */
  const [channelPanelOpen, setChannelPanelOpen] = useState(false);
  /** The member a ban or a removal is being built for, and which of the two. */
  const [acting, setActing] = useState<{ member: Member; kind: 'ban' | 'kick' } | undefined>(
    undefined,
  );

  const toast = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, text, tone }]);
  }, []);

  const networks = useMemo(
    () =>
      orderNetworks([...registry.profiles.keys()], view.networkOrder).flatMap((id) => {
        const state = registry.networks.get(id);
        return state === undefined ? [] : [state];
      }),
    [registry.profiles, registry.networks, view.networkOrder],
  );

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
    (profile: NetworkProfile): void => {
      const built: Session = createSession({
        profile,
        transport: createTransport(profile),
        ...(resolveSecret === undefined ? {} : { resolveSecret }),
      });

      built.on((sessionEvent) => {
        if (sessionEvent.kind === 'auth-failed') {
          toast(sessionEvent.reason, 'error');
        } else if (sessionEvent.kind === 'closed' && sessionEvent.reason.kind === 'tls-error') {
          toast(
            `Could not verify ${profile.name}'s certificate. Check the network's security setting.`,
            'error',
          );
        }
      });

      registry.addProfile(profile, built);
      void built.connect().catch((error: unknown) => {
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

  const removeNetwork = (networkId: string): void => {
    registry.removeProfile(networkId);
    view.forgetNetwork(networkId);
  };

  const disconnect = (networkId: string): void => {
    registry.sessionOf(networkId)?.disconnect();
  };

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
      },
    });
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
        // never to render — so typing it opens the browser that consumes it.
        if (parsed.command.name === 'list') {
          view.setPane('channel-browser');
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
      : view.pane === 'settings'
        ? 'Settings'
        : selection === undefined
          ? 'Marmotter'
          : (selection.target ?? network?.name ?? 'Marmotter');

  const main = (
    <>
      <NavBar
        title={title}
        {...(conversation?.topic?.text === undefined || conversation.topic.text === ''
          ? {}
          : { subtitle: conversation.topic.text })}
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
            {network === undefined ? null : (
              <IconButton
                label={view.pane === 'raw-log' ? 'Back to messages' : 'Show the raw log'}
                icon={<span aria-hidden="true">{'</>'}</span>}
                pressed={view.pane === 'raw-log'}
                onClick={() => view.setPane(view.pane === 'raw-log' ? 'chat' : 'raw-log')}
              />
            )}
            {conversation !== undefined && selection?.target !== undefined && network !== undefined
              ? isChannel(selection.target, network.support) && (
                  <>
                    <IconButton
                      label="Channel settings"
                      icon={<span aria-hidden="true">⚙</span>}
                      pressed={channelPanelOpen}
                      onClick={() => setChannelPanelOpen(true)}
                    />
                    <IconButton
                      label={view.memberListOpen ? 'Hide the member list' : 'Show the member list'}
                      icon={<span aria-hidden="true">≡</span>}
                      pressed={view.memberListOpen}
                      onClick={() => view.setMemberListOpen(!view.memberListOpen)}
                    />
                  </>
                )
              : null}
          </>
        }
      />

      {view.pane === 'settings' ? (
        <Settings
          className="flex-1 overflow-y-auto"
          networks={networks}
          appearance={view.appearance}
          onAppearanceChange={view.updateAppearance}
          onReconnect={reconnect}
          onDisconnect={disconnect}
          onRemove={removeNetwork}
          onAddNetwork={() => setAdding(true)}
        />
      ) : view.pane === 'raw-log' && network !== undefined ? (
        <RawLog network={network} onCopy={(text) => void navigator.clipboard?.writeText(text)} />
      ) : view.pane === 'channel-browser' && network !== undefined ? (
        <ChannelBrowser
          network={network}
          onRefresh={(pattern) => registry.sessionOf(network.id)?.listChannels(pattern)}
          onJoin={joinFromBrowser}
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
          {conversation === undefined ? (
            <ServerPane
              network={network}
              onReconnect={() => reconnect(network.id)}
              onOpenRawLog={() => view.setPane('raw-log')}
              onBrowseChannels={() => browseChannels(network.id)}
            />
          ) : (
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
            />
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
        asideOpen={
          view.memberListOpen &&
          conversation !== undefined &&
          selection?.target !== undefined &&
          network !== undefined &&
          isChannel(selection.target, network.support)
        }
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
          />
        }
        aside={
          conversation === undefined || network === undefined ? undefined : (
            <MemberList
              network={network}
              channel={conversation}
              menuFor={memberMenu}
              onMessage={messageMember}
              onOpenProfile={openProfile}
            />
          )
        }
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

      {network === undefined ||
      conversation === undefined ||
      session === undefined ||
      selection?.target === undefined ||
      !isChannel(selection.target, network.support) ? null : (
        <>
          <ChannelPanel
            open={channelPanelOpen}
            onClose={() => setChannelPanelOpen(false)}
            network={network}
            channel={conversation}
            onSend={(line) => session.send(line)}
            canModerate={canModerateChannel(network, conversation, network.nick)}
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

      <ToastRegion
        toasts={toasts}
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
}: {
  network: NetworkState;
  onReconnect: () => void;
  onOpenRawLog?: () => void;
  onBrowseChannels?: () => void;
}): ReactNode {
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
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2">
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
