import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '../lib/cn.js';

/**
 * How long a toast stays before it dismisses itself.
 *
 * Long enough that somebody can finish reading it — an error sentence is often
 * two lines — without needing the close button, which stays for anyone who
 * wants it gone sooner.
 */
const AUTO_DISMISS_MS = 20_000;

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
          'flex-1 text-callout',
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
        <div key={toast.id} className="pointer-events-auto w-full max-w-sm">
          <Toast {...toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
