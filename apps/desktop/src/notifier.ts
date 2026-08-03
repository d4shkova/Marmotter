/**
 * Desktop notifications, through Tauri.
 *
 * The web `Notification` API is not an option here: WebView2 on Windows does
 * not implement it, so the browser path would silently do nothing on the
 * platform where a background notification matters most. The plugin hands the
 * notification to the OS — Windows' Action Center, or the desktop's
 * notification daemon on Linux.
 */

import type { Notifier } from '@marmotter/ui';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { UserAttentionType, getCurrentWindow } from '@tauri-apps/api/window';

export function createDesktopNotifier(): Notifier {
  return {
    async ensurePermission(): Promise<boolean> {
      try {
        return (await isPermissionGranted()) || (await requestPermission()) === 'granted';
      } catch {
        // A desktop without a notification daemon is still a working desktop;
        // it just does not get notified. Failing here must not break anything.
        return false;
      }
    },

    show(request): void {
      try {
        sendNotification({ title: request.title, body: request.body });
        // The plugin has no click-to-focus callback on desktop, so the window
        // asks for attention itself: a taskbar flash on Windows, whatever the
        // desktop environment does on Linux. Informational rather than
        // critical — a mention is not an emergency.
        void getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
      } catch {
        // Same reasoning as above: a notification that cannot be delivered is
        // not a reason to interrupt the conversation it was about.
      }
    },
  };
}
