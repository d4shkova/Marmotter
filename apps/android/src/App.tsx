import { Marmotter } from '@marmotter/ui';
import {
  createDcc,
  createLogStore,
  createNotifier,
  createPreferences,
  createSecrets,
  createTransport,
  openExternalUrl,
} from '@marmotter/platform-tauri';
import { type JSX, useCallback, useMemo, useRef } from 'react';
import { holdConnections } from './connection';

/**
 * The Android app.
 *
 * Almost nothing here. The shell is `@marmotter/ui` and the platform's
 * capabilities are `@marmotter/platform-tauri`, both shared with the desktop
 * build; what this file does is decide which of them Android has.
 *
 * Two things it deliberately does not pass:
 *
 * - **No window chrome.** An Android activity has no title bar to draw, no
 *   buttons that could close it, and nothing to drag. The shell falls back to
 *   its own nav bar, which is what every width below 768px uses anyway.
 * - **No folder or file pickers.** Logs and downloads go to the app's own
 *   storage, which is the only place an app may write without asking for a
 *   permission that would let it read the whole device. The settings screen
 *   hides those buttons when the shell is handed no picker, and names the
 *   folder instead.
 *
 * And one it passes with a piece missing on purpose: the **file monitor**.
 * Receiving a file over DCC is the same socket and the same write on a phone as
 * on a desktop, and an XDCC pack list is arguably more use here — it is a thing
 * people fetch from a channel, not a thing that needs a desktop. What Android
 * does not get is the reveal: no file manager here will open an app's own
 * storage, so the button is absent rather than drawn and broken. Sending, DCC
 * CHAT and passive transfers stay out of scope on every platform.
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
  // No folder picker and no reveal; the shell names the folder itself. Still
  // off by default, as it is everywhere — downloading connects straight to
  // whoever offered the file, and that is the user's decision to make.
  const dcc = useMemo(() => createDcc(), []);
  // Whether the notification permission has been asked for yet this session.
  const askedToNotify = useRef(false);

  /**
   * Reports the connection count, and asks to post notifications the first time
   * there is one.
   *
   * The permission is why this is not simply `holdConnections`. From Android 13
   * — which is this app's floor — posting a notification needs a runtime grant,
   * and the foreground service holding the connection open is *required* to
   * post one. Without the grant the service still runs and the notice is
   * silently dropped, which is the one outcome the design does not allow: the
   * ongoing notification is how somebody sees that the app is holding sockets
   * open on their behalf, and how they stop it.
   *
   * Asked here rather than at launch because this is the moment it means
   * something — a connection now exists to be held — and a permission prompt on
   * a cold start is a prompt nobody has any reason to grant yet. Asked once:
   * a denial is a real answer, and the shell repeats it for mentions on its own
   * terms rather than this asking again on every reconnect.
   */
  const onConnectionsChanged = useCallback(
    (connected: number): void => {
      if (connected > 0 && !askedToNotify.current) {
        askedToNotify.current = true;
        void notifier.ensurePermission();
      }
      holdConnections(connected);
    },
    [notifier],
  );

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
      dcc={dcc}
      persists
    />
  );
}
