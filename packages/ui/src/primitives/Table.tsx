import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './Button.js';
import { EmptyState } from './EmptyState.js';

export interface Column<Row> {
  readonly id: string;
  readonly header: string;
  readonly render: (row: Row) => ReactNode;
  /** Sortable columns supply a comparator; the rest are not offered as sortable. */
  readonly compare?: (left: Row, right: Row) => number;
  readonly width?: string;
  readonly align?: 'start' | 'end';
  /** Monospace, for masks and hostnames where character alignment matters. */
  readonly mono?: boolean;
}

export interface TableProps<Row> {
  readonly caption: string;
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly sort?: { readonly columnId: string; readonly direction: 'asc' | 'desc' };
  readonly onSortChange?: (columnId: string) => void;
  /** Shown in place of the table when there is nothing in it. */
  readonly empty?: ReactNode;
  /**
   * Renders this many rows at a time, with a control to show the next batch.
   *
   * For the tables fed by a network rather than by a person: a serving bot's
   * catalogue runs to thousands of files, and laying every one of them out is
   * seconds of work the moment the pane opens — before anybody has looked past
   * the first screenful. Omitted, every row is rendered, which is right for the
   * ban and exception lists, where the whole point is to see the lot.
   */
  readonly pageSize?: number;
  readonly className?: string;
}

/**
 * The sortable table behind the ban, quiet, invite-exception and ban-exception
 * lists, and the channel browser.
 *
 * A real `<table>` with a caption and `aria-sort`, because these are data a
 * screen reader user navigates by row and column. A grid of divs would lose
 * every one of those affordances for no visual gain.
 */
export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  empty,
  pageSize,
  className,
}: TableProps<Row>): ReactNode {
  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);
  const [pages, setPages] = useState(1);
  // Deliberately never reset as the rows change. A download reporting progress
  // hands this a new array several times a second, and folding the list back up
  // under somebody mid-scroll would be worse than showing more than they asked
  // for after a search narrowed things down.
  const shown = pageSize === undefined ? sorted : sorted.slice(0, pages * pageSize);
  const remaining = sorted.length - shown.length;

  if (rows.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const sortable = column.compare !== undefined && onSortChange !== undefined;
              const active = sort?.columnId === column.id;

              return (
                <th
                  key={column.id}
                  scope="col"
                  style={column.width === undefined ? undefined : { width: column.width }}
                  aria-sort={
                    !sortable
                      ? undefined
                      : active
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                  }
                  className="border-b border-[var(--separator)] px-3 py-2 text-footnote font-medium text-[var(--label-tertiary)]"
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(column.id)}
                      className={cn(
                        'inline-flex items-center gap-1',
                        active && 'text-[var(--label-primary)]',
                      )}
                    >
                      {column.header}
                      {active ? (
                        <span aria-hidden="true">{sort.direction === 'asc' ? '↑' : '↓'}</span>
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {shown.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-[var(--fill-quaternary)]">
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn(
                    'border-b border-[var(--separator)] px-3 py-2 text-subhead text-[var(--label-primary)]',
                    column.align === 'end' && 'text-right',
                    column.mono === true && 'font-mono text-footnote',
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {remaining > 0 ? (
        <div className="flex items-center justify-center gap-3 py-3">
          <p aria-live="polite" className="text-caption-1 text-[var(--label-tertiary)]">
            Showing {shown.length} of {sorted.length}
          </p>
          <Button size="small" variant="secondary" onClick={() => setPages((count) => count + 1)}>
            Show more
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title="Nothing here yet" description={`No entries in ${caption}.`} />
      ) : null}
    </div>
  );
}

function sortRows<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  sort: TableProps<Row>['sort'],
): readonly Row[] {
  if (sort === undefined) {
    return rows;
  }
  const column = columns.find((candidate) => candidate.id === sort.columnId);
  if (column?.compare === undefined) {
    return rows;
  }
  const compare = column.compare;
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => compare(left, right) * direction);
}
