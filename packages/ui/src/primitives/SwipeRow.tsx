import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';

export interface SwipeAction {
  /** What the action does, shown behind the row and read by assistive tech. */
  readonly label: string;
  readonly onAction: () => void;
  /**
   * Destructive actions are drawn in the alarm colour and, more importantly,
   * need the row dragged most of the way across rather than nudged. Leaving a
   * channel by brushing a list while scrolling is the failure this prevents.
   */
  readonly destructive?: boolean;
}

export interface SwipeRowProps {
  /** Revealed by dragging the row to the right. */
  readonly leading?: SwipeAction;
  /** Revealed by dragging the row to the left. */
  readonly trailing?: SwipeAction;
  readonly children: ReactNode;
  readonly className?: string;
}

/** How far the row must be dragged for an ordinary action to fire. */
const COMMIT = 72;

/** How far for a destructive one. Most of a narrow phone list's width. */
const COMMIT_DESTRUCTIVE = 168;

/** Past this the row stops following the finger, so it cannot be flung away. */
const LIMIT = 208;

/**
 * A list row with an action under each edge, reached by dragging it aside.
 *
 * Touch and pen only, and additive: every action here is also in the row's own
 * menu, which a pointer opens by right-clicking and a finger by holding. A
 * gesture with no visible affordance can never be the only way to reach
 * something, so this adds a shortcut for the two things people do repeatedly
 * and takes nothing away.
 *
 * A mouse is deliberately excluded rather than supported. Dragging a row with a
 * held left button is how text selection and drag-reordering work, and giving
 * that gesture a second meaning breaks both.
 */
export function SwipeRow({ leading, trailing, children, className }: SwipeRowProps): ReactNode {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<number | undefined>(undefined);

  const action = offset > 0 ? leading : trailing;
  const distance = Math.abs(offset);
  const threshold = action?.destructive === true ? COMMIT_DESTRUCTIVE : COMMIT;
  // Armed once the row has been dragged far enough that releasing it would act.
  // The label brightens at that point, so the commit is something you see
  // before you commit to it rather than after.
  const armed = action !== undefined && distance >= threshold;

  const reset = (): void => {
    start.current = undefined;
    setDragging(false);
    setOffset(0);
  };

  const onPointerDown = (event: ReactPointerEvent): void => {
    if (event.pointerType === 'mouse') {
      return;
    }
    start.current = event.clientX;
  };

  const onPointerMove = (event: ReactPointerEvent): void => {
    const from = start.current;
    if (from === undefined) {
      return;
    }
    const moved = event.clientX - from;
    // An edge with no action behind it does not move, so the row never opens
    // onto blank space.
    if ((moved > 0 && leading === undefined) || (moved < 0 && trailing === undefined)) {
      setOffset(0);
      return;
    }
    setDragging(true);
    setOffset(Math.max(-LIMIT, Math.min(LIMIT, moved)));
  };

  const onPointerUp = (): void => {
    if (armed && action !== undefined) {
      action.onAction();
    }
    reset();
  };

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {action === undefined || distance === 0 ? null : (
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 flex items-center px-4 text-subhead font-medium',
            offset > 0 ? 'left-0 justify-start' : 'right-0 justify-end',
            action.destructive === true
              ? 'bg-[var(--danger-muted)] text-[var(--danger)]'
              : 'bg-[var(--accent-muted)] text-[var(--accent)]',
            armed ? 'opacity-100' : 'opacity-60',
          )}
          style={{ width: `${distance}px` }}
        >
          <span className="truncate">{action.label}</span>
        </div>
      )}

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        onPointerLeave={reset}
        className={cn(
          'relative bg-[var(--bg-base)]',
          // Only the release animates: following the finger has to be
          // immediate or the row lags behind it. `--duration-press` is zero
          // under `prefers-reduced-motion`, so the row snaps back instead of
          // sliding for anyone who asked for that. The drag itself is direct
          // manipulation rather than motion, and stays.
          dragging ? undefined : 'transition-transform duration-[var(--duration-press)]',
        )}
        style={offset === 0 ? undefined : { transform: `translateX(${offset}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
