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
/**
 * The line with its control characters made visible.
 *
 * A raw log that renders `\x01` as nothing shows a CTCP and a plain message as
 * the same text, which is the one distinction somebody reading this tab is most
 * likely to be there for: a `DCC SEND` and a person typing the words "DCC SEND"
 * look identical without it. The Unicode control pictures are used, so the
 * width is unchanged and the line still reads as itself.
 */
export function visible(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/[\u0000-\u001f\u007f]/g, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0x7f ? '\u2421' : String.fromCodePoint(0x2400 + code);
  });
}

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
            `${formatTime(line.at, true)} ${line.direction === 'in' ? '<<' : '>>'} ${visible(line.line)}`,
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
              <span className="break-all text-[var(--label-secondary)]">{visible(line.line)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
