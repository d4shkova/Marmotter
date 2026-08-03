import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '../lib/cn.js';

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
  /** Shown on mobile when the channel list is slid over. */
  readonly sidebarOpen?: boolean;
  readonly onCloseSidebar?: () => void;
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
  sidebarOpen = false,
  onCloseSidebar,
  className,
}: AppShellProps): ReactNode {
  const breakpoint = useBreakpoint();

  if (breakpoint === 'mobile') {
    return (
      <div className={cn('flex h-dvh flex-col overflow-hidden bg-[var(--bg-base)]', className)}>
        <div className="relative flex flex-1 overflow-hidden">
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{main}</main>

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
      </div>
    );
  }

  if (breakpoint === 'tablet') {
    return (
      <div className={cn('flex h-dvh overflow-hidden bg-[var(--bg-base)]', className)}>
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
      </div>
    );
  }

  return (
    <div className={cn('flex h-dvh overflow-hidden bg-[var(--bg-base)]', className)}>
      <div className={cn('shrink-0 transition-all', sidebarCollapsed ? 'w-14' : 'w-64')}>
        {sidebar}
      </div>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{main}</main>
      {asideOpen && aside !== undefined ? (
        <div className="w-56 shrink-0 xl:w-64">{aside}</div>
      ) : null}
    </div>
  );
}
