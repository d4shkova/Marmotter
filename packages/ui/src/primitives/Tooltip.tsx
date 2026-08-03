import { type ReactNode, useId, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';

export interface TooltipProps {
  /** The explanation. Short — anything longer belongs in the decoder. */
  readonly content: ReactNode;
  readonly children: ReactNode;
  readonly placement?: 'top' | 'bottom';
  /** Milliseconds of hover before it appears. */
  readonly delayMs?: number;
  readonly className?: string;
}

/**
 * A hover hint.
 *
 * Opens on focus as well as hover, so it is reachable from the keyboard, and
 * closes on Escape, so it can be dismissed without moving the pointer. Both are
 * required behaviours rather than niceties.
 *
 * A tooltip never carries information that exists nowhere else: touch has no
 * hover, and this component has no long-press. When the content is the only
 * place something is said, it belongs in a `Decoder` or a list-group footer.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delayMs = 400,
  className,
}: TooltipProps): ReactNode {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tooltipId = useId();

  const show = (): void => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delayMs);
  };
  const hide = (): void => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => setOpen(true)}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          hide();
        }
      }}
    >
      <span aria-describedby={open ? tooltipId : undefined}>{children}</span>

      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={cn(
            'absolute left-1/2 z-40 w-max max-w-64 -translate-x-1/2 rounded-control px-2 py-1',
            'bg-[var(--bg-elevated-3)] text-caption-1 text-[var(--label-primary)]',
            'border border-[var(--separator)] shadow-lg',
            placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
