import type { NetworkState } from '@marmotter/client';
import { type ReactNode, useMemo, useState } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { SearchField } from '../primitives/SearchField.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import { formatTime } from './format.js';

export interface RawLogProps {
  readonly network: NetworkState;
  readonly onCopy?: (text: string) => void;
  readonly className?: string;
}

type Direction = 'all' | 'in' | 'out';

/**
 * The raw log.
 *
 * This is how a power user comes to trust the client and how a bug gets
 * reported, so it shows the full bidirectional stream with nothing hidden and
 * nothing reworded — the one place in the interface where the protocol is
 * meant to be visible.
 */
export function RawLog({ network, onCopy, className }: RawLogProps): ReactNode {
  const [filter, setFilter] = useState('');
  const [direction, setDirection] = useState<Direction>('all');

  const lines = useMemo(() => {
    const needle = filter.toLowerCase();
    return network.rawLog.filter(
      (line) =>
        (direction === 'all' || line.direction === direction) &&
        (needle === '' || line.line.toLowerCase().includes(needle)),
    );
  }, [network.rawLog, filter, direction]);

  const copyAll = (): void => {
    onCopy?.(
      lines
        .map(
          (line) =>
            `${formatTime(line.at, true)} ${line.direction === 'in' ? '<<' : '>>'} ${line.line}`,
        )
        .join('\n'),
    );
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--separator)] px-4 py-2">
        <div className="min-w-48 flex-1">
          <SearchField label="Filter the raw log" value={filter} onValueChange={setFilter} />
        </div>
        <SegmentedControl
          label="Direction"
          value={direction}
          onChange={setDirection}
          segments={[
            { value: 'all', label: 'Both' },
            { value: 'in', label: 'Received' },
            { value: 'out', label: 'Sent' },
          ]}
        />
        <Button size="small" onClick={copyAll} disabled={lines.length === 0}>
          Copy
        </Button>
      </div>

      {lines.length === 0 ? (
        <EmptyState
          title={network.rawLog.length === 0 ? 'Nothing yet' : 'Nothing matches'}
          description={
            network.rawLog.length === 0
              ? 'Lines appear here as soon as the connection starts.'
              : 'Try a shorter filter.'
          }
        />
      ) : (
        <ol className="flex-1 overflow-auto px-4 py-2 font-mono text-caption-1">
          {lines.map((line, index) => (
            // Raw lines repeat verbatim and have no id; position is identity.
            <li key={index} className="flex gap-2 py-px whitespace-pre-wrap">
              <span className="shrink-0 tabular-nums text-[var(--label-quaternary)]">
                {formatTime(line.at, true)}
              </span>
              <span
                aria-label={line.direction === 'in' ? 'Received' : 'Sent'}
                className={cn(
                  'shrink-0',
                  line.direction === 'in' ? 'text-[var(--label-tertiary)]' : 'text-[var(--accent)]',
                )}
              >
                {line.direction === 'in' ? '<<' : '>>'}
              </span>
              <span className="break-all text-[var(--label-secondary)]">{line.line}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
