import type { NetworkState } from '@marmotter/client';
import { type KeyboardEvent, type MouseEvent, type ReactNode, useState } from 'react';
import { cn } from '../lib/cn.js';
import { Badge, type ConnectionStatus, StatusDot } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { ContextMenu, type MenuItem } from '../primitives/ContextMenu.js';
import { SwipeRow, type SwipeAction } from '../primitives/SwipeRow.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { IconButton } from '../primitives/IconButton.js';
import type { TargetRef, Unread } from './view-store.js';

/** What a sidebar row stands for, which decides how it is coloured and tagged. */
export type RowKind = 'server' | 'channel' | 'person';

export interface SidebarProps {
  readonly networks: readonly NetworkState[];
  readonly selection: TargetRef | undefined;
  readonly onSelect: (ref: TargetRef) => void;
  readonly unreadFor: (ref: TargetRef) => Unread;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggleCollapsed: (networkId: string) => void;
  /** Called with the new order after a drag. */
  readonly onReorder: (order: readonly string[]) => void;
  readonly onAddNetwork: () => void;
  readonly onOpenSettings: () => void;
  /** Whether the settings pane is the one showing, so the gear reads as pressed. */
  readonly settingsOpen?: boolean;
  /**
   * Whether the header carries the settings button.
   *
   * False on a build whose window bar carries it instead. Right-clicking the
   * sidebar still offers settings either way, so nothing is lost when the
   * button moves.
   */
  readonly showSettingsButton?: boolean;
  /** Opens the "join a channel" prompt for a network. */
  readonly onJoinChannel?: (networkId: string) => void;
  readonly onBrowseChannels?: (networkId: string) => void;
  /**
   * Whether to keep a persistent "Browse channels" shortcut under every
   * network's channel list. On by default; the User options section of
   * Settings can turn it off.
   */
  readonly showBrowseChannelsShortcut?: boolean;
  /**
   * The right-click menu for a network, covering its own row and the blank
   * space below its channels.
   */
  readonly networkMenu?: (network: NetworkState) => readonly MenuItem[];
  /** The right-click menu for a channel or a private conversation. */
  readonly conversationMenu?: (
    network: NetworkState,
    target: string,
    kind: 'channel' | 'person',
  ) => readonly MenuItem[];
  /**
   * Pinned to the bottom of the sidebar, below the networks. The DCC file
   * monitor lives here — under the network list rather than under the member
   * list — so it has a home whether or not a channel is open.
   */
  readonly footer?: ReactNode;
  readonly className?: string;
}

const statusOf = (network: NetworkState): ConnectionStatus => {
  switch (network.phase) {
    case 'registered':
      return 'connected';
    case 'connecting':
    case 'registering':
      return 'connecting';
    case 'disconnected':
      return network.lastClose === undefined || network.lastClose.kind === 'user'
        ? 'offline'
        : 'failed';
  }
};

/** An open right-click menu: what it offers, what it is called, and where. */
interface OpenMenu {
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly x: number;
  readonly y: number;
}

/**
 * The network and channel sidebar.
 *
 * Grouped by network, because on a client where multi-network is the point, a
 * flat list of channels loses which server each one is on — and `#general` on
 * two networks is two different rooms.
 *
 * The network's own row is the server tab as well as the group heading: two
 * rows saying the same name, one of them tagged "Server", is a distinction
 * without a difference to anybody reading the sidebar. The disclosure sits in
 * its own control beside it, so selecting the network and folding it away stay
 * separate actions.
 *
 * Reordering is drag-and-drop with a keyboard equivalent, since drag alone is
 * unreachable for anyone not using a pointer.
 */
