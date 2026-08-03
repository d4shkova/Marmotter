import type { Invite } from '@marmotter/client';
import type { ReactNode } from 'react';
import { Button } from '../primitives/Button.js';
import { IconButton } from '../primitives/IconButton.js';

export interface InviteBannerProps {
  readonly invites: readonly Invite[];
  readonly onAccept: (channel: string) => void;
  readonly onDismiss: (channel: string) => void;
  readonly className?: string;
}

/**
 * Incoming invitations, as something you can act on.
 *
 * CLAUDE.md asks for an incoming invite to become an actionable notification
 * rather than a line that scrolls away — which it would, since an `INVITE`
 * arrives as one message among whatever else is happening. So it sits above the
 * conversation until it is answered.
 *
 * Dismissing is local only. IRC has no way to decline an invitation, and a
 * button that claimed to tell somebody "no" while sending nothing would be a
 * lie about what the protocol did.
 */
export function InviteBanner({
  invites,
  onAccept,
  onDismiss,
  className,
}: InviteBannerProps): ReactNode {
  if (invites.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label="Invitations"
      className={`flex flex-col gap-1 border-b border-[var(--separator)] px-4 py-2 ${className ?? ''}`}
    >
      {invites.map((invite) => (
        <li key={invite.channel} className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-subhead text-[var(--label-primary)]">
            <span className="font-semibold">{invite.from}</span> invited you to{' '}
            <span className="font-mono">{invite.channel}</span>
          </p>
          <Button size="small" variant="primary" onClick={() => onAccept(invite.channel)}>
            Join
          </Button>
          <IconButton
            label={`Dismiss the invitation to ${invite.channel}`}
            size="small"
            icon={<span aria-hidden="true">✕</span>}
            onClick={() => onDismiss(invite.channel)}
          />
        </li>
      ))}
    </ul>
  );
}
