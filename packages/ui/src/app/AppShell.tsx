import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '../lib/cn.js';
import { IconButton } from '../primitives/IconButton.js';
import { useKeyboardInset } from '../lib/keyboard.js';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

/**
 * Which layout the window is wide enough for.
 *
 * The breakpoints are the ones in CLAUDE.md: three columns at 1024px and up,
 * two at 768–1023, one below that.
 */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => measure());

  useEffect(() => {
    const onResize = (): void => setBreakpoint(measure());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return breakpoint;
}

function measure(): Breakpoint {
  if (typeof window === 'undefined') {
    return 'desktop';
  }
  if (window.innerWidth >= 1024) {
    return 'desktop';
  }
  return window.innerWidth >= 768 ? 'tablet' : 'mobile';
}

export interface AppShellProps {
  readonly sidebar: ReactNode;
  readonly main: ReactNode;
  /** The member list. Becomes a sheet below 1024px. */
  readonly aside?: ReactNode;
  /** The bottom tab bar, shown below 768px. */
  readonly tabBar?: ReactNode;
  readonly sidebarCollapsed?: boolean;
  readonly asideOpen?: boolean;
  readonly onCloseAside?: () => void;
  /**
   * The window's own top bar, where the app draws one instead of the OS.
   *
   * Desktop passes a `TitleBar`; web passes nothing, because a browser tab has
   * no window to drag and drawing buttons that cannot close it would be a lie.
   * When it is present the frame gives it a row of its own and the columns take
   * the rest of the height.
   */
  readonly titleBar?: ReactNode;
  /** Shown on mobile when the channel list is slid over. */
  readonly sidebarOpen?: boolean;
  readonly onCloseSidebar?: () => void;
  /**
   * Opens the slide-over channel list, from the handle against the left edge.
   */
  readonly onOpenSidebar?: () => void;
  /**
   * Opens the member list. Passed only where there is one to open — the shell
   * is given no `aside` until it is already open, so this is what says the
   * conversation has members at all.
   */
  readonly onOpenAside?: () => void;
  readonly className?: string;
}

/**
 * The responsive frame.
 *
 * Three columns on desktop, two on tablet with the member list as a sheet, and
 * one on mobile with the channel list as a slide-over. The shell owns only the
 * arrangement — every column is passed in, so the same three components serve
 * all three layouts rather than each width getting its own implementation.
 */
export function AppShell({
  sidebar,
  main,
  aside,
  tabBar,
  sidebarCollapsed = false,
  asideOpen = true,
  onCloseAside,
  titleBar,
  sidebarOpen = false,
  onCloseSidebar,
  onOpenSidebar,
  onOpenAside,
  className,
}: AppShellProps): ReactNode {
  const breakpoint = useBreakpoint();
  const keyboard = useKeyboardInset();
  // The frame owns the viewport height now, so the columns fill what is left of
  // it — under a title bar where there is one, and under nothing where there
  // is not.
  const frame = 'min-h-0 flex-1';

  /**
   * The edges the platform has claimed, kept off every column at once.
   *
   * Top and sides here; the bottom belongs to whatever is actually against it,
   * which is the tab bar on mobile and a sheet when one is open, and both pad
   * themselves. Doing it on the frame rather than per component is what keeps
   * the slide-over channel list and the bottom sheet inside the safe area
   * without either of them knowing a notch exists.
   *
   * `paddingBottom` is the keyboard, not a safe-area inset: where the platform
   * draws the keyboard over the page instead of shrinking it, this is what
   * lifts the composer back above it. Zero everywhere else. See
   * `lib/keyboard.ts`.
   */
  const insets = 'pt-[var(--safe-top)] pl-[var(--safe-left)] pr-[var(--safe-right)]';
  const style = keyboard === 0 ? undefined : { paddingBottom: `${keyboard}px` };

  /**
   * The handle that pulls a side panel out, against the edge it lives on.
   *
   * A tab against the edge rather than a control in the bar: it points at where
   * the panel comes from, and its being there at all is what says a panel is
   * there to open — which is the thing an edge gesture, however natural, can
   * never say to somebody who has not been told.
   *
   * A real button, so it is reachable by keyboard and announced by a screen
   * reader like any other. It steps aside while its panel is open, where the
   * scrim is what closes it.
   */
  const handle = (side: 'left' | 'right', label: string, open: () => void): ReactNode => (
    <div
      className={cn(
        'absolute top-1/2 z-20 -translate-y-1/2',
        side === 'left' ? 'left-0' : 'right-0',
      )}
    >
      <IconButton
        label={label}
        onClick={open}
        icon={<span aria-hidden="true">{side === 'left' ? '›' : '‹'}</span>}
        className={cn(
          'bg-[var(--bg-elevated)]/80 [backdrop-filter:var(--blur-vibrancy)]',
          'border border-[var(--separator)] text-[var(--label-tertiary)]',
          // Squared off against the screen edge and rounded on the side it
          // opens towards, so it reads as something to pull rather than a
          // button that happens to be near the edge.
          side === 'left' ? 'rounded-l-none border-l-0' : 'rounded-r-none border-r-0',
        )}
      />
    </div>
  );

  /** Wraps the columns in the window frame, once the breakpoint has built them. */
  const framed = (columns: ReactNode): ReactNode => (
    <div
      className={cn('flex h-dvh flex-col overflow-hidden bg-[var(--bg-base)]', insets)}
      style={style}
    >
      {titleBar}
      {columns}
    </div>
  );

  if (breakpoint === 'mobile') {
    return framed(
      <div className={cn('flex flex-col overflow-hidden bg-[var(--bg-base)]', frame, className)}>
        <div className="relative flex flex-1 overflow-hidden">
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{main}</main>

          {sidebarOpen || onOpenSidebar === undefined
            ? null
            : handle('left', 'Show channels', onOpenSidebar)}

          {/* Offered whenever the panel is not actually on screen. Not simply
              `!asideOpen`: that defaults to true, and the shell is handed no
              member list until one is open — so the state this button exists
              for is "open, with nothing in it", which is not open at all. */}
          {(asideOpen && aside !== undefined) || onOpenAside === undefined
            ? null
            : handle('right', 'Show the member list', onOpenAside)}

          {sidebarOpen ? (
            <>
              <div
                aria-hidden="true"
                onClick={onCloseSidebar}
                className="absolute inset-0 z-30 bg-[var(--scrim)]"
              />
              <div className="absolute inset-y-0 left-0 z-40 w-72 max-w-[85%] shadow-2xl">
                {sidebar}
              </div>
            </>
          ) : null}

          {asideOpen && aside !== undefined ? (
            <>
              <div
                aria-hidden="true"
                onClick={onCloseAside}
                className="absolute inset-0 z-30 bg-[var(--scrim)]"
              />
              {/* A bottom sheet with a grabber, which is the mobile shape for
                  something you pull up and push back down. */}
              <div className="absolute inset-x-0 bottom-0 z-40 max-h-[70%] overflow-hidden rounded-t-sheet shadow-2xl">
                <div className="flex justify-center bg-[var(--bg-elevated)] pt-2">
                  <span
                    aria-hidden="true"
                    className="h-1 w-9 rounded-full bg-[var(--fill-secondary)]"
                  />
                </div>
                {aside}
              </div>
            </>
          ) : null}
        </div>

        {tabBar}
      </div>,
    );
  }

  if (breakpoint === 'tablet') {
    return framed(
      <div className={cn('flex overflow-hidden bg-[var(--bg-base)]', frame, className)}>
        <div className={cn('shrink-0', sidebarCollapsed ? 'w-14' : 'w-64')}>{sidebar}</div>
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {main}
          {asideOpen && aside !== undefined ? (
            <>
              <div
                aria-hidden="true"
                onClick={onCloseAside}
                className="absolute inset-0 z-30 bg-[var(--scrim)]"
              />
              <div className="absolute inset-y-0 right-0 z-40 w-64 shadow-2xl">{aside}</div>
            </>
          ) : null}
        </main>
      </div>,
    );
  }

  return framed(
    <div className={cn('flex overflow-hidden bg-[var(--bg-base)]', frame, className)}>
      <div className={cn('shrink-0 transition-all', sidebarCollapsed ? 'w-14' : 'w-64')}>
        {sidebar}
      </div>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{main}</main>
      {asideOpen && aside !== undefined ? (
        <div className="w-56 shrink-0 xl:w-64">{aside}</div>
      ) : null}
    </div>,
  );
}