export function Sidebar({
  networks,
  selection,
  onSelect,
  unreadFor,
  collapsed,
  onToggleCollapsed,
  onReorder,
  onAddNetwork,
  onOpenSettings,
  settingsOpen = false,
  showSettingsButton = true,
  onJoinChannel,
  onBrowseChannels,
  showBrowseChannelsShortcut = true,
  networkMenu,
  conversationMenu,
  footer,
  className,
}: SidebarProps): ReactNode {
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [menu, setMenu] = useState<OpenMenu | undefined>(undefined);

  const move = (id: string, delta: number): void => {
    const order = networks.map((network) => network.id);
    const from = order.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= order.length) {
      return;
    }
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    onReorder(next);
  };

  const openMenu = (event: MouseEvent, label: string, items: readonly MenuItem[]): void => {
    if (event.defaultPrevented || items.length === 0) {
      return;
    }
    event.preventDefault();
    setMenu({ label, items, x: event.clientX, y: event.clientY });
  };

  return (
    <nav
      aria-label="Networks and channels"
      className={cn(
        'flex h-full flex-col border-r border-[var(--separator)] bg-[var(--bg-elevated)]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className="text-footnote font-medium tracking-wide text-[var(--label-tertiary)] uppercase">
          Networks
        </h2>
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Add a network"
            size="small"
            icon={<span aria-hidden="true">＋</span>}
            onClick={onAddNetwork}
          />
          {showSettingsButton ? (
            <IconButton
              label="Settings"
              size="small"
              pressed={settingsOpen}
              icon={<span aria-hidden="true">⚙</span>}
              onClick={onOpenSettings}
            />
          ) : null}
        </div>
      </div>

      {/* The blank space below the last network is still part of the sidebar,
          and right-clicking somewhere that looks like nothing should not feel
          like nothing happened. */}
      <div
        className="flex-1 overflow-y-auto pb-2"
        onContextMenu={(event) =>
          openMenu(event, 'Networks', [
            { id: 'add', label: 'Add a network', onSelect: onAddNetwork },
            { id: 'settings', label: 'Open settings', onSelect: onOpenSettings },
          ])
        }
      >
        {networks.length === 0 ? (
          <EmptyState
            title="No networks yet"
            description="Add one to start talking."
            action={
              <Button variant="primary" size="small" onClick={onAddNetwork}>
                Add a network
              </Button>
            }
          />
        ) : (
          networks.map((network) => (
            <NetworkGroup
              key={network.id}
              network={network}
              selection={selection}
              onSelect={onSelect}
              unreadFor={unreadFor}
              collapsed={collapsed.has(network.id)}
              onToggleCollapsed={() => onToggleCollapsed(network.id)}
              onMove={(delta) => move(network.id, delta)}
              dragging={dragging === network.id}
              onDragStart={() => setDragging(network.id)}
              onDragEnd={() => setDragging(undefined)}
              onDropOn={() => {
                if (dragging !== undefined && dragging !== network.id) {
                  const order = networks.map((entry) => entry.id);
                  const from = order.indexOf(dragging);
                  const to = order.indexOf(network.id);
                  const next = [...order];
                  next.splice(from, 1);
                  next.splice(to, 0, dragging);
                  onReorder(next);
                }
                setDragging(undefined);
              }}
              onOpenMenu={openMenu}
              showBrowseChannelsShortcut={showBrowseChannelsShortcut}
              {...(networkMenu === undefined ? {} : { networkMenu })}
              {...(conversationMenu === undefined ? {} : { conversationMenu })}
              {...(onJoinChannel === undefined
                ? {}
                : { onJoinChannel: () => onJoinChannel(network.id) })}
              {...(onBrowseChannels === undefined
                ? {}
                : { onBrowseChannels: () => onBrowseChannels(network.id) })}
            />
          ))
        )}
      </div>

      {footer === undefined ? null : <div className="shrink-0">{footer}</div>}

      {menu === undefined ? null : (
        <ContextMenu
          open
          label={menu.label}
          at={{ x: menu.x, y: menu.y }}
          items={menu.items}
          onClose={() => setMenu(undefined)}
        />
      )}
    </nav>
  );
}

interface NetworkGroupProps {
  readonly network: NetworkState;
  readonly selection: TargetRef | undefined;
  readonly onSelect: (ref: TargetRef) => void;
  readonly unreadFor: (ref: TargetRef) => Unread;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onMove: (delta: number) => void;
  readonly dragging: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onDropOn: () => void;
  readonly onOpenMenu: (event: MouseEvent, label: string, items: readonly MenuItem[]) => void;
  readonly networkMenu?: (network: NetworkState) => readonly MenuItem[];
  readonly conversationMenu?: (
    network: NetworkState,
    target: string,
    kind: 'channel' | 'person',
  ) => readonly MenuItem[];
  readonly onJoinChannel?: () => void;
  readonly onBrowseChannels?: () => void;
  readonly showBrowseChannelsShortcut: boolean;
}

function NetworkGroup({
  network,
  selection,
  onSelect,
  unreadFor,
  collapsed,
  onToggleCollapsed,
  onMove,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
  onOpenMenu,
  networkMenu,
  conversationMenu,
  onJoinChannel,
  onBrowseChannels,
  showBrowseChannelsShortcut,
}: NetworkGroupProps): ReactNode {
  const channels = [...network.channels.values()].filter((channel) => channel.joined);
  const queries = [...network.queries.values()];

  const menuForNetwork = (event: MouseEvent): void => {
    if (networkMenu !== undefined) {
      onOpenMenu(event, `Actions for ${network.name}`, networkMenu(network));
    }
  };

  // Alt+Arrow is the keyboard equivalent of dragging, so reordering is not
  // pointer-only.
  const reorderKeys = (event: KeyboardEvent): void => {
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(-1);
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      onMove(1);
    }
  };

  return (
    <section
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDropOn}
      onContextMenu={menuForNetwork}
      className={cn('mb-1', dragging && 'opacity-50')}
    >
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? `Show ${network.name}'s channels` : `Hide ${network.name}'s channels`
          }
          onClick={onToggleCollapsed}
          onKeyDown={reorderKeys}
          className="grid size-5 shrink-0 place-items-center rounded-control text-[var(--label-quaternary)] hover:bg-[var(--fill-quaternary)]"
        >
          <span aria-hidden="true" className="text-caption-2">
            {collapsed ? '▸' : '▾'}
          </span>
        </button>

        {/* The network's row is its server tab. There is no second row below
            saying the same name. */}
        <ConversationRow
          label={network.name}
          tag="Server"
          kind="server"
          ref_={{ networkId: network.id, target: undefined }}
          selection={selection}
          onSelect={onSelect}
          unread={unreadFor({ networkId: network.id, target: undefined })}
          leading={<StatusDot status={statusOf(network)} />}
          onKeyDown={reorderKeys}
          className="min-w-0 flex-1"
        />

        {/* Both live in the header rather than in the empty state, because
            somebody who has already joined one channel is exactly the person
            who wants to find a second. */}
        {onBrowseChannels === undefined || network.phase !== 'registered' ? null : (
          <IconButton
            label={`Browse channels on ${network.name}`}
            size="small"
            icon={<span aria-hidden="true">⌕</span>}
            onClick={onBrowseChannels}
          />
        )}

        {onJoinChannel === undefined || network.phase !== 'registered' ? null : (
          <IconButton
            label={`Join a channel on ${network.name}`}
            size="small"
            icon={<span aria-hidden="true">＋</span>}
            onClick={onJoinChannel}
          />
        )}
      </div>

      {collapsed ? null : (
        <ul className="flex flex-col">
          {channels.map((channel) => (
            <li key={channel.name}>
              <SwipeRow
                {...(conversationMenu === undefined
                  ? {}
                  : swipeActionsFrom(conversationMenu(network, channel.name, 'channel')))}
              >
                <ConversationRow
                  label={channel.name}
                  kind="channel"
                  ref_={{ networkId: network.id, target: channel.name }}
                  selection={selection}
                  onSelect={onSelect}
                  unread={unreadFor({ networkId: network.id, target: channel.name })}
                  {...(conversationMenu === undefined
                    ? {}
                    : {
                        onContextMenu: (event: MouseEvent) =>
                          onOpenMenu(
                            event,
                            `Actions for ${channel.name}`,
                            conversationMenu(network, channel.name, 'channel'),
                          ),
                      })}
                />
              </SwipeRow>
            </li>
          ))}

          {queries.map((query) => (
            <li key={query.name}>
              <SwipeRow
                {...(conversationMenu === undefined
                  ? {}
                  : swipeActionsFrom(conversationMenu(network, query.name, 'person')))}
              >
                <ConversationRow
                  label={query.name}
                  tag="Person"
                  kind="person"
                  ref_={{ networkId: network.id, target: query.name }}
                  selection={selection}
                  onSelect={onSelect}
                  unread={unreadFor({ networkId: network.id, target: query.name })}
                  {...(conversationMenu === undefined
                    ? {}
                    : {
                        onContextMenu: (event: MouseEvent) =>
                          onOpenMenu(
                            event,
                            `Actions for ${query.name}`,
                            conversationMenu(network, query.name, 'person'),
                          ),
                      })}
                />
              </SwipeRow>
            </li>
          ))}

          {onBrowseChannels !== undefined &&
          network.phase === 'registered' &&
          (channels.length === 0 || showBrowseChannelsShortcut) ? (
            <li className="px-3 py-1.5">
              <Button variant="plain" size="small" onClick={onBrowseChannels}>
                Browse channels
              </Button>
            </li>
          ) : null}

          {/* Deliberately clickable-through empty space: right-clicking below
              the channels is right-clicking the network. */}
          <li aria-hidden="true" className="h-3" />
        </ul>
      )}
    </section>
  );
}

