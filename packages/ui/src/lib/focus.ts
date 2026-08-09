/**
 * Focus management for overlays.
 *
 * An overlay that does not trap focus lets Tab walk out behind it, where the
 * user cannot see what is focused. An overlay that does not restore focus on
 * close drops the user back at the top of the document. Both are the same class
 * of bug — the keyboard and the pointer disagreeing about where the interface
 * is — and both are why this lives in one place rather than in each component.
 */

import { type RefObject, useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

/**
 * Traps Tab inside a container while it is open, and restores focus on close.
 *
 * Escape is handled by the caller rather than here, because what Escape means
 * differs: a sheet dismisses, a menu closes back to its trigger, and a modal
 * asking to confirm something destructive may want to do neither.
 */
export function useFocusTrap(
  container: RefObject<HTMLElement | null>,
  open: boolean,
  onEscape?: () => void,
): void {
  // The escape handler is kept in a ref so a caller passing a fresh closure on
  // every render — which is the common case, since `() => onClose()` is rarely
  // memoised — does not re-run this effect. Re-running it would call
  // `initial.focus()` again and yank focus back to the first field every time
  // something behind the overlay re-renders, which is exactly what happens when
  // a message arrives while the user is partway through a form.
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previous = document.activeElement as HTMLElement | null;
    const element = container.current;
    if (element === null) {
      return;
    }

    // Focus the first thing inside, or the container itself when it holds only
    // text — so the screen reader starts reading at the overlay.
    const initial = focusableWithin(element)[0] ?? element;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && escapeRef.current !== undefined) {
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const focusable = focusableWithin(element);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Back where they were, not to the top of the document.
      previous?.focus?.();
    };
  }, [container, open]);
}

/** Calls back when a pointer goes down outside the container. */
export function useDismissOnOutsideClick(
  container: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      const element = container.current;
      if (element !== null && !element.contains(event.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [container, open, onDismiss]);
}
