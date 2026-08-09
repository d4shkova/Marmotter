/**
 * Opening a link in the platform's default browser.
 *
 * The app's own webview cannot navigate to an arbitrary page, so a confirmed
 * link is handed to a Rust command that opens the system browser. Web has no
 * such need — a browser tab opens a link itself — so this exists only here.
 */

import { invoke } from '@tauri-apps/api/core';

/** Opens a URL in the system browser. Fire-and-forget: a failure is logged. */
export function openExternalUrl(url: string): void {
  void invoke('open_external_url', { url }).catch((error: unknown) => {
    console.error('opening a link failed', error);
  });
}
