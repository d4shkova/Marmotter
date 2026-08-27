import type { WindowControls } from '@marmotter/ui';
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
