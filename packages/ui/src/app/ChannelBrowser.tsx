import type { ChannelListing, NetworkState } from '@marmotter/client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { SearchField } from '../primitives/SearchField.js';
import { Spinner } from '../primitives/Spinner.js';

export interface ChannelBrowserProps {
  readonly network: NetworkState;
  /** Asks the network for its list. The pattern goes to the server as typed. */
  readonly onRefresh: (pattern?: string) => void;
  readonly onJoin: (channel: string) => void;
  /**
   * Opens the "create a channel" form.
   *
   * Beside the browser rather than buried in a menu: looking for a channel and
   * finding nothing is exactly the moment somebody decides to make one.
   */
  readonly onCreate?: () => void;
  /** Channels already joined, so the row says so instead of offering to join. */
  readonly joined?: ReadonlySet<string>;
  readonly className?: string;
}

type SortKey = 'members' | 'name';

/** Row height, in pixels. Fixed, so the virtualizer needs no measurement. */
const ROW_HEIGHT = 52;

/**
 * The channel browser.
 *
 * `LIST` on a large network is tens of thousands of rows arriving over several
 * seconds, which is why nothing here waits for the end: rows render as they
 * come, the count updates live, and the search filters what has already
 * arrived. CLAUDE.md asks for a progress state without a warning, so a listing
 * in flight is a spinner and a count, not a caution.
 *
 * Filtering happens on this side rather than through the server's `LIST`
 * pattern, because every ircd spells that filter differently and a search box
 * that works on one network and not the next is worse than none. The pattern is
 * still available on refresh for the networks that need to narrow at source.
 */
export function ChannelBrowser({
  network,
  onRefresh,
  onJoin,
  onCreate,
  joined,
  className,
}: ChannelBrowserProps): ReactNode {
  const scroller = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('members');

  const directory = network.directory;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched =
      needle === ''
        ? directory.entries
        : directory.entries.filter(
            (entry) =>
              entry.channel.toLowerCase().includes(needle) ||
              entry.topic.toLowerCase().includes(needle),
          );

    return [...matched].sort((left, right) =>
      sort === 'members'
        ? right.members - left.members || left.channel.localeCompare(right.channel)
        : left.channel.localeCompare(right.channel),
    );
  }, [directory.entries, query, sort]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const untouched = !directory.loading && !directory.complete && directory.entries.length === 0;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--separator)] px-4 py-3">
        <SearchField
          label="Search channels"
          placeholder="Search by name or topic"
          value={query}
          onValueChange={setQuery}
          className="min-w-48 flex-1"
        />
        <Button
          variant="secondary"
          size="small"
          busy={directory.loading}
          onClick={() => onRefresh()}
        >
          {directory.loading ? 'Loading' : directory.complete ? 'Refresh' : 'Load channels'}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <p aria-live="polite" className="text-caption-1 text-[var(--label-secondary)]">
          {summarise(directory, rows.length, query)}
        </p>
        <div className="flex items-center gap-1">
          <span className="text-caption-1 text-[var(--label-tertiary)]">Sort by</span>
          <Button
            size="small"
            variant={sort === 'members' ? 'primary' : 'plain'}
            onClick={() => setSort('members')}
          >
            People
          </Button>
          <Button
            size="small"
            variant={sort === 'name' ? 'primary' : 'plain'}
            onClick={() => setSort('name')}
          >
            Name
          </Button>

          {onCreate === undefined ? null : (
            <>
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-[var(--separator)]" />
              <Button size="small" variant="secondary" onClick={onCreate}>
                Create channel
              </Button>
            </>
          )}
        </div>
      </div>

      {untouched ? (
        <EmptyState
          className="flex-1"
          title="Nothing listed yet"
          description={`Ask ${network.name} which channels it has. On a large network this takes a few seconds.`}
          action={
            <Button variant="primary" onClick={() => onRefresh()}>
              Load channels
            </Button>
          }
        />
      ) : rows.length === 0 && directory.loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner label={`Asking ${network.name} for its channels`} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          className="flex-1"
          title="No channels match"
          description={
            query.trim() === ''
              ? 'This network listed no channels.'
              : `Nothing here is called ${query.trim()}, or mentions it in a topic.`
          }
          action={
            <div className="flex gap-2">
              {query.trim() === '' ? null : (
                <Button onClick={() => setQuery('')}>Clear the search</Button>
              )}
              {onCreate === undefined ? null : (
                <Button variant="primary" onClick={onCreate}>
                  Create it
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <ul
            className="relative w-full list-none"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const entry = rows[item.index];
              if (entry === undefined) {
                return null;
              }
              return (
                <li
                  key={entry.channel}
                  className="absolute top-0 left-0 w-full"
                  style={{ height: `${item.size}px`, transform: `translateY(${item.start}px)` }}
                >
                  <ChannelRow
                    entry={entry}
                    joined={joined?.has(entry.channel.toLowerCase()) ?? false}
                    onJoin={() => onJoin(entry.channel)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  entry,
  joined,
  onJoin,
}: {
  readonly entry: ChannelListing;
  readonly joined: boolean;
  readonly onJoin: () => void;
}): ReactNode {
  return (
    <div className="flex h-full items-center gap-3 rounded-control px-2 hover:bg-[var(--fill-quaternary)]">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-subhead text-[var(--label-primary)]">
          {entry.channel}
        </p>
        <p className="truncate text-caption-1 text-[var(--label-tertiary)]">
          {entry.topic === '' ? 'No topic' : entry.topic}
        </p>
      </div>
      <span className="shrink-0 text-caption-1 tabular-nums text-[var(--label-secondary)]">
        {entry.members === 1 ? '1 person' : `${entry.members.toLocaleString()} people`}
      </span>
      {joined ? (
        <span className="shrink-0 text-caption-1 text-[var(--label-tertiary)]">Joined</span>
      ) : (
        <Button size="small" variant="secondary" onClick={onJoin}>
          Join
        </Button>
      )}
    </div>
  );
}

/** The live count, in the interface's voice rather than as a raw number. */
function summarise(directory: NetworkState['directory'], shown: number, query: string): string {
  const total = directory.entries.length;
  const searching = query.trim() !== '';

  if (directory.loading) {
    return total === 0
      ? 'Asking the network…'
      : searching
        ? `${shown.toLocaleString()} of ${total.toLocaleString()} so far`
        : `${total.toLocaleString()} channels so far…`;
  }
  if (total === 0) {
    return '';
  }
  const kept = directory.truncated ? ' Only the first are kept — search to narrow it.' : '';
  return searching
    ? `${shown.toLocaleString()} of ${total.toLocaleString()} channels.${kept}`
    : `${total.toLocaleString()} channels.${kept}`;
}
