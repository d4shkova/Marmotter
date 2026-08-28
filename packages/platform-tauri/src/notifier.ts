/**
 * Notifications, through Tauri rather than the web API.
 *
 * The web `Notification` API is not an option here: WebView2 on Windows does
 * not implement it, and an Android WebView does not either. The plugin hands
 * the notification to the platform — Windows' Action Center, a notification
 * daemon on Linux, the system tray on Android.
 */

import type { Notifier } from '@marmotter/ui';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

export interface NotifierOptions {
  /**
   * Run after a notification has been handed to the platform.
   *
   * Desktop asks the window for attention here — a taskbar flash on Windows,
   * whatever the desktop environment does on Linux — because the plugin has no
   * click-to-focus callback there. Android has no equivalent and passes
   * nothing: the notification is already in the system tray, and tapping it
   * brings the app forward without the app asking.
   */
  readonly afterShow?: () => void;
}

export function createNotifier(options: NotifierOptions = {}): Notifier {
  return {
    async ensurePermission(): Promise<boolean> {
      try {
        return (await isPermissionGranted()) || (await requestPermission()) === 'granted';
      } catch {
        // A desktop without a notification daemon is still a working desktop,
        // and an Android user may simply have denied the permission; both just
        // do not get notified. Failing here must not break anything.
        return false;
      }
    },

    show(request): void {
      try {
        sendNotification({ title: request.title, body: request.body });
        options.afterShow?.();
      } catch {
        // Same reasoning as above: a notification that cannot be delivered is
        // not a reason to interrupt the conversation it was about.
      }
    },
  };
}
