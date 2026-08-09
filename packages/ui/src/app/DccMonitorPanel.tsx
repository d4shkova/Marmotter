import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';

export interface DccMonitorPanelProps {
  /** Whether the monitor is actively collecting offers. */
  readonly active: boolean;
  /** How many files it has seen advertised. */
  readonly seen: number;
  readonly onStart: () => void;
  readonly onStop: () => void;
  /** Opens the file browser in the centre of the window. */
  readonly onOpen: () => void;
  readonly className?: string;
}

/**
 * The DCC file monitor's home at the foot of the sidebar, under the networks.
 *
 * Deliberately quiet: a line of status, a start/stop control, and a count. It
 * only appears at all once the feature is switched on in settings, so its mere
 * presence is the signal that the monitor is running.
 */
export function DccMonitorPanel({
  active,
  seen,
  onStart,
  onStop,
  onOpen,
  className,
}: DccMonitorPanelProps): ReactNode {
  return (
    <section
      aria-label="File monitor"
      className={cn(
        'flex flex-col gap-2 border-t border-[var(--separator)] bg-[var(--bg-elevated)] px-3 py-3',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-footnote font-medium tracking-wide text-[var(--label-tertiary)] uppercase">
          File monitor
        </h2>
        <span
          className={cn(
            'text-caption-2',
            active ? 'text-[var(--status-connected)]' : 'text-[var(--label-quaternary)]',
          )}
        >
          {active ? 'Watching' : 'Paused'}
        </span>
      </div>

      <p className="text-footnote text-[var(--label-secondary)]">
        {seen === 0
          ? active
            ? 'No files offered yet.'
            : 'Monitoring is paused.'
          : `${seen} ${seen === 1 ? 'file' : 'files'} offered`}
      </p>

      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button size="small" variant="secondary" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button size="small" variant="secondary" onClick={onStart}>
            Start
          </Button>
        )}
        <Button size="small" variant="primary" disabled={seen === 0} onClick={onOpen}>
          {seen === 0 ? 'No files' : `Open (${seen})`}
        </Button>
      </div>
    </section>
  );
}
