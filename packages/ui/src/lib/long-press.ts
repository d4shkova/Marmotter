/**
 * Long-press, for the actions a pointer reaches by right-clicking.
 *
 * A touch screen has no right-click, so every menu that opens on one is
 * unreachable on a phone unless something else opens it. CLAUDE.md already
 * asks for this pairing for the decoder; this is the same gesture, kept in one
 * place so a menu does not get one half of it and not the other.
 *
 * Deliberately small: a press that holds still for long enough fires, and any
 * movement or release before then cancels it. Anything more elaborate — a
 * distance threshold tuned per platform, a synthetic click suppression — is the
 * kind of thing that ends up fighting the browser's own gesture handling.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** How long a press has to hold still to count as one. */
export const LONG_PRESS_MS = 500;

export interface LongPressHandlers {
  readonly onPointerDown: (event: ReactPointerEvent) => void;
  readonly onPointerUp: () => void;
  readonly onPointerLeave: () => void;
  readonly onPointerMove: () => void;
  readonly onPointerCancel: () => void;
}

/**
 * Handlers that call `onLongPress` with where the finger was.
 *
 * Touch and pen only. A mouse already has the button that opens this, and
 * making a held left-click open a menu takes drag-select away from anyone using
 * one.
 */
export function useLongPress(
  onLongPress: ((at: { readonly x: number; readonly y: number }) => void) | undefined,
): LongPressHandlers {
  const timer = useRef<number | undefined>(undefined);

  const cancel = useCallback((): void => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  }, []);

  // A press still counting down when the row leaves the screen — which a
  // virtualized list does constantly — must not fire into a gone component.
  useEffect(() => cancel, [cancel]);

  const start = useCallback(
    (event: ReactPointerEvent): void => {
      if (onLongPress === undefined || event.pointerType === 'mouse') {
        return;
      }
      const at = { x: event.clientX, y: event.clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        onLongPress(at);
      }, LONG_PRESS_MS);
    },
    [onLongPress, cancel],
  );

  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerMove: cancel,
    onPointerCancel: cancel,
  };
}
