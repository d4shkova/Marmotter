import {
  type ReactElement,
  type ReactNode,
  cloneElement,
  isValidElement,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../lib/cn.js';
import { useDismissOnOutsideClick, useFocusTrap } from '../lib/focus.js';

export type PopoverPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface PopoverProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The control it belongs to. Rendered in place, with the panel anchored to it. */
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly placement?: PopoverPlacement;
  /** Names the panel for screen readers when it has no visible heading. */
  readonly label?: string;
  readonly className?: string;
}

const PLACEMENTS: Record<PopoverPlacement, string> = {
  top: 'bottom-full left-0 mb-2',
  bottom: 'top-full left-0 mt-2',
  left: 'right-full top-0 mr-2',
  right: 'left-full top-0 ml-2',
};

/**
 * The same placements, anchored from the other end.
 *
 * Used when the natural one would put the panel outside the window — which is
 * what happens to every control in the right-hand end of a nav bar, and is the
 * whole reason this exists.
 */
const FLIPPED: Record<PopoverPlacement, string> = {
  top: 'bottom-full right-0 mb-2',
  bottom: 'top-full right-0 mt-2',
  left: 'right-full bottom-0 mr-2',
  right: 'left-full bottom-0 ml-2',
};

/** How close to the window edge a panel may sit. */
const MARGIN = 8;

/**
 * A panel anchored to its trigger.
 *
 * CSS anchoring rather than a positioning library: the placements this
 * interface needs are the four sides of a control that is already in the
 * layout, and a floating-element dependency to compute that would be more
 * machinery than the problem has.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  placement = 'bottom',
  label,
  className,
}: PopoverProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [flipped, setFlipped] = useState(false);

  const dismiss = useCallback(() => onClose(), [onClose]);
  useFocusTrap(panel, open, dismiss);
  useDismissOnOutsideClick(wrapper, open, dismiss);

  // Measured from the trigger rather than from the panel, so the answer does
  // not change once the flip has been applied. Before paint, so a panel never
  // appears off the edge and then jumps back.
  useLayoutEffect(() => {
    if (!open) {
      setFlipped(false);
      return;
    }

    const check = (): void => {
      const anchor = wrapper.current?.getBoundingClientRect();
      const element = panel.current;
      if (anchor === undefined || element === null) {
        return;
      }
      setFlipped(
        placement === 'top' || placement === 'bottom'
          ? anchor.left + element.offsetWidth > window.innerWidth - MARGIN
          : anchor.top + element.offsetHeight > window.innerHeight - MARGIN,
      );
    };

    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [open, placement]);

  return (
    <div ref={wrapper} className="relative inline-block">
      {/* The state belongs on the control itself. A wrapping span has no
          widget role, so `aria-expanded` on it would be dropped silently. */}
      {isValidElement(trigger)
        ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
            'aria-expanded': open,
            'aria-controls': open ? panelId : undefined,
          })
        : trigger}

      {open ? (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={cn(
            // A panel taller than the window scrolls inside itself rather than
            // running off the bottom of it.
            'absolute z-40 max-h-[calc(100dvh-5rem)] min-w-56 overflow-y-auto rounded-card p-3',
            'bg-[var(--bg-elevated-2)] [backdrop-filter:var(--blur-vibrancy)]',
            'border border-[var(--separator)] shadow-xl',
            (flipped ? FLIPPED : PLACEMENTS)[placement],
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
