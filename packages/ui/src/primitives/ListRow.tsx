import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface ListRowProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly leading?: ReactNode;
  /** Value or control on the trailing edge, e.g. a Toggle or a current setting. */
  readonly trailing?: ReactNode;
  /** Makes the row activatable and shows the chevron. */
  readonly onClick?: () => void;
  readonly href?: string;
  /** Destructive rows, and only those, are red. */
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly className?: string;
}

/**
 * One row of an iOS grouped list.
 *
 * The chevron appears only when the row goes somewhere. A row that merely
 * shows a value with a control on the trailing edge is not navigable, and a
 * chevron on it is a promise the interface does not keep.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onClick,
  href,
  destructive = false,
  disabled = false,
  selected = false,
  className,
}: ListRowProps): ReactNode {
  const navigable = onClick !== undefined || href !== undefined;

  const body = (
    <>
      {leading === undefined ? null : (
        <span className="grid shrink-0 place-items-center text-[var(--label-secondary)]">
          {leading}
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span
          className={cn(
            'truncate text-body',
            destructive ? 'text-[var(--danger)]' : 'text-[var(--label-primary)]',
          )}
        >
          {title}
        </span>
        {subtitle === undefined ? null : (
          <span className="truncate text-footnote text-[var(--label-tertiary)]">{subtitle}</span>
        )}
      </span>

      {trailing === undefined ? null : (
        <span className="flex shrink-0 items-center gap-2 text-callout text-[var(--label-secondary)]">
          {trailing}
        </span>
      )}

      {navigable ? (
        <span aria-hidden="true" className="shrink-0 text-[var(--label-quaternary)]">
          <svg viewBox="0 0 8 14" className="size-3 fill-none stroke-current stroke-2">
            <path d="m1 1 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : null}
    </>
  );

  const classes = cn(
    'flex w-full items-center gap-3 px-4 py-2.5 min-h-11',
    'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
    navigable && !disabled && 'hover:bg-[var(--fill-quaternary)] active:bg-[var(--fill-tertiary)]',
    selected && 'bg-[var(--fill-tertiary)]',
    disabled && 'cursor-not-allowed opacity-40',
    className,
  );

  if (href !== undefined && !disabled) {
    return (
      <a href={href} className={classes} aria-current={selected ? 'true' : undefined}>
        {body}
      </a>
    );
  }

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-current={selected ? 'true' : undefined}
        className={classes}
      >
        {body}
      </button>
    );
  }

  return <div className={classes}>{body}</div>;
}
