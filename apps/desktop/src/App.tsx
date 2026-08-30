import { Marmotter } from '@marmotter/ui';
import {
  createLogStore,
  createNotifier,
  createPreferences,
  createSecrets,
  createTransport,
  openExternalUrl,
} from '@marmotter/platform-tauri';
import { open as openDialog, save } from '@tauri-apps/plugin-dialog';
import { UserAttentionType, getCurrentWindow } from '@tauri-apps/api/window';
import { type JSX, useMemo } from 'react';
import { createConfigFile } from './config-file';
import { createDesktopDcc } from './dcc';
import { DRAG_PROPS, startResize, useWindowChrome, windowControls } from './window';

/**
 * The desktop app.
 *
 * The shell itself lives in `@marmotter/ui` and is shared with the web build,
 * and the platform capabilities a Tauri shell provides live in
 * `@marmotter/platform-tauri` and are shared with the Android build. What is
 * left here is what only a desktop has: a window of its own to draw chrome for,
 * and the DCC file monitor.
 */
export function App(): JSX.Element {
  const notifier = useMemo(
    () =>
      createNotifier({
        // The plugin has no click-to-focus callback on desktop, so the window
        // asks for attention itself: a taskbar flash on Windows, whatever the
        // desktop environment does on Linux. Informational rather than
        // critical — a mention is not an emergency. Android passes nothing
        // here; its notification is already in the system tray.
        afterShow: () => {
          void getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
        },
      }),
    [],
  );
  const dcc = useMemo(() => createDesktopDcc(), []);
  const preferences = useMemo(() => createPreferences(), []);
  // Saving and opening a settings file. Android and web pass nothing here and
  // move settings by copying their text, which every platform can do.
  const configFile = useMemo(() => createConfigFile(), []);
  const secrets = useMemo(() => createSecrets(), []);
  const controls = useMemo(() => windowControls(), []);
  const chrome = useWindowChrome();

  return (
    <Marmotter
      // The window's chrome is ours here, not the OS's: `decorations` is off
      // in tauri.conf.json, so the shell's own bar is what drags, maximises
      // and closes the window. Web passes nothing and keeps the browser's.
      windowChrome={{
        title: 'Marmotter',
        controls,
        dragProps: DRAG_PROPS,
        maximized: chrome.maximized,
        onMinimize: chrome.minimize,
        onToggleMaximize: chrome.toggleMaximize,
        onClose: chrome.close,
      }}
      // Undecorated windows have no resize border of their own, so the shell
      // draws grips along its edges and they start the drag here. A maximised
      // window has nothing to resize and its edges are the screen's, where a
      // strip that swallowed clicks would be in the way rather than useful.
      {...(chrome.maximized ? {} : { resizeWindow: startResize })}
      createTransport={() => createTransport()}
      notifier={notifier}
      dcc={dcc}
      openExternal={openExternalUrl}
      // The store the shell writes conversations to, in whichever format the
      // user has chosen. Web passes nothing here and must keep passing nothing:
      // that absence is what guarantees a browser tab cannot persist message
      // content. See CLAUDE.md.
      createLogStore={createLogStore}
      // The name and fallbacks given at first run, kept in the app data folder.
      // No password ever goes in that file; those resolve against the keychain.
      preferences={preferences}
      // Passwords live in the OS keychain, never in the settings file. The
      // shell reads them through `resolveSecret` and writes them through
      // `secrets`; a machine with no keychain keeps them in memory instead and
      // asks again next launch.
      secrets={secrets}
      resolveSecret={(ref) => secrets.read(ref)}
      configFile={configFile}
      chooseLogFolder={async () => {
        const chosen = await openDialog({
          directory: true,
          multiple: false,
          title: 'Choose where logs are kept',
        });
        return typeof chosen === 'string' ? chosen : undefined;
      }}
      chooseExportFile={async () => {
        const chosen = await save({
          title: 'Export your logs',
          defaultPath: 'marmotter-logs.txt',
          filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
        });
        return chosen ?? undefined;
      }}
      persists
    />
  );
}