/**
 * The two actions a finger can reach by dragging a row aside.
 *
 * Read out of the row's own menu rather than passed in beside it. They are the
 * same actions with the same handlers, so deriving them is what stops a swipe
 * and a long-press from ever doing different things — and means a change to
 * either action is made in one place.
 *
 * Marking read is offered only when there is something to mark, which is the
 * same condition that greys it out in the menu. Leaving is destructive and
 * `SwipeRow` makes it need most of the row's width, so brushing the list while
 * scrolling cannot drop somebody out of a channel.
 */
function swipeActionsFrom(items: readonly MenuItem[]): {
  leading?: SwipeAction;
  trailing?: SwipeAction;
} {
  const read = items.find((item) => item.id === 'read');
  const remove = items.find((item) => item.id === 'leave' || item.id === 'close');

  return {
    ...(read === undefined || read.disabled === true
      ? {}
      : { leading: { label: read.label, onAction: read.onSelect } }),
    ...(remove === undefined
      ? {}
      : { trailing: { label: remove.label, onAction: remove.onSelect, destructive: true } }),
  };
}

/** What colour a row's name is drawn in, by what the row stands for. */
const COLOR_FOR: Record<RowKind, string> = {
  server: 'text-[var(--label-secondary)]',
  channel: 'text-[var(--label-channel)]',
  person: 'text-[var(--label-person)]',
};

