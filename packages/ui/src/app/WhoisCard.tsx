import type { NetworkState } from '@marmotter/client';
import { fold } from '@marmotter/protocol';
import type { WhoisProfile } from '@marmotter/protocol';
import type { ReactNode } from 'react';
import { nickColorVar } from '../lib/nick-color.js';
import { Badge } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { Sheet } from '../primitives/Sheet.js';
import { formatDay, formatIdle, formatTime } from './format.js';

export interface WhoisCardProps {
  readonly open: boolean;
  /** The nick that was looked up, spelled as the user reached it. */
  readonly nick: string;
  readonly network: NetworkState;
  readonly onClose: () => void;
  /** Message them straight from the card, so it is not a dead end. */
  readonly onMessage: (nick: string) => void;
}

/**
 * The user profile card — WHOIS as a card, not a wall of numerics.
 *
 * This is the abstraction layer's answer to WHOIS: the same information a power
 * user reads out of 311/312/317/319, laid out as labelled facts a newcomer can
 * take in at a glance. The raw numerics never appear; they were consumed into
 * the profile by the reducer and only the plain-English result shows here.
 *
 * While the reply is still arriving the card says so rather than showing a
 * half-built profile that flickers as lines land.
 */
export function WhoisCard({ open, nick, network, onClose, onMessage }: WhoisCardProps): ReactNode {
  const profile = network.whois.get(fold(nick, network.support.caseMapping));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Profile"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            onClick={() => {
              onMessage(profile?.nick ?? nick);
              onClose();
            }}
          >
            Send a message
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <div className="flex items-center gap-3">
          <span
            className="truncate font-mono text-title-3"
            style={{
              color: `var(${nickColorVar(nick, fold(nick, network.support.caseMapping))})`,
            }}
          >
            {profile?.nick ?? nick}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {profile?.away === undefined ? null : <Badge tone="neutral">Away</Badge>}
            {profile?.isOperator ? <Badge tone="accent">Network operator</Badge> : null}
            {profile?.isBot ? <Badge tone="neutral">Bot</Badge> : null}
            {profile?.secure ? <Badge tone="accent">Secure connection</Badge> : null}
          </div>
        </div>

        {profile === undefined || !profile.complete ? (
          <p className="text-subhead text-[var(--label-tertiary)]">Looking up {nick}…</p>
        ) : (
          <Facts profile={profile} />
        )}
      </div>
    </Sheet>
  );
}

function Facts({ profile }: { profile: WhoisProfile }): ReactNode {
  const rows: { label: string; value: ReactNode }[] = [];

  if (profile.away !== undefined) {
    rows.push({ label: 'Away', value: profile.away });
  }
  if (profile.realname !== undefined && profile.realname !== '') {
    rows.push({ label: 'Real name', value: profile.realname });
  }
  if (profile.account !== undefined) {
    // A logged-in identity is the closest IRC has to "this is really them", so
    // it leads and gets the accent tick.
    rows.push({
      label: 'Account',
      value: (
        <span className="inline-flex items-center gap-1 text-[var(--accent)]">
          <span aria-hidden="true">✓</span>
          {profile.account}
        </span>
      ),
    });
  } else {
    rows.push({ label: 'Account', value: 'Not logged in' });
  }

  const host =
    profile.user !== undefined && profile.host !== undefined
      ? `${profile.user}@${profile.host}`
      : profile.host;
  if (host !== undefined) {
    rows.push({ label: 'Host', value: <span className="font-mono">{host}</span> });
  }
  if (profile.actualHost !== undefined && profile.actualHost !== profile.host) {
    rows.push({
      label: 'Connecting from',
      value: <span className="font-mono">{profile.actualHost}</span>,
    });
  }
  if (profile.server !== undefined) {
    rows.push({
      label: 'Server',
      value:
        profile.serverInfo === undefined || profile.serverInfo === ''
          ? profile.server
          : `${profile.server} — ${profile.serverInfo}`,
    });
  }
  if (profile.idleSeconds !== undefined && profile.idleSeconds > 0) {
    rows.push({ label: 'Idle', value: formatIdle(profile.idleSeconds) });
  }
  if (profile.signonAt !== undefined) {
    rows.push({
      label: 'Signed on',
      value: `${formatDay(profile.signonAt)} at ${formatTime(profile.signonAt)}`,
    });
  }

  return (
    <>
      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-3">
            <dt className="w-28 shrink-0 text-subhead text-[var(--label-tertiary)]">{row.label}</dt>
            <dd className="min-w-0 flex-1 text-subhead break-words text-[var(--label-primary)]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {profile.channels.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead text-[var(--label-tertiary)]">
            {profile.channels.length === 1
              ? 'In 1 channel'
              : `In ${profile.channels.length} channels`}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {profile.channels.map((channel) => (
              <span
                key={channel}
                className="rounded-control bg-[var(--fill-tertiary)] px-2 py-0.5 font-mono text-caption-1 text-[var(--label-secondary)]"
              >
                {channel}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
