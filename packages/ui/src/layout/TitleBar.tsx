import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/** How the platform draws the buttons that minimise, maximise and close. */
export type WindowControls =
  /** We draw them, at the trailing edge. Windows and Linux. */
  | 'custom'
  /** The OS draws them over the bar's leading edge, so we leave room. macOS. */
  | 'native-inset'
  /** There is no window to control. The web build, and the default. */
  | 'none';

export interface TitleBarProps {
  /** The window's name, shown centred. */
  readonly title: string;
  readonly controls?: WindowControls;
  /**
   * Attributes spread onto every part of the bar that drags the window.
   *
   * Passed in rather than hardcoded so this package stays free of any one
   * shell's conventions: the desktop build passes Tauri's
   * `data-tauri-drag-region`, and a build with no window passes nothing.
   */
  readonly dragProps?: Readonly<Record<string, string | boolean>>;
  readonly onMinimize?: () => void;
  readonly onToggleMaximize?: () => void;
  readonly onClose?: () => void;
  /** Whether the window is maximised, which changes the middle button's job. */
  readonly maximized?: boolean;
  /** Controls at the leading edge, inside the bar. */
  readonly leading?: ReactNode;
  /** Controls between the title and the window buttons. */
  readonly trailing?: ReactNode;
  readonly className?: string;
}

/** Room for macOS's traffic lights, which the OS draws over our leading edge. */
const TRAFFIC_LIGHT_INSET = 'pl-[76px]';

/**
 * The window's own top bar, drawn by the app rather than by the OS.
 *
 * Only the desktop build has a window to drag, so only it passes `dragProps`
 * and a set of controls; everywhere else this renders as a plain title strip,
 * and the web build does not render it at all. Nothing here knows what a
 * window *is* — the shell hands it callbacks and it draws buttons.
 */
export function TitleBar({
  title,
  controls = 'none',
  dragProps = {},
  onMinimize,
  onToggleMaximize,
  onClose,
  maximized = false,
  leading,
  trailing,
  className,
}: TitleBarProps): ReactNode {
  return (
    <div
      {...dragProps}
      className={cn(
        'relative z-40 flex h-9 shrink-0 select-none items-center',
        'bg-[var(--bg-elevated)]/80 [backdrop-filter:var(--blur-vibrancy)]',
        'border-b border-[var(--separator)]',
        controls === 'native-inset' ? TRAFFIC_LIGHT_INSET : 'pl-2',
        className,
      )}
    >
      {leading === undefined ? null : <div className="flex shrink-0 items-center">{leading}</div>}

      {/* The title area is part of the drag handle, so it carries the same
          attributes and nothing inside it is interactive. */}
      <div {...dragProps} className="flex min-w-0 flex-1 items-center justify-center px-2">
        <span className="truncate text-caption-1 font-semibold tracking-wide text-[var(--label-secondary)]">
          {title}
        </span>
      </div>

      <div className="flex shrink-0 items-center">
        {trailing}
        {controls === 'custom' ? (
          <div className="flex h-9 items-center">
            <WindowButton label="Minimize this window" onClick={onMinimize}>
              <line x1="3" y1="8" x2="13" y2="8" />
            </WindowButton>
            <WindowButton
              label={maximized ? 'Restore this window' : 'Maximize this window'}
              onClick={onToggleMaximize}
            >
              {maximized ? (
                <>
                  <rect x="3" y="5.5" width="7.5" height="7.5" />
                  <polyline points="5.5,5.5 5.5,3 13,3 13,10.5 10.5,10.5" />
                </>
              ) : (
                <rect x="3.5" y="3.5" width="9" height="9" />
              )}
            </WindowButton>
            <WindowButton label="Close this window" onClick={onClose} destructive>
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </WindowButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface WindowButtonProps {
  readonly label: string;
  readonly onClick?: (() => void) | undefined;
  /** Closing is the one destructive one, so it takes the alarm colour on hover. */
  readonly destructive?: boolean;
  readonly children: ReactNode;
}

/**
 * One of the three window buttons.
 *
 * Wider than it is tall, which is the shape every desktop draws these in, and
 * deliberately not `IconButton`: these are chrome, they sit flush to the
 * window's corner, and they take the platform's hover treatment rather than
 * the app's.
 */
function WindowButton({ label, onClick, destructive = false, children }: WindowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid h-9 w-12 place-items-center transition-colors duration-100',
        'text-[var(--label-secondary)] hover:text-[var(--label-primary)]',
        'focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]',
        destructive
          ? 'hover:bg-[var(--danger)] hover:text-[var(--on-accent)]'
          : 'hover:bg-[var(--fill-quaternary)]',
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      >
        {children}
      </svg>
    </button>
  );
}
