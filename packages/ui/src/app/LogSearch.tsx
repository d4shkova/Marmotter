/**
 * Searching the logs.
 *
 * The in-conversation search (`MessageSearch`) looks through what is in memory
 * — this looks through what is on disk, across every network and conversation,
 * including ones that are not open and networks that are not connected.
 *
 * Results are lines, shown the way the message list shows lines: a time, who
 * said it, and what they said. Where it was said is on the row too, because a
 * search across everything is worthless if the answer does not say where it
 * came from.
 */

import type { LogRecord, LogStore } from '@marmotter/shared';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { EmptyState } from '../primitives/EmptyState.js';
import { SearchField } from '../primitives/SearchField.js';
import { Spinner } from '../primitives/Spinner.js';
import { cn } from '../lib/cn.js';
import { nickColorVar } from '../lib/nick-color.js';
import { formatDay, formatTime } from './format.js';

/** How many hits one search returns. */
const LIMIT = 500;

export interface LogSearchProps {
  readonly store: LogStore;
  /** Pre-fills the box, when the search was opened from a conversation. */
  readonly initialQuery?: string;
  /** Narrows to one conversation, when it was opened from one. */
  readonly scope?: { readonly networkId: string; readonly target?: string; readonly label: string };
  /** Clears the scope, widening the search back to everything. */
  readonly onClearScope?: () => void;
  readonly className?: string;
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'done'; readonly hits: readonly LogRecord[] }
  | { readonly kind: 'failed'; readonly message: string };

export function LogSearch({
  store,
  initialQuery = '',
  scope,
  onClearScope,
  className,
}: LogSearchProps): ReactNode {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<State>({ kind: 'idle' });
  // The search that produced what is on screen, so the empty state can name it.
  const [ran, setRan] = useState('');

  const run = (text: string): void => {
    setRan(text);
    setState({ kind: 'searching' });
    void store
      .search({
        text,
        limit: LIMIT,
        ...(scope?.networkId === undefined ? {} : { networkId: scope.networkId }),
        ...(scope?.target === undefined ? {} : { target: scope.target }),
      })
      .then((hits) => setState({ kind: 'done', hits }))
      .catch((error: unknown) =>
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  };

  // An opening query runs itself, so arriving here from a conversation with
  // something already typed shows results rather than an empty box.
  useEffect(() => {
    if (initialQuery !== '') {
      run(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    run(query.trim());
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-b border-[var(--separator)] px-4 py-3"
      >
        <SearchField
          label="Search your logs"
          value={query}
          onValueChange={setQuery}
          placeholder="Something that was said"
          className="flex-1"
        />
      </form>

      {scope === undefined ? null : (
        <div className="flex items-center gap-2 px-4 py-2 text-footnote text-[var(--label-secondary)]">
          <span>Searching {scope.label} only.</span>
          {onClearScope === undefined ? null : (
            <button
              type="button"
              onClick={onClearScope}
              className="text-[var(--accent)] underline underline-offset-2"
            >
              Search everything
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.kind === 'idle' ? (
          <EmptyState
            title="Search your logs"
            description="Every conversation Marmotter has written down, on every network — including ones you are not connected to."
          />
        ) : state.kind === 'searching' ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[var(--label-secondary)]">
            <Spinner />
            <span className="text-callout">Looking through your logs…</span>
          </div>
        ) : state.kind === 'failed' ? (
          <EmptyState title="Could not search your logs" description={state.message} />
        ) : state.hits.length === 0 ? (
          <EmptyState
            title="Nothing found"
            description={
              ran === ''
                ? 'Nothing has been logged yet.'
                : `No logged line contains ${ran}. Logging only keeps what was said after you switched it on.`
            }
          />
        ) : (
          <>
            <p aria-live="polite" className="px-4 py-2 text-footnote text-[var(--label-tertiary)]">
              {state.hits.length === LIMIT
                ? `The first ${LIMIT} matches, newest first.`
                : `${state.hits.length} ${state.hits.length === 1 ? 'match' : 'matches'}, newest first.`}
            </p>
            <ul className="flex flex-col">
              {state.hits.map((hit) => (
                <Hit key={`${hit.networkId} ${hit.target} ${hit.id}`} record={hit} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Hit({ record }: { record: LogRecord }): ReactNode {
  return (
    <li className="flex flex-col gap-0.5 px-4 py-2 hover:bg-[var(--fill-quaternary)]">
      <div className="flex items-baseline gap-2 font-mono text-footnote">
        <span className="shrink-0 text-[var(--label-tertiary)] tabular-nums">
          {formatTime(record.at)}
        </span>
        {record.nick === '' ? null : (
          <span style={{ color: `var(${nickColorVar(record.nick)})` }}>{record.nick}</span>
        )}
        <span className="break-words text-[var(--label-primary)]">{record.text}</span>
      </div>
      <div className="text-caption-1 text-[var(--label-tertiary)]">
        {record.target === '' ? record.networkName : `${record.target} · ${record.networkName}`} ·{' '}
        {formatDay(record.at)}
      </div>
    </li>
  );
}
