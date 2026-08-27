import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';

export interface NavBarProps {
  /**
   * What this column is showing.
   *
   * Empty where there is nothing to name — no conversation open — in which
   * case the bar keeps its controls and draws no heading at all, leaving the
   * naming to whatever fills the column below.
   */
  readonly title: string;
  /** A second line under the title, e.g. a channel's topic or member count. */
  readonly subtitle?: ReactNode;
  /**
   * Double-clicking the title runs this. Used to open a channel's settings from
   * its name, which is where the old gear button used to point.
   */
  readonly onTitleActivate?: () => void;
  /** A tooltip on the title, e.g. what double-clicking it does. */
  readonly titleHint?: string;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  /**
   * Starts as a large title and collapses to the compact one as the content
   * scrolls, which is the iOS shape.
   */
  readonly largeTitle?: boolean;
  /** The scrolling element the collapse listens to. */
  readonly scrollRef?: React.RefObject<HTMLElement | null>;
  readonly className?: string;
}

/** Scroll distance over which the large title gives way to the compact one. */
const COLLAPSE_DISTANCE = 40;

/**
 * The translucent bar at the top of a column.
 *
 * The compact title is always in the DOM and only its opacity changes, so a
 * screen reader always has a heading to announce regardless of scroll position,
 * and nothing reflows as the user scrolls.
 */
export function NavBar({
  title,
  subtitle,
  onTitleActivate,
  titleHint,
  leading,
  trailing,
  largeTitle = false,
  scrollRef,
  className,
}: NavBarProps): ReactNode {
  const [collapsed, setCollapsed] = useState(0);
  const self = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = scrollRef?.current;
    if (element === null || element === undefined || !largeTitle) {
      return;
    }
    const onScroll = (): void => {
      setCollapsed(Math.min(1, Math.max(0, element.scrollTop / COLLAPSE_DISTANCE)));
    };
    onScroll();
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [scrollRef, largeTitle]);

  return (
    <header
      ref={self}
      className={cn(
        'sticky top-0 z-30 flex flex-col',
        'bg-[var(--bg-elevated)]/80 [backdrop-filter:var(--blur-vibrancy)]',
        'border-b border-[var(--separator)]',
        className,
      )}
    >
      <div className="flex min-h-11 items-center gap-2 px-4">
        {leading === undefined ? null : <div className="flex shrink-0 items-center">{leading}</div>}

        <div className="flex min-w-0 flex-1 flex-col items-center">
          {title === '' ? null : (
            <h1
              className={cn(
                'max-w-full truncate text-headline font-semibold text-[var(--label-primary)]',
                onTitleActivate !== undefined && 'cursor-pointer select-none',
              )}
              style={largeTitle ? { opacity: collapsed } : undefined}
              title={titleHint}
              onDoubleClick={onTitleActivate}
            >
              {title}
            </h1>
          )}
          {subtitle === undefined ? null : (
            <p className="w-full truncate text-center text-caption-1 text-[var(--label-tertiary)]">
              {subtitle}
            </p>
          )}
        </div>

        {trailing === undefined ? null : (
          <div className="flex shrink-0 items-center gap-1">{trailing}</div>
        )}
      </div>

      {largeTitle ? (
        <div
          aria-hidden="true"
          className="overflow-hidden px-4"
          style={{
            // Height and opacity rather than transform: nothing under it moves,
            // so there is nothing for reduced motion to object to.
            height: `${Math.round((1 - collapsed) * 44)}px`,
            opacity: 1 - collapsed,
          }}
        >
          <span className="text-large-title font-bold text-[var(--label-primary)]">{title}</span>
        </div>
      ) : null}
    </header>
  );
}