function ConversationRow({
  label,
  tag,
  kind,
  ref_,
  selection,
  onSelect,
  unread,
  leading,
  onContextMenu,
  onKeyDown,
  className,
}: {
  label: string;
  /** A word for what this is, where the name alone does not say. */
  tag?: string;
  kind: RowKind;
  ref_: TargetRef;
  selection: TargetRef | undefined;
  onSelect: (ref: TargetRef) => void;
  unread: Unread;
  leading?: ReactNode;
  onContextMenu?: (event: MouseEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  className?: string;
}): ReactNode {
  const selected =
    selection !== undefined &&
    selection.networkId === ref_.networkId &&
    selection.target === ref_.target;

  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(ref_)}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      className={cn(
        'flex w-full items-center gap-2 rounded-control py-1 pr-2 text-left',
        // The network's own row sits beside its disclosure control; everything
        // under it is indented to read as belonging to it.
        kind === 'server' ? 'pl-1' : 'pl-7',
        'hover:bg-[var(--fill-quaternary)]',
        selected && 'bg-[var(--fill-tertiary)]',
        className,
      )}
    >
      {leading}

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-subhead',
          COLOR_FOR[kind],
          unread.count > 0 && 'font-medium',
        )}
      >
        {label}
        {tag === undefined ? null : (
          <span className="ml-1.5 text-caption-2 text-[var(--label-quaternary)]">{tag}</span>
        )}
      </span>

      {unread.count > 0 ? (
        <Badge
          tone={unread.highlight ? 'alert' : 'count'}
          label={
            unread.highlight
              ? `${unread.count} unread, mentioning you, in ${label}`
              : `${unread.count} unread in ${label}`
          }
        >
          {unread.count > 99 ? '99+' : unread.count}
        </Badge>
      ) : null}
    </button>
  );
}
