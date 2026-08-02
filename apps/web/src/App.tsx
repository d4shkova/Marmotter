import { type WebSocketLike, createWebSocketTransport } from '@marmotter/client';
import { Marmotter } from '@marmotter/ui';
import type { JSX } from 'react';
import type { NetworkProfile, Transport } from '@marmotter/shared';

/**
 * The browser app.
 *
 * A browser cannot open a TCP socket, so a network is reachable here only if it
 * exposes a WebSocket listener. The relay that covers the rest arrives in
 * Phase 8; until then a profile without one says so rather than failing
 * silently.
 *
 * Nothing is persisted. No profile, no scrollback, no message content — the
 * conversation dies with the tab, which is the guarantee CLAUDE.md makes for
 * this platform and the reason `persists` is not passed.
 */
function createTransport(profile: NetworkProfile): Transport {
  const endpoint = profile.servers[0];
  if (endpoint?.tls.mode !== 'websocket') {
    throw new Error(
      `${profile.name} does not offer a WebSocket connection, which is the only kind a browser can open.`,
    );
  }
  // The browser's WebSocket types its handlers more precisely than the
  // transport's structural slice does, which is a difference in variance
  // rather than in behaviour.
  return createWebSocketTransport(
    (url, protocols) =>
      new WebSocket(url, protocols === undefined ? undefined : [...protocols]) as WebSocketLike,
  );
}

export function App(): JSX.Element {
  return <Marmotter createTransport={createTransport} />;
}
