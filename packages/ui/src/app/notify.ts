/**
 * Desktop notifications.
 *
 * The shell decides *whether* to notify; the platform decides *how*. Windows
 * and Linux go through Tauri's notification plugin, because WebView2 does not
 * implement the web Notification API — a browser-only path would silently do
 * nothing on the platform most likely to be sitting minimised behind other
 * windows, which is exactly when a notification is the point.
 *
 * Nothing here stores message content. A notification is built, handed to the
 * platform, and forgotten.
 */

import type { Message, NetworkState } from '@marmotter/client';
import { fold, isChannel } from '@marmotter/protocol';
import type { TargetRef } from './view-store.js';

export interface NotificationRequest {
  readonly title: string;
  readonly body: string;
  /** The conversation to open when the notification is clicked. */
  readonly ref: TargetRef;
}

export interface Notifier {
  /**
   * Whether notifications may be shown, asking the platform if it has to.
   *
   * Called lazily, the first time something would be shown, so nobody is asked
   * for permission before the client has anything to say.
   */
  ensurePermission(): Promise<boolean>;
  show(request: NotificationRequest): void;
}

/** Why a message is worth interrupting for. */
export type NotifyReason = 'highlight' | 'private-message';

export interface NotifyDecisionInput {
  readonly message: Message;
  readonly network: NetworkState;
  /** The conversation the message landed in. */
  readonly ref: TargetRef;
  /** Whether this conversation is on screen in a focused window. */
  readonly watching: boolean;
  readonly enabled: boolean;
  readonly isHighlight: (text: string) => boolean;
}

/**
 * Whether a message should raise a notification.
 *
 * Two things earn one: being named, and being spoken to directly. Everything
 * else is a badge in the sidebar. Being generous here is how a chat client ends
 * up muted permanently, so the bar stays high.
 */
export function shouldNotify(input: NotifyDecisionInput): NotifyReason | undefined {
  const { message, network, ref, watching, enabled, isHighlight } = input;

  if (!enabled || watching || message.kind !== 'privmsg' || message.pending) {
    return undefined;
  }

  // Our own messages come back through `echo-message`. Being notified about
  // what you just typed is the clearest possible bug.
  const nick = message.source?.nick ?? '';
  if (
    nick === '' ||
    fold(nick, network.support.caseMapping) === fold(network.nick, network.support.caseMapping)
  ) {
    return undefined;
  }

  if (ref.target !== undefined && !isChannel(ref.target, network.support)) {
    return 'private-message';
  }
  return isHighlight(message.text) ? 'highlight' : undefined;
}

/** Builds what the platform will actually display. */
export function buildNotification(
  reason: NotifyReason,
  message: Message,
  network: NetworkState,
  ref: TargetRef,
): NotificationRequest {
  const nick = message.source?.nick ?? 'Someone';
  return {
    title:
      reason === 'private-message'
        ? `${nick} messaged you`
        : `${nick} mentioned you in ${ref.target ?? network.name}`,
    body: truncate(message.text, 160),
    ref,
  };
}

/**
 * The notifier for platforms with the web Notification API — the browser build.
 *
 * Where the API is absent it reports no permission and shows nothing, which is
 * what keeps the shell from having to know which platform it is running on.
 */
export function createWebNotifier(onActivate?: (ref: TargetRef) => void): Notifier {
  return {
    async ensurePermission(): Promise<boolean> {
      if (typeof Notification === 'undefined') {
        return false;
      }
      if (Notification.permission === 'granted') {
        return true;
      }
      if (Notification.permission === 'denied') {
        return false;
      }
      return (await Notification.requestPermission()) === 'granted';
    },

    show(request): void {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return;
      }
      const notification = new Notification(request.title, { body: request.body });
      notification.onclick = (): void => {
        globalThis.focus?.();
        onActivate?.(request.ref);
      };
    },
  };
}

/** Whether the window is in front. */
export function windowIsFocused(): boolean {
  return typeof document === 'undefined' || document.hasFocus();
}

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
