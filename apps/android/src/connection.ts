/**
 * Telling the shell when there is a connection worth staying awake for.
 *
 * Android will freeze a backgrounded process and then reclaim it, so an IRC
 * connection survives the app leaving the screen only while a foreground
 * service is running. The shell reports how many networks are registered; this
 * hands that to Rust, which passes it to the Kotlin side that owns the service.
 *
 * Deliberately not conditional on whether the app is actually in the
 * background. Starting the service only at the moment of backgrounding races
 * the platform freezing the process, and the notification it puts in the shade
 * is honest either way: Marmotter really is holding those connections open.
 *
 * The service does not make delivery reliable and the app never suggests it
 * does — see `docs/BUILDING.md`, and the bouncer note in the network form.
 */

import { invoke } from '@tauri-apps/api/core';

/** Says how many networks are connected. Zero stops the service. */
export function holdConnections(connected: number): void {
  void invoke('connection_hold', { connected }).catch((error: unknown) => {
    // A phone that will not run the service drops the connection sooner when
    // the app leaves the screen. Nothing the user can act on mid-conversation,
    // and not worth interrupting them for.
    console.warn('could not update the connection service', error);
  });
}
