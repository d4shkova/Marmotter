import { Marmotter } from '@marmotter/ui';
import {
  createLogStore,
  createNotifier,
  createPreferences,
  createSecrets,
  createTransport,
  openExternalUrl,
} from '@marmotter/platform-tauri';
import { type JSX, useCallback, useMemo } from 'react';
import { holdConnections } from './connection';

/**
 * The Android app.
 *
 * Almost nothing here. The shell is `@marmotter/ui` and the platform's
 * capabilities are `@marmotter/platform-tauri`, both shared with the desktop
 * build; what this file does is decide which of them Android has.
 *
 * Three things it deliberately does not pass:
 *
 * - **No window chrome.** An Android activity has no title bar to draw, no
 *   buttons that could close it, and nothing to drag. The shell falls back to
 *   its own nav bar, which is what every width below 768px uses anyway.
 * - **No DCC file monitor.** CLAUDE.md scopes it to desktop. It needs a chosen
 *   folder and a direct inbound socket, and neither is a thing this app should
 *   be asking an Android user for.
 * - **No folder or file pickers.** Logs go to the app's own storage, which is
 *   the only place an app may write without asking for a permission that would
 *   let it read the whole device. The settings screen hides both buttons when
 *   the shell is handed no picker.
 *
 * And one thing only it passes: `onConnectionsChanged`, which drives the
 * foreground service that keeps a connection alive while the app is not in
 * front. See `connection.ts`.
 */
export function App(): JSX.Element {
  // Android's notification is already in the system tray and tapping it brings
  // the app forward, so unlike desktop there is nothing to do after showing it.
  const notifier = useMemo(() => createNotifier(), []);
  const preferences = useMemo(() => createPreferences(), []);
  const secrets = useMemo(() => createSecrets(), []);
  // Stable, or the shell would re-report the count on every render.
  const onConnectionsChanged = useCallback(holdConnections, []);

  return (
    <Marmotter
      createTransport={() => createTransport()}
      notifier={notifier}
      openExternal={openExternalUrl}
      // Logging is off by default here as it is everywhere, and when it is
      // switched on it writes inside the app's own storage. Uninstalling the
      // app takes the logs with it, which is the platform's rule and not ours.
      createLogStore={(options) => createLogStore({ ...options, revealFolder: false })}
      preferences={preferences}
      secrets={secrets}
      resolveSecret={(ref) => secrets.read(ref)}
      // A phone stops a backgrounded process holding open sockets unless the
      // app runs a foreground service, so the shell has to say when there is a
      // connection worth keeping alive. Desktop and web pass nothing.
      onConnectionsChanged={onConnectionsChanged}
      persists
    />
  );
}
