import { type ReactNode, useCallback, useId, useRef } from 'react';
import { cn } from '../lib/cn.js';
import { useFocusTrap } from '../lib/focus.js';

export interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  /** Buttons pinned to the bottom, e.g. Cancel and a confirm action. */
  readonly footer?: ReactNode;
  /**
   * Comes up from the bottom edge with a grabber, which is the mobile shape.
   * The default is centred, which is the desktop and tablet shape.
   */
  readonly bottom?: boolean;
  /**
   * How wide the centred sheet may grow.
   *
   * `wide` is for a form with enough related short fields to pair them across
   * two columns — an address beside its port. At the default width those pairs
   * have to stack, which is what makes a desktop form scroll for no reason.
   * Ignored for a bottom sheet, which is full-width by definition.
   */
  readonly size?: 'default' | 'wide';
  readonly className?: string;
}

/**
 * A modal sheet.
 *
 * Rendered inline rather than through a portal: the app has one root, nothing
 * clips it, and a portal would put the overlay outside the React tree that owns
 * its state for no benefit.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  bottom = false,
  size = 'default',
  className,
}: SheetProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const dismiss = useCallback(() => onClose(), [onClose]);
  useFocusTrap(panel, open, dismiss);

  if (!open) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        bottom ? 'items-end justify-center' : 'items-center justify-center p-4',
      )}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-sm"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[85vh] w-full flex-col overflow-hidden',
          'bg-[var(--bg-elevated)] [backdrop-filter:var(--blur-vibrancy)]',
          'border border-[var(--separator)] shadow-2xl',
          // Only the transform is dropped under reduced motion; the sheet
          // still appears, it just does not slide.
          'motion-safe:animate-none',
          bottom
            ? 'rounded-t-sheet pb-[var(--safe-bottom)]'
            : cn('rounded-sheet', size === 'wide' ? 'max-w-2xl' : 'max-w-md'),
          className,
        )}
      >
        {bottom ? (
          <div className="flex justify-center pt-2">
            <span aria-hidden="true" className="h-1 w-9 rounded-full bg-[var(--fill-secondary)]" />
          </div>
        ) : null}

        <header className="flex items-center justify-between gap-4 px-4 py-3">
          <h2 id={titleId} className="text-headline font-semibold text-[var(--label-primary)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full bg-[var(--fill-secondary)] text-[var(--label-secondary)] hover:bg-[var(--fill-primary)]"
          >
            <span aria-hidden="true">
              <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current stroke-2">
                <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>

        {footer === undefined ? null : (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--separator)] px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
