import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * What a badge is saying.
 *
 * `alert` is red and means something is wrong; `count` is the unread pill;
 * `neutral` and `accent` carry no urgency. There is deliberately no "success"
 * tone, because a green badge would break the one rule the palette has.
 */
export type BadgeTone = 'neutral' | 'accent' | 'alert' | 'count';

export interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
  /**
   * Read out in place of the visible text.
   *
   * An unread pill showing "3" should announce "3 unread messages", not "3".
   * Rendered as hidden text rather than as `aria-label`, because a name on a
   * plain span is ignored — only elements with a widget or image role take one.
   */
  readonly label?: string;
  readonly className?: string;
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--fill-secondary)] text-[var(--label-secondary)]',
  accent: 'bg-[var(--accent-muted)] text-[var(--accent)]',
  alert: 'bg-[var(--danger-muted)] text-[var(--danger)]',
  count: 'bg-[var(--accent)] text-[var(--on-accent)]',
};

export function Badge({ children, tone = 'neutral', label, className }: BadgeProps): ReactNode {
  return (
    <span
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5',
        'text-caption-1 font-medium tabular-nums',
        TONES[tone],
        className,
      )}
    >
      <span aria-hidden={label === undefined ? undefined : true}>{children}</span>
    </span>
  );
}

export type ConnectionStatus = 'connected' | 'connecting' | 'failed' | 'offline';

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: 'bg-[var(--status-connected)]',
  connecting: 'bg-[var(--status-connecting)]',
  failed: 'bg-[var(--status-failed)]',
  offline: 'bg-[var(--fill-secondary)]',
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  failed: 'Connection failed',
  offline: 'Not connected',
};

/**
 * The connection dot in the sidebar.
 *
 * Connecting is a dimmer blue rather than amber: red is reserved for something
 * being wrong, and a connection still in progress is not wrong yet. The state
 * is also written out for screen readers, because colour alone is not a
 * message.
 */
export function StatusDot({
  status,
  className,
}: {
  readonly status: ConnectionStatus;
  readonly className?: string;
}): ReactNode {
  return (
    <span className={cn('inline-flex items-center', className)}>
      <span aria-hidden="true" className={cn('size-2 rounded-full', STATUS_COLOR[status])} />
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </span>
  );
}
