import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '../lib/cn.js';

/**
 * How long a toast stays before it dismisses itself.
 *
 * Ten seconds: long enough to finish reading a two-line sentence, short enough
 * that a stack of them clears on its own. Hovering or focusing pauses the
 * countdown, and the close button is there for anyone who wants it gone sooner.
 */
const AUTO_DISMISS_MS = 10_000;

/**
 * What a toast is reporting.
 *
 * There is no "success" tone. A green toast would break the palette's one
 * rule, and an action that worked rarely needs announcing — the interface
 * already shows the result.
 */
export type ToastTone = 'info' | 'error';

export interface ToastMessage {
  readonly id: string;
  /** What happened, in the interface's voice, without apologising. */
  readonly text: string;
  readonly tone?: ToastTone;
  /** An action that addresses it, e.g. "Try again". */
  readonly action?: { readonly label: string; readonly onSelect: () => void };
}

export interface ToastProps extends ToastMessage {
  readonly onDismiss: (id: string) => void;
  readonly className?: string;
}

export function Toast({
  id,
  text,
  tone = 'info',
  action,
  onDismiss,
  className,
}: ToastProps): ReactNode {
  // Pointer-over and keyboard-focus pause the countdown, so somebody reading
  // the toast doesn't lose it mid-sentence.
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) {
      return;
    }
    const timer = window.setTimeout(() => onDismiss(id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [id, paused, onDismiss]);

  return (
    <div
      // An error interrupts; anything else waits for a pause in speech.
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={cn(
        'flex items-center gap-3 rounded-card px-4 py-3 shadow-xl',
        'bg-[var(--bg-elevated-3)] [backdrop-filter:var(--blur-vibrancy)]',
        'border',
        tone === 'error' ? 'border-[var(--danger)]' : 'border-[var(--separator)]',
        className,
      )}
    >
      <span
        className={cn(
          'flex-1 text-callout break-words',
          tone === 'error' ? 'text-[var(--danger)]' : 'text-[var(--label-primary)]',
        )}
      >
        {text}
      </span>

      {action === undefined ? null : (
        <button
          type="button"
          onClick={action.onSelect}
          className="shrink-0 text-callout font-medium text-[var(--accent)]"
        >
          {action.label}
        </button>
      )}

      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(id)}
        className="grid size-6 shrink-0 place-items-center rounded-full text-[var(--label-tertiary)] hover:bg-[var(--fill-secondary)]"
      >
        <span aria-hidden="true">
          <svg viewBox="0 0 16 16" className="size-3 fill-none stroke-current stroke-2">
            <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </span>
      </button>
    </div>
  );
}

export interface ToastRegionProps {
  readonly toasts: readonly ToastMessage[];
  readonly onDismiss: (id: string) => void;
  readonly className?: string;
}

/** Where toasts stack. One per app, at the bottom edge. */
export function ToastRegion({ toasts, onDismiss, className }: ToastRegionProps): ReactNode {
  return (
    <div
      aria-label="Notifications"
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4',
        className,
      )}
    >
      {toasts.map((toast) => (
        // Sized to its content up to a wider ceiling, so a short status is
        // compact and a message naming a file or a pack — "Requested pack #7
        // from mybot", "Saved marmot-photos.zip" — gets the room to sit on one
        // line rather than wrapping mid-name.
        <div
          key={toast.id}
          className="pointer-events-auto w-fit max-w-[min(92vw,34rem)] min-w-[16rem]"
        >
          <Toast {...toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
