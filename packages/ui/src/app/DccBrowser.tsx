import { type ReactNode, useMemo, useState } from 'react';
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
  /** Prompts for a download folder, for the case where none is set yet. */
  readonly onChooseFolder: () => void;
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
  onChooseFolder,
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
        />
      ),
    },
  ];

  return (
    <div className={className}>
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex items-center gap-3">
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

/** The trailing Download control, which reflects the transfer's state. */
function DownloadCell({
  offer,
  disabled,
  onDownload,
}: {
  offer: DccOfferRecord;
  disabled: boolean;
  onDownload: (offer: DccOfferRecord) => void;
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
        <Button size="small" variant="secondary" busy disabled>
          Downloading
        </Button>
      );
    case 'downloaded':
      return <span className="text-caption-1 text-[var(--status-connected)]">Saved</span>;
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
