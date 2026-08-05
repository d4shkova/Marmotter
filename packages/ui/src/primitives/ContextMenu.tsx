import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';
import { useDismissOnOutsideClick } from '../lib/focus.js';
import { type Placement, fit } from '../lib/placement.js';

export interface MenuItem {
  readonly id: string;
  /** Names what happens: "Ban", not "Apply". */
  readonly label: string;
  readonly onSelect: () => void;
  readonly icon?: ReactNode;
  /** Red, for actions that take something away. */
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  /** Starts a new group, drawn with a separator above. */
  readonly startsGroup?: boolean;
}

export interface ContextMenuProps {
  readonly items: readonly MenuItem[];
  /** Names the menu, e.g. "Actions for tamsin". */
  readonly label: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Where it opened, in viewport coordinates. */
  readonly at?: { readonly x: number; readonly y: number };
  readonly className?: string;
}

/**
 * The right-click / long-press menu behind the member list.
 *
 * Arrow keys move between items and Escape closes, because a menu that can only
 * be driven with a pointer is a menu half the accessibility floor cannot reach.
 * Home and End are included: these lists reach a dozen entries once the role
 * submenu is folded in.
 */
export function ContextMenu({
  items,
  label,
  open,
  onClose,
  at,
  className,
}: ContextMenuProps): ReactNode {
  const menu = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<Placement | undefined>(undefined);
  const dismiss = useCallback(() => onClose(), [onClose]);
  useDismissOnOutsideClick(menu, open, dismiss);

  const enabled = items.filter((item) => item.disabled !== true);
  const anchorX = at?.x;
  const anchorY = at?.y;

  useEffect(() => {
    if (open) {
      setActive(0);
      menu.current?.focus();
    }
  }, [open]);

  // Keeping the menu inside the window. A menu opened near the right edge or
  // near the bottom of a small window used to run off it, taking half its
  // actions with it — and the actions that fell off were the destructive ones
  // at the end, which are the ones somebody is most likely to be looking for.
  // Measured before paint, so the menu never appears in the wrong place first.
  useLayoutEffect(() => {
    if (!open || anchorX === undefined || anchorY === undefined) {
      setPlacement(undefined);
      return;
    }

    const place = (): void => {
      const element = menu.current;
      if (element === null) {
        return;
      }
      setPlacement(
        fit(
          { x: anchorX, y: anchorY },
          { width: element.offsetWidth, height: element.scrollHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchorX, anchorY, items]);

  if (!open) {
    return null;
  }

  const move = (delta: number): void => {
    setActive((current) => {
      const next = current + delta;
      if (next < 0) {
        return enabled.length - 1;
      }
      return next >= enabled.length ? 0 : next;
    });
  };

  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={
        at === undefined
          ? undefined
          : {
              position: 'fixed',
              left: placement?.left ?? at.x,
              top: placement?.top ?? at.y,
              ...(placement === undefined ? {} : { maxHeight: placement.maxHeight }),
            }
      }
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            move(1);
            break;
          case 'ArrowUp':
            event.preventDefault();
            move(-1);
            break;
          case 'Home':
            event.preventDefault();
            setActive(0);
            break;
          case 'End':
            event.preventDefault();
            setActive(Math.max(0, enabled.length - 1));
            break;
          case 'Escape':
            event.preventDefault();
            onClose();
            break;
          case 'Enter':
          case ' ': {
            event.preventDefault();
            const item = enabled[active];
            if (item !== undefined) {
              item.onSelect();
              onClose();
            }
            break;
          }
          default:
            break;
        }
      }}
      className={cn(
        'z-50 min-w-52 overflow-y-auto rounded-card py-1',
        'bg-[var(--bg-elevated-2)] [backdrop-filter:var(--blur-vibrancy)]',
        'border border-[var(--separator)] shadow-xl',
        className,
      )}
    >
      {items.map((item) => {
        const index = enabled.indexOf(item);
        return (
          <div key={item.id}>
            {item.startsGroup === true ? (
              <div aria-hidden="true" className="my-1 h-px bg-[var(--separator)]" />
            ) : null}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onMouseEnter={() => index !== -1 && setActive(index)}
              onClick={() => {
                item.onSelect();
                onClose();
              }}
              className={cn(
                // One step below the surrounding UI: menu items are chosen from
                // a short, disciplined list where a smaller size still reads
                // clearly and the menu itself takes less space over the message
                // it opened from.
                'flex w-full items-center gap-2.5 px-3 py-2 text-left text-subhead',
                'disabled:cursor-not-allowed disabled:opacity-40',
                item.destructive === true ? 'text-[var(--danger)]' : 'text-[var(--label-primary)]',
                index === active && index !== -1 && 'bg-[var(--fill-tertiary)]',
              )}
            >
              {item.icon === undefined ? null : (
                <span aria-hidden="true" className="grid size-4 place-items-center">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
