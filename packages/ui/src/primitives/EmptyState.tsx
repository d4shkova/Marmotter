import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface EmptyStateProps {
  /** States the situation plainly: "You haven't joined any channels yet". */
  readonly title: string;
  /** One sentence of context, where the title alone is not enough. */
  readonly description?: string;
  /**
   * The way out.
   *
   * CLAUDE.md: an empty state is an invitation to act, not decoration. A screen
   * with nothing on it and nothing to do is a dead end, and the web build hits
   * one on every network with no server-side history.
   */
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
  readonly className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: EmptyStateProps): ReactNode {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="text-[var(--label-quaternary)]">
          {icon}
        </span>
      )}
      <p className="text-headline font-semibold text-[var(--label-primary)]">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-xs text-subhead text-[var(--label-tertiary)]">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
