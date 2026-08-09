/**
 * A connect() rejection that carries why it failed.
 *
 * A transport's `connect` can fail during the handshake — a refused socket, a
 * rejected certificate, a name that does not resolve — and those are not all the
 * same thing. Flattening every one to a generic network error is what stopped
 * the interface offering to trust a self-signed certificate: the certificate
 * failure looked identical to the server being down. This carries the classified
 * reason out of the transport so the session, and the interface above it, can
 * tell a certificate that would not verify from a server that could not be
 * reached.
 */

import type { CloseReason } from '@marmotter/shared';

export class TransportConnectError extends Error {
  readonly reason: CloseReason;

  constructor(reason: CloseReason) {
    super(messageOf(reason));
    this.name = 'TransportConnectError';
    this.reason = reason;
  }
}

/** A human message for a reason, for the Error's own `message`. */
function messageOf(reason: CloseReason): string {
  switch (reason.kind) {
    case 'tls-error':
    case 'network-error':
      return reason.message;
    case 'timeout':
      return 'The server did not answer in time.';
    case 'server':
      return 'The server closed the connection before it was ready.';
    case 'user':
      return 'The connection was closed.';
  }
}

/** The close reason a connect() rejection carries, if it carries one. */
export function connectErrorReason(error: unknown): CloseReason | undefined {
  return error instanceof TransportConnectError ? error.reason : undefined;
}
