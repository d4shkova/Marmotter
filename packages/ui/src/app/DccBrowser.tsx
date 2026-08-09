import { type ReactNode, useMemo, useState } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { SearchField } from '../primitives/SearchField.js';
import { Table, type Column } from '../primitives/Table.js';
import { formatAge, formatBytes } from './dcc.js';
import type { DccOfferRecord } from './view-store.js';

export interface DccBrowserProps {
  readonly offers: readonly DccOfferRecord[];
  /** Where files are written. When unset, downloads are blocked. */
  readonly downloadFolder: string | undefined;
  readonly onDownload: (offer: DccOfferRecord) => void;
  /** Stops a download that is in flight, from the X beside its progress bar. */
  readonly onCancel: (offer: DccOfferRecord) => void;
  /** Prompts for a download folder, for the case where none is set yet. */
  readonly onChooseFolder: () => void;
  /**
   * Opens the file manager on a saved file. When absent — as on web, which has
   * no file manager to open — the reveal button is not shown.
   */
  readonly onReveal?: (offer: DccOfferRecord) => void;
  readonly onClear: () => void;
  /** Injectable for tests; defaults to now. */
  readonly now?: number;
  readonly className?: string;
}

/**
 * The centre-of-window file browser: everything the monitor has seen offered
 * over DCC, searchable, with a Download button per row.
 *
 * A plain file window rather than a chat surface — columns, a search bar, and
 * one clear action — because that is the mental model a person already has for
 * "files someone sent me", and the whole point of the client is to meet the
 * model the user brings rather than the one the protocol imposes.
 */
export function DccBrowser({
  offers,
  downloadFolder,
  onDownload,
  onCancel,
  onChooseFolder,
  onReveal,
  onClear,
  now = Date.now(),
  className,
}: DccBrowserProps): ReactNode {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ columnId: string; direction: 'asc' | 'desc' }>({
    columnId: 'received',
    direction: 'desc',
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
      return offers;
    }
    return offers.filter(
      (offer) =>
        offer.filename.toLowerCase().includes(needle) || offer.from.toLowerCase().includes(needle),
    );
  }, [offers, query]);

  const columns: readonly Column<DccOfferRecord>[] = [
    {
      id: 'name',
      header: 'Name',
      mono: true,
      compare: (a, b) => a.filename.localeCompare(b.filename),
      render: (offer) => <span className="break-all">{offer.filename}</span>,
    },
    {
      id: 'size',
      header: 'Size',
      align: 'end',
      compare: (a, b) => (a.size ?? -1) - (b.size ?? -1),
      render: (offer) => formatBytes(offer.size),
    },
    {
      id: 'from',
      header: 'From',
      compare: (a, b) => a.from.localeCompare(b.from),
      render: (offer) => offer.from,
    },
    {
      id: 'pack',
      header: 'Pack',
      mono: true,
      compare: (a, b) => (a.pack ?? -1) - (b.pack ?? -1),
      render: (offer) =>
        offer.pack === undefined ? (
          <span className="text-[var(--label-quaternary)]">—</span>
        ) : (
          <span title={offer.gets === undefined ? undefined : `${offer.gets} downloads`}>
            #{offer.pack}
          </span>
        ),
    },
    {
      id: 'network',
      header: 'Network',
      compare: (a, b) => a.networkName.localeCompare(b.networkName),
      render: (offer) => offer.networkName,
    },
    {
      id: 'received',
      header: 'Seen',
      compare: (a, b) => a.receivedAt - b.receivedAt,
      render: (offer) => formatAge(offer.receivedAt, now),
    },
    {
      id: 'action',
      header: '',
      align: 'end',
      render: (offer) => (
        <DownloadCell
          offer={offer}
          disabled={downloadFolder === undefined}
          onDownload={onDownload}
          onCancel={onCancel}
          {...(onReveal === undefined ? {} : { onReveal })}
        />
      ),
    },
  ];

  return (
    <div className={className}>
      {/* The search bar is pinned to the top of the scroll area: a file window
          people scroll through a long catalogue in, so the way to narrow it has
          to stay in reach rather than scrolling off with the first screenful. */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--separator)] bg-[var(--bg-base)]/90 px-4 py-3 [backdrop-filter:var(--blur-vibrancy)]">
        <div className="flex-1">
          <SearchField
            label="Search files"
            placeholder="Search by name or sender"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <Button size="small" variant="secondary" disabled={offers.length === 0} onClick={onClear}>
          Clear
        </Button>
      </div>

      <div className="flex flex-col gap-3 px-4 py-4">
        {downloadFolder === undefined ? (
          <div className="flex items-center justify-between gap-3 rounded-card bg-[var(--bg-elevated)] px-4 py-3">
            <p className="text-footnote text-[var(--label-secondary)]">
              Choose a download folder before you can save files.
            </p>
            <Button size="small" variant="primary" onClick={onChooseFolder}>
              Choose folder
            </Button>
          </div>
        ) : (
          <p className="truncate text-caption-1 text-[var(--label-tertiary)]">
            Saving to {downloadFolder}
          </p>
        )}

        <Table
          caption="Files offered over DCC"
          columns={columns}
          rows={filtered}
          rowKey={(offer) => offer.id}
          sort={sort}
          onSortChange={(columnId) =>
            setSort((current) =>
              current.columnId === columnId
                ? { columnId, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                : { columnId, direction: 'asc' },
            )
          }
          empty={
            <EmptyState
              title={offers.length === 0 ? 'No files offered yet' : 'No matches'}
              description={
                offers.length === 0
                  ? 'When someone offers a file over DCC, it shows up here.'
                  : 'No files match your search.'
              }
            />
          }
        />
      </div>
    </div>
  );
}

