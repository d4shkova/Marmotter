import type { NetworkState } from '@marmotter/client';
import { type ReactNode, useState } from 'react';
import { cn } from '../lib/cn.js';
import { Badge, type ConnectionStatus, StatusDot } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { IconButton } from '../primitives/IconButton.js';
import type { TargetRef, Unread } from './view-store.js';

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
  readonly onBrowseChannels?: (networkId: string) => void;
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

/**
 * The network and channel sidebar.
 *
 * Grouped by network, because on a client where multi-network is the point, a
 * flat list of channels loses which server each one is on — and `#general` on
 * two networks is two different rooms.
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
  onBrowseChannels,
  className,
}: SidebarProps): ReactNode {
  const [dragging, setDragging] = useState<string | undefined>(undefined);

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
          <IconButton
            label="Settings"
            size="small"
            icon={<span aria-hidden="true">⚙</span>}
            onClick={onOpenSettings}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
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
              {...(onBrowseChannels === undefined
                ? {}
                : { onBrowseChannels: () => onBrowseChannels(network.id) })}
            />
          ))
        )}
      </div>
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
  readonly onBrowseChannels?: () => void;
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
  onBrowseChannels,
}: NetworkGroupProps): ReactNode {
  const channels = [...network.channels.values()].filter((channel) => channel.joined);
  const queries = [...network.queries.values()];

  return (
    <section
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDropOn}
      className={cn('mb-1', dragging && 'opacity-50')}
    >
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
          onKeyDown={(event) => {
            // The keyboard equivalent of dragging, so reordering is not
            // pointer-only.
            if (event.altKey && event.key === 'ArrowUp') {
              event.preventDefault();
              onMove(-1);
            } else if (event.altKey && event.key === 'ArrowDown') {
              event.preventDefault();
              onMove(1);
            }
          }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-1.5 text-left hover:bg-[var(--fill-quaternary)]"
        >
          <StatusDot status={statusOf(network)} />
          <span className="min-w-0 flex-1 truncate text-subhead font-medium text-[var(--label-primary)]">
            {network.name}
          </span>
          <span aria-hidden="true" className="text-caption-2 text-[var(--label-quaternary)]">
            {collapsed ? '▸' : '▾'}
          </span>
        </button>
      </div>

      {collapsed ? null : (
        <ul className="flex flex-col">
          <li>
            <ConversationRow
              label={network.name}
              sublabel="Server"
              ref_={{ networkId: network.id, target: undefined }}
              selection={selection}
              onSelect={onSelect}
              unread={unreadFor({ networkId: network.id, target: undefined })}
            />
          </li>

          {channels.map((channel) => (
            <li key={channel.name}>
              <ConversationRow
                label={channel.name}
                ref_={{ networkId: network.id, target: channel.name }}
                selection={selection}
                onSelect={onSelect}
                unread={unreadFor({ networkId: network.id, target: channel.name })}
              />
            </li>
          ))}

          {queries.map((query) => (
            <li key={query.name}>
              <ConversationRow
                label={query.name}
                ref_={{ networkId: network.id, target: query.name }}
                selection={selection}
                onSelect={onSelect}
                unread={unreadFor({ networkId: network.id, target: query.name })}
              />
            </li>
          ))}

          {channels.length === 0 && onBrowseChannels !== undefined ? (
            <li className="px-3 py-1.5">
              <Button variant="plain" size="small" onClick={onBrowseChannels}>
                Browse channels
              </Button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function ConversationRow({
  label,
  sublabel,
  ref_,
  selection,
  onSelect,
  unread,
}: {
  label: string;
  sublabel?: string;
  ref_: TargetRef;
  selection: TargetRef | undefined;
  onSelect: (ref: TargetRef) => void;
  unread: Unread;
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
      className={cn(
        'flex w-full items-center gap-2 py-1 pr-2 pl-7 text-left',
        'hover:bg-[var(--fill-quaternary)]',
        selected && 'bg-[var(--fill-tertiary)]',
      )}
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-subhead',
          unread.count > 0
            ? 'font-medium text-[var(--label-primary)]'
            : 'text-[var(--label-secondary)]',
        )}
      >
        {label}
        {sublabel === undefined ? null : (
          <span className="ml-1.5 text-caption-2 text-[var(--label-quaternary)]">{sublabel}</span>
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
