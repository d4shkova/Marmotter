/**
 * When a network will answer a channel list.
 *
 * Several ircds refuse `LIST` for the first stretch of a connection — it is one
 * of the most expensive things a client can ask for, so it sits behind the same
 * anti-flood gate as the rest, and the refusal comes back as `421` rather than
 * as anything that explains itself. "This network doesn't recognise LIST" is
 * both what the server said and completely untrue: it recognises it fine, it
 * just will not do it yet.
 *
 * So the client waits rather than passing that on. Ninety seconds clears the
 * gate on every network tested, and saying "try again in forty seconds" is a
 * sentence somebody can act on, where a numeric-derived error is not.
 */

/** How long after signing in a channel list is worth asking for. */
export const LIST_SETTLE_MS = 90_000;

export interface ListReadiness {
  readonly ready: boolean;
  /** Whole seconds left to wait, rounded up. Zero once ready. */
  readonly waitSeconds: number;
}

/** Whether a network has been connected long enough to be asked for its list. */
export function listReadiness(
  network: { readonly registeredAt: Date | undefined },
  now: Date = new Date(),
): ListReadiness {
  if (network.registeredAt === undefined) {
    return { ready: false, waitSeconds: Math.ceil(LIST_SETTLE_MS / 1000) };
  }
  const remaining = LIST_SETTLE_MS - (now.getTime() - network.registeredAt.getTime());
  return remaining <= 0
    ? { ready: true, waitSeconds: 0 }
    : { ready: false, waitSeconds: Math.ceil(remaining / 1000) };
}

/** Why the list cannot be asked for yet, in the interface's voice. */
export function describeWait(networkName: string, waitSeconds: number): string {
  return `${networkName} won't answer a channel list this soon after connecting. Try again in ${waitSeconds} ${waitSeconds === 1 ? 'second' : 'seconds'}.`;
}
