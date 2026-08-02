import { type ReactNode, useCallback, useId, useRef } from 'react';
import { cn } from '../lib/cn.js';
import { useFocusTrap } from '../lib/focus.js';
import { Button } from './Button.js';

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  /** What happens, in plain language. Not a restatement of the title. */
  readonly message: ReactNode;
  /** Names what happens, e.g. "Ban" — never "OK". */
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly cancelLabel?: string;
  /** Red confirm button, for actions that lose something. */
  readonly destructive?: boolean;
  readonly busy?: boolean;
  readonly className?: string;
}

/**
 * A confirmation dialog.
 *
 * Deliberately narrower than `Sheet`: a modal here always asks one question
 * with two answers. Anything with a form in it is a sheet, because a modal a
 * user can get lost inside is a modal that should not have been one.
 *
 * Escape cancels, which is the same as the cancel button — never the confirm.
 */
export function Modal({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  onConfirm,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  className,
}: ModalProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  const dismiss = useCallback(() => onClose(), [onClose]);
  useFocusTrap(panel, open, dismiss);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-[var(--scrim)]" />

      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-sm rounded-card p-5',
          'bg-[var(--bg-elevated-2)] [backdrop-filter:var(--blur-vibrancy)]',
          'border border-[var(--separator)] shadow-2xl',
          className,
        )}
      >
        <h2 id={titleId} className="text-headline font-semibold text-[var(--label-primary)]">
          {title}
        </h2>
        <div id={messageId} className="mt-2 text-callout text-[var(--label-secondary)]">
          {message}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
