import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';

/**
 * How long a toast stays before it dismisses itself.
 *
 * Ten seconds: long enough to finish reading a two-line sentence, short enough
 * that a stack of them clears on its own. Hovering or focusing pauses the
 * countdown, and the close button is there for anyone who wants it gone sooner.
 *
 * This is the default rather than the rule — Settings lets somebody who reads
 * slower, or who wants them gone faster, set their own. Both ends of that range
 * are enforced where the setting is edited, not here.
 */
export const DEFAULT_TOAST_DISMISS_MS = 10_000;

/**
 * How long the fade out takes.
 *
 * Kept in step with --duration-fade in tokens.css: the class below drives the
 * animation and this number decides when the toast is actually removed, so if
 * the two disagree the toast either jumps at the end or lingers invisibly.
 */
const FADE_MS = 200;

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
  /**
   * Stays until it is dismissed, rather than counting down.
   *
   * For the few notices that ask a question instead of reporting something —
   * an unverified certificate, where fading away would leave a network simply
   * not connecting with nothing on screen to say why. It is still dismissible
   * every way the others are; it just does not go on its own.
   */
  readonly persistent?: boolean;
}

export interface ToastProps extends ToastMessage {
  readonly onDismiss: (id: string) => void;
  /** How long it stays before dismissing itself. Defaults to ten seconds. */
  readonly dismissMs?: number;
  readonly className?: string;
}

export function Toast({
  id,
  text,
  tone = 'info',
  action,
  persistent = false,
  onDismiss,
  dismissMs = DEFAULT_TOAST_DISMISS_MS,
  className,
}: ToastProps): ReactNode {
  // Pointer-over and keyboard-focus pause the countdown, so somebody reading
  // the toast doesn't lose it mid-sentence.
  const [paused, setPaused] = useState(false);
  // Whether it is on its way out. The toast stays mounted through the fade so
  // there is something to fade; `onDismiss` is what finally removes it.
  const [leaving, setLeaving] = useState(false);
  const fadeTimer = useRef<number | undefined>(undefined);

  /**
   * The current `onDismiss`, held apart from the countdown.
   *
   * The countdown must not depend on this function's identity. Callers write it
   * inline — `onDismiss={(id) => setToasts(...)}` — so it is a new function on
   * every render of whatever holds the toast list, and the shell re-renders on
   * every line the network sends. Depended on directly, that tore down the
   * countdown and started a fresh one several times a second, and no toast ever
   * reached the end of it: they stayed on screen until they were clicked.
   */
  const report = useRef(onDismiss);
  useEffect(() => {
    report.current = onDismiss;
  }, [onDismiss]);

  /**
   * Starts the fade, then reports the dismissal once it has finished.
   *
   * Guarded against running twice: clicking a toast that is already fading —
   * or its countdown expiring mid-fade — would otherwise schedule a second
   * removal for an id that has already gone.
   */
  const dismiss = useCallback(() => {
    if (fadeTimer.current !== undefined) {
      return;
    }
    setLeaving(true);
    fadeTimer.current = window.setTimeout(() => report.current(id), FADE_MS);
  }, [id]);

  useEffect(() => () => window.clearTimeout(fadeTimer.current), []);

  useEffect(() => {
    if (paused || leaving || persistent) {
      return;
    }
    const timer = window.setTimeout(dismiss, dismissMs);
    return () => window.clearTimeout(timer);
  }, [paused, leaving, persistent, dismissMs, dismiss]);

  return (
    <div
      // An error interrupts; anything else waits for a pause in speech.
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      // Clicking anywhere on the toast dismisses it — the close button stays for
      // anyone who wants the explicit target, but the whole surface is a way out.
      onClick={dismiss}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-card px-4 py-3 shadow-xl',
        'bg-[var(--bg-elevated-3)] [backdrop-filter:var(--blur-vibrancy)]',
        'border',
        tone === 'error' ? 'border-[var(--danger)]' : 'border-[var(--separator)]',
        // Fading rather than cutting: a toast that vanishes between frames is
        // easy to miss leaving, and easy to mistake for one that was never
        // there. Opacity only, so this survives reduced motion.
        'transition-opacity duration-[var(--duration-fade)] ease-[var(--easing-press)]',
        leaving ? 'opacity-0' : 'opacity-100',
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
          // Acting on a toast also clears it: the message has served its purpose
          // once its action is taken. stopPropagation keeps the surrounding
          // click-to-dismiss from firing a second time.
          onClick={(event) => {
            event.stopPropagation();
            action.onSelect();
            dismiss();
          }}
          className="shrink-0 text-callout font-medium text-[var(--accent)]"
        >
          {action.label}
        </button>
      )}

      <button
        type="button"
        aria-label="Dismiss"
        onClick={(event) => {
          event.stopPropagation();
          dismiss();
        }}
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
  /** How long each one stays. Defaults to ten seconds. */
  readonly dismissMs?: number;
  readonly className?: string;
}

/** Where toasts stack. One per app, at the bottom edge. */
export function ToastRegion({
  toasts,
  onDismiss,
  dismissMs,
  className,
}: ToastRegionProps): ReactNode {
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
          <Toast
            {...toast}
            onDismiss={onDismiss}
            {...(dismissMs === undefined ? {} : { dismissMs })}
          />
        </div>
      ))}
    </div>
  );
}
