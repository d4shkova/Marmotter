import type { WindowControls, WindowEdge } from '@marmotter/ui';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

/**
 * Attributes that make an element drag the window.
 *
 * Tauri reads this attribute in the webview: pressing an element that carries
 * it moves the window, and double-clicking it maximises or restores. That is
 * why the title bar has no double-click handler of its own.
 */
export const DRAG_PROPS = { 'data-tauri-drag-region': true } as const;

/**
 * Where the window buttons come from on this platform.
 *
 * macOS keeps its own traffic lights — hiding them would break the muscle
 * memory of every Mac user and lose the full-screen button — so there we only
 * leave room for them. Windows and Linux get ours.
 */
export function windowControls(): WindowControls {
  return navigator.userAgent.includes('Macintosh') ? 'native-inset' : 'custom';
}

/**
 * Our edge names, in the compass points Tauri's window API asks for.
 *
 * Kept here rather than in the shell: which way round a window manager counts
 * is a platform detail, and `@marmotter/ui` names an edge by where it is.
 */
const RESIZE_DIRECTION = {
  top: 'North',
  bottom: 'South',
  left: 'West',
  right: 'East',
  'top-left': 'NorthWest',
  'top-right': 'NorthEast',
  'bottom-left': 'SouthWest',
  'bottom-right': 'SouthEast',
} as const satisfies Record<WindowEdge, string>;

/**
 * Starts a window resize from the edge that was grabbed.
 *
 * The window is undecorated, so the OS draws no resize border and the shell
 * draws its own grips instead; this is what they hand the drag to. The promise
 * is deliberately dropped — the window manager owns the drag from here, and
 * there is nothing to wait for or to tell the user if it declines.
 */
export function startResize(edge: WindowEdge): void {
  void getCurrentWindow().startResizeDragging(RESIZE_DIRECTION[edge]);
}

export interface WindowChrome {
  readonly maximized: boolean;
  readonly minimize: () => void;
  readonly toggleMaximize: () => void;
  readonly close: () => void;
}

/**
 * The window controls, and whether the window is currently maximised.
 *
 * The maximised flag is tracked rather than asked for on render because the
 * user can maximise a window without touching our button — a double-click on
 * the bar, a drag to the top of the screen, a keyboard shortcut — and the
 * middle button has to name what it will actually do.
 */
export function useWindowChrome(): WindowChrome {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const window = getCurrentWindow();
    let live = true;

    const sync = async (): Promise<void> => {
      const now = await window.isMaximized();
      if (live) {
        setMaximized(now);
      }
    };

    void sync();
    const unlisten = window.onResized(() => void sync());

    return () => {
      live = false;
      void unlisten.then((stop) => stop());
    };
  }, []);

  return {
    maximized,
    minimize: () => void getCurrentWindow().minimize(),
    toggleMaximize: () => void getCurrentWindow().toggleMaximize(),
    close: () => void getCurrentWindow().close(),
  };
}
