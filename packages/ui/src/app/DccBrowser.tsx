import { type ReactNode, useMemo, useState } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { SearchField } from '../primitives/SearchField.js';
import { Table, type Column } from '../primitives/Table.js';
import { formatAge, formatBytes } from './dcc.js';
import { isTrackedTransfer, isTransferInFlight, type DccOfferRecord } from './view-store.js';

/**
 * Where each state sits in the downloads tray.
 *
 * Arriving first, then waiting on a bot, then needing a retry, then done —
 * roughly the order in which a person cares about them. `available` never
 * appears here; those rows stay in the catalogue below.
 */
const TRAY_ORDER: Readonly<Record<DccOfferRecord['status'], number>> = {
  downloading: 0,
  requested: 1,
  failed: 2,
  downloaded: 3,
  available: 4,
};

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
  /**
   * Takes a row off the list whatever state it is in, stopping it first.
   *
   * Every other control is state-specific — Download only appears on an
   * available row, Cancel only on a downloading one — which left a pack a bot
   * never answered pinned to the top with nothing on it at all.
   */
  readonly onDismiss: (offer: DccOfferRecord) => void;
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
  onDismiss,
  now = Date.now(),
  className,
}: DccBrowserProps): ReactNode {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ columnId: string; direction: 'asc' | 'desc' }>({
    columnId: 'received',
    direction: 'desc',
  });

  // Rows the user has asked for are lifted out of the catalogue and pinned
  // above it. On a packlist channel the monitor sees thousands of files and the
  // handful actually being fetched would otherwise scroll away among them.
  //
  // Ordered by what wants attention rather than by when the file was seen: the
  // transfers still running, then the ones that need a decision, then the ones
  // already saved. The tray is capped, so what sits at its top is what a person
  // sees without scrolling it.
  const tracked = useMemo(
    () =>
      offers
        .filter((offer) => isTrackedTransfer(offer.status))
        .sort((a, b) => TRAY_ORDER[a.status] - TRAY_ORDER[b.status]),
    [offers],
  );

  const filtered = useMemo(() => {
    const catalogue = offers.filter((offer) => !isTrackedTransfer(offer.status));
    const needle = query.trim().toLowerCase();
    if (needle === '') {
      return catalogue;
    }
    return catalogue.filter(
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
      {/* The search bar and the downloads tray are pinned to the top of the
          scroll area together: a file window people scroll through a long
          catalogue in, so both the way to narrow it and the files they actually
          asked for have to stay in reach rather than scrolling off with the
          first screenful. */}
      <div className="sticky top-0 z-10 border-b border-[var(--separator)] bg-[var(--bg-base)]/90 [backdrop-filter:var(--blur-vibrancy)]">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1">
            <SearchField
              label="Search files"
              placeholder="Search by name or sender"
              value={query}
              onValueChange={setQuery}
            />
          </div>
          {/* Clearing leaves running transfers alone, so with nothing but those
              on the list there is nothing for the button to do. */}
          <Button
            size="small"
            variant="secondary"
            disabled={!offers.some((offer) => !isTransferInFlight(offer.status))}
            onClick={onClear}
          >
            Clear
          </Button>
        </div>

        {tracked.length === 0 ? null : (
          <section
            aria-label="Your downloads"
            // Capped and scrollable: a queue of many transfers must not grow
            // until it has swallowed the catalogue underneath it.
            className="max-h-56 overflow-y-auto border-t border-[var(--separator)] px-4 py-2"
          >
            <h2 className="pb-1 text-caption-2 text-[var(--label-tertiary)]">
              {tracked.length === 1 ? '1 download' : `${tracked.length} downloads`}
            </h2>
            <ul className="flex flex-col">
              {tracked.map((offer) => (
                <li
                  key={offer.id}
                  className="flex items-center justify-between gap-3 border-b border-[var(--separator)] py-1.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-footnote text-[var(--label-primary)]">
                      {offer.filename}
                    </p>
                    <p className="truncate text-caption-2 text-[var(--label-tertiary)]">
                      {formatBytes(offer.size)} · {offer.from} · {offer.networkName}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <DownloadCell
                      offer={offer}
                      disabled={downloadFolder === undefined}
                      onDownload={onDownload}
                      onCancel={onCancel}
                      {...(onReveal === undefined ? {} : { onReveal })}
                    />
                    <DismissButton offer={offer} onDismiss={onDismiss} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
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
            offers.length === 0 ? (
              <EmptyState
                title="No files offered yet"
                description="When someone offers a file over DCC, it shows up here."
              />
            ) : tracked.length === offers.length ? (
              // Everything on offer is up in the downloads tray, which is not
              // the same as the search having found nothing.
              <EmptyState
                title="Nothing else on offer"
                description="Every file offered so far is in your downloads above."
              />
            ) : (
              <EmptyState title="No matches" description="No files match your search." />
            )
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

/**
 * Taking a row off the list.
 *
 * Present in every state, which is the point: it is the only control a
 * `requested` row has, since a bot that never answers leaves nothing else to
 * press. A bin rather than a second cross, so it is not mistaken for the cancel
 * button beside it on a row that is downloading — and on that row the label
 * says it stops the transfer, because it does.
 */
function DismissButton({
  offer,
  onDismiss,
}: {
  offer: DccOfferRecord;
  onDismiss: (offer: DccOfferRecord) => void;
}): ReactNode {
  const stops = offer.status === 'downloading';
  return (
    <button
      type="button"
      aria-label={
        stops
          ? `Stop downloading ${offer.filename} and remove it from the list`
          : `Remove ${offer.filename} from the list`
      }
      title={stops ? 'Stop and remove from list' : 'Remove from list'}
      onClick={() => onDismiss(offer)}
      className="grid size-6 shrink-0 place-items-center rounded-control text-[var(--label-tertiary)] hover:bg-[var(--danger-muted)] hover:text-[var(--danger)]"
    >
      <span aria-hidden="true">
        <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current stroke-[1.5]">
          <path
            d="M2.5 4.5h11M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5"
            strokeLinecap="round"
          />
          <path d="M4 4.5l.6 8a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
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
