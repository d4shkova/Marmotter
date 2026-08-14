/**
 * Where a network's connection stands, in a dot and a sentence.
 *
 * Shared rather than written twice: the settings screen and the launch screen
 * both list every configured network with its state beside it, and two versions
 * of this is how the same network comes to read as "Connected as marmot" on one
 * screen and "Connected" on the other.
 */

import type { NetworkState } from '@marmotter/client';
import type { ConnectionStatus } from '../primitives/Badge.js';

/** The status dot for a network. */
export function connectionStatus(network: NetworkState): ConnectionStatus {
  switch (network.phase) {
    case 'registered':
      return 'connected';
    case 'connecting':
    case 'registering':
      return 'connecting';
    case 'disconnected':
      return network.lastClose === undefined || network.lastClose.kind === 'user'
        ? 'offline'
        : 'failed';
  }
}

/** The same thing in words, including why a connection ended where that is known. */
export function connectionStatusText(network: NetworkState): string {
  switch (network.phase) {
    case 'registered':
      return `Connected as ${network.nick}`;
    case 'connecting':
      return 'Connecting…';
    case 'registering':
      return 'Signing in…';
    case 'disconnected':
      return describeClose(network);
  }
}

const describeClose = (network: NetworkState): string => {
  const close = network.lastClose;
  if (close === undefined || close.kind === 'user') {
    return 'Not connected';
  }
  switch (close.kind) {
    case 'tls-error':
      return `Could not verify the certificate: ${close.message}`;
    case 'timeout':
      return 'The server did not respond in time';
    case 'server':
      return 'The server closed the connection';
    case 'network-error':
      return close.message === '' ? 'Could not reach the server' : close.message;
  }
};