/**
 * A slim progress bar with a byte-count label, shown while a file downloads.
 *
 * A red cancel button sits to the right of the bar. Red is the system's one
 * alarm colour, reserved for destructive actions — stopping a transfer part-way
 * and discarding what has arrived is exactly that — so it reads the same here as
 * everywhere else the colour appears.
 */
function DownloadProgress({
  received,
  total,
  filename,
  onCancel,
}: {
  received: number | undefined;
  total: number | undefined;
  filename: string;
  onCancel: () => void;
}): ReactNode {
  const done = received ?? 0;
  const pct =
    total !== undefined && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <div
          role="progressbar"
          aria-label="Download progress"
          aria-valuemin={0}
          aria-valuemax={total ?? undefined}
          aria-valuenow={pct === undefined ? undefined : done}
          className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--fill-tertiary)]"
        >
          <div
            className={cn(
              'h-full rounded-full bg-[var(--accent)]',
              // With no known total the bar cannot fill to a fraction, so it sits
              // partly filled to read as "in progress" rather than "stuck at 0".
              pct === undefined && 'animate-pulse',
            )}
            style={{ width: pct === undefined ? '40%' : `${pct}%` }}
          />
        </div>
        <button
          type="button"
          aria-label={`Cancel downloading ${filename}`}
          title="Cancel download"
          onClick={onCancel}
          className="grid size-5 shrink-0 place-items-center rounded-control text-[var(--danger)] hover:bg-[var(--danger-muted)]"
        >
          <span aria-hidden="true">
            <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current stroke-[1.75]">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" strokeLinecap="round" />
            </svg>
          </span>
        </button>
      </div>
      <span className="text-caption-2 text-[var(--label-tertiary)]">
        {pct === undefined ? formatBytes(done) : `${formatBytes(done)} · ${pct}%`}
      </span>
    </div>
  );
}

/** The trailing Download control, which reflects the transfer's state. */
function DownloadCell({
  offer,
  disabled,
  onDownload,
  onCancel,
  onReveal,
}: {
  offer: DccOfferRecord;
  disabled: boolean;
  onDownload: (offer: DccOfferRecord) => void;
  onCancel: (offer: DccOfferRecord) => void;
  onReveal?: (offer: DccOfferRecord) => void;
}): ReactNode {
  if (offer.passive) {
    return <span className="text-caption-1 text-[var(--label-quaternary)]">Can't fetch</span>;
  }
  switch (offer.status) {
    case 'requested':
      return (
        <Button size="small" variant="secondary" busy disabled>
          Requested
        </Button>
      );
    case 'downloading':
      return (
        <DownloadProgress
          received={offer.received}
          total={offer.size}
          filename={offer.filename}
          onCancel={() => onCancel(offer)}
        />
      );
    case 'downloaded':
      // "Saved", with a folder button that opens the file manager on the file.
      // The button only appears where the platform can reveal it and where a
      // path is actually known.
      return (
        <div className="flex items-center justify-end gap-1.5">
          <span className="text-caption-1 text-[var(--status-connected)]">Saved</span>
          {onReveal === undefined || offer.savedPath === undefined ? null : (
            <button
              type="button"
              aria-label={`Show ${offer.filename} in its folder`}
              title="Show in folder"
              onClick={() => onReveal(offer)}
              className="grid size-6 shrink-0 place-items-center rounded-control text-[var(--label-secondary)] hover:bg-[var(--fill-secondary)]"
            >
              <span aria-hidden="true">
                <svg viewBox="0 0 16 16" className="size-4 fill-none stroke-current stroke-[1.5]">
                  <path
                    d="M1.5 4.5a1 1 0 0 1 1-1h3l1.2 1.4h6.8a1 1 0 0 1 1 1v6.1a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          )}
        </div>
      );
    case 'failed':
      return (
        <div className="flex flex-col items-end gap-0.5">
          <Button
            size="small"
            variant="secondary"
            disabled={disabled}
            onClick={() => onDownload(offer)}
          >
            Retry
          </Button>
          {offer.error === undefined ? null : (
            <span
              className="max-w-40 truncate text-caption-2 text-[var(--danger)]"
              title={offer.error}
            >
              {offer.error}
            </span>
          )}
        </div>
      );
    default:
      return (
        <Button
          size="small"
          variant="primary"
          disabled={disabled}
          onClick={() => onDownload(offer)}
        >
          Download
        </Button>
      );
  }
}
