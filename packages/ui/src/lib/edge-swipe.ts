import { type PointerEvent as ReactPointerEvent, useRef } from 'react';

/**
 * How far in from an edge a drag may start and still count as an edge swipe.
 *
 * Not measured from the bezel. Android's gesture navigation owns the outermost
 * ~20dp of both edges for its own back gesture, and a drag that starts there
 * never reaches the page at all. Starting the zone inside that leaves a band
 * that is actually ours; the cost is that a swipe from the very edge goes back
 * rather than opening a panel, which is the platform's call and not ours to
 * override.
 */
const EDGE_INNER = 24;
const EDGE_OUTER = 64;

/** How far the finger must travel across before the gesture commits. */
const THRESHOLD = 56;

/**
 * How much more horizontal than vertical the movement must be.
 *
 * The message list scrolls under this, and a gesture that stole a slightly
 * diagonal scroll would be worse than one that occasionally has to be repeated.
 */
const DIRECTNESS = 1.5;

export interface EdgeSwipeOptions {
  readonly leadingOpen: boolean;
  readonly trailingOpen: boolean;
  readonly onOpenLeading?: () => void;
  readonly onCloseLeading?: () => void;
  readonly onOpenTrailing?: () => void;
  readonly onCloseTrailing?: () => void;
}

export interface EdgeSwipeHandlers {
  readonly onPointerDown: (event: ReactPointerEvent) => void;
  readonly onPointerMove: (event: ReactPointerEvent) => void;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
}

interface Start {
  readonly x: number;
  readonly y: number;
  readonly fromLeading: boolean;
  readonly fromTrailing: boolean;
}

/**
 * Opening the side panels by dragging in from the edge of the screen.
 *
 * The mobile shape for panels that live off-screen: the channel list comes in
 * from the left, the member list from the right, and either goes back the way
 * it came. Both are also still reachable from a control — hidden until focused,
 * but there — because a gesture nobody can see must never be the only way to
 * reach something.
 *
 * Touch and pen only. A mouse drag is text selection, and a trackpad has no
 * screen edge to start from.
 */
export function useEdgeSwipe(options: EdgeSwipeOptions): EdgeSwipeHandlers {
  const start = useRef<Start | undefined>(undefined);

  const forget = (): void => {
    start.current = undefined;
  };

  return {
    onPointerDown(event) {
      if (event.pointerType === 'mouse') {
        return;
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      const fromLeft = event.clientX - bounds.left;
      const fromRight = bounds.right - event.clientX;
      start.current = {
        x: event.clientX,
        y: event.clientY,
        fromLeading: fromLeft >= EDGE_INNER && fromLeft <= EDGE_OUTER,
        fromTrailing: fromRight >= EDGE_INNER && fromRight <= EDGE_OUTER,
      };
    },

    onPointerMove(event) {
      const from = start.current;
      if (from === undefined) {
        return;
      }

      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * DIRECTNESS) {
        return;
      }

      // Whatever happens next, this gesture is spent: without this a single
      // long drag would open a panel and then immediately close it again.
      forget();

      if (dx > 0) {
        if (options.trailingOpen) {
          options.onCloseTrailing?.();
        } else if (!options.leadingOpen && from.fromLeading) {
          options.onOpenLeading?.();
        }
        return;
      }

      if (options.leadingOpen) {
        options.onCloseLeading?.();
      } else if (!options.trailingOpen && from.fromTrailing) {
        options.onOpenTrailing?.();
      }
    },

    onPointerUp: forget,
    onPointerCancel: forget,
  };
}
