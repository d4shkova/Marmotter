/**
 * Turning what the client already holds into what the log stores.
 *
 * A `Message` carries more than a log needs — tags, reply IDs, whether the
 * timestamp came from the server — and a log record deliberately drops it. What
 * is kept is what somebody reading their own logs in a year would want, and
 * nothing that is only meaningful to a running client.
 */

import type { LogRecord } from '@marmotter/shared';
import type { Message } from '../state/types.js';

/** The log record for a message in a network, or undefined if there is none. */
export function toLogRecord(
  message: Message,
  network: { readonly id: string; readonly name: string },
): LogRecord {
  return {
    id: message.id,
    networkId: network.id,
    networkName: network.name,
    target: message.target,
    at: message.at,
    kind: message.kind,
    nick: message.source?.nick ?? '',
    text: message.text,
  };
}
