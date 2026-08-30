/**
 * Long-press, for the actions a pointer reaches by right-clicking.
 *
 * A touch screen has no right-click, so every menu that opens on one is
 * unreachable on a phone unless something else opens it. CLAUDE.md already
 * asks for this pairing for the decoder; this is the same gesture, kept in one
 * place so a menu does not get one half of it and not the other.
 *
 * Deliberately small: a press that stays roughly put for long enough fires, and
 * a release or a real drag before then cancels it. Anything more elaborate — a
 * synthetic click suppression, a per-platform gesture model — is the kind of
 * thing that ends up fighting the browser's own gesture handling.
 *
 * "Roughly put" is the whole of it. A finger on glass is never still: a touch
 * screen reports movement for the entire duration of a press, so cancelling on
 * the first `pointermove` meant the gesture fired on a mouse held down and
 * essentially never fired on the device it exists for. It is measured against
 * where the press started, so a press that wanders a few pixels and comes back
 * is still a press.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** How long a press has to hold to count as one. */
export const LONG_PRESS_MS = 500;

/**
 * How far a finger may wander before the press is a scroll instead.
 *
 * The same order as the platforms' own touch slop — Android's is around 8dp —
 * and comfortably inside the distance at which somebody means to drag.
 */
export const LONG_PRESS_SLOP_PX = 10;

export interface LongPressHandlers {
  readonly onPointerDown: (event: ReactPointerEvent) => void;
  readonly onPointerUp: () => void;
  readonly onPointerLeave: () => void;
  readonly onPointerMove: (event: ReactPointerEvent) => void;
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
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);

  const cancel = useCallback((): void => {
    origin.current = undefined;
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  }, []);

  /** Cancels only once the finger has actually gone somewhere. */
  const moved = useCallback(
    (event: ReactPointerEvent): void => {
      const from = origin.current;
      if (from === undefined) {
        return;
      }
      if (
        Math.abs(event.clientX - from.x) > LONG_PRESS_SLOP_PX ||
        Math.abs(event.clientY - from.y) > LONG_PRESS_SLOP_PX
      ) {
        cancel();
      }
    },
    [cancel],
  );

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
      origin.current = at;
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        origin.current = undefined;
        onLongPress(at);
      }, LONG_PRESS_MS);
    },
    [onLongPress, cancel],
  );

  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerMove: moved,
    onPointerCancel: cancel,
  };
}
