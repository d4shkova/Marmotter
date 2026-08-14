/**
 * What Marmotter opens on once it has been set up.
 *
 * The first launch asks for a name and then a network. Every launch after that
 * has neither question to ask and used to say "Nothing open yet. Add a network
 * to start talking." to somebody with four networks already configured — a
 * greeting that names the one thing they have already done.
 *
 * Networks are restored but deliberately not connected: a client that dials out
 * the moment it opens cannot be started to change a setting, and having left
 * three networks configured is not the same as having asked to be signed in to
 * all three. So this is the screen that asks. Connecting to everything is one
 * button, because that is what most people want most mornings, and the list
 * underneath is there for the times it is not.
 */

import { type ReactNode, useState } from 'react';
import { Badge, StatusDot, type ConnectionStatus } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { Checkbox } from '../primitives/Checkbox.js';
import { cn } from '../lib/cn.js';

/** One configured network, as this screen needs it. */
export interface LaunchNetwork {
  readonly id: string;
  readonly name: string;
  /** Where the connection stands right now. */
  readonly status: ConnectionStatus;
  /** A word for that state, e.g. "Connected as marmot". */
  readonly statusText: string;
  /** Channels the profile joins on connecting, for the second line. */
  readonly autojoin: readonly string[];
}

export interface LaunchProps {
  readonly networks: readonly LaunchNetwork[];
  /** Connects exactly these, in one go. */
  readonly onConnect: (networkIds: readonly string[]) => void;
  /** Leaves everything disconnected and gets out of the way. */
  readonly onSkip: () => void;
  readonly onAddNetwork: () => void;
  readonly className?: string;
}

/**
 * Which networks a launch starts with ticked.
 *
 * Everything that is not already connected. Pure and exported because the rule
 * is the whole behaviour of the screen: pre-ticking nothing makes the common
 * case — connect to what I had — a tour of every checkbox, and pre-ticking a
 * network that is already up would offer to connect it twice.
 */
export function initialSelection(networks: readonly LaunchNetwork[]): readonly string[] {
  return networks.filter((entry) => entry.status !== 'connected').map((entry) => entry.id);
}

export function Launch({
  networks,
  onConnect,
  onSkip,
  onAddNetwork,
  className,
}: LaunchProps): ReactNode {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(initialSelection(networks)),
  );

  const selectable = networks.filter((entry) => entry.status !== 'connected');
  const selected = selectable.filter((entry) => chosen.has(entry.id));
  const allChosen = selectable.length > 0 && selected.length === selectable.length;

  const toggle = (id: string): void => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className={cn('overflow-y-auto', className)}>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-title-1 text-[var(--label-primary)]">Welcome back</h1>
          <p className="text-callout text-[var(--label-secondary)]">
            {selectable.length === 0
              ? 'Every network you have set up is connected.'
              : 'Marmotter does not connect on its own. Pick the networks to sign in to now — the rest stay where they are until you ask.'}
          </p>
        </div>

        {networks.length === 0 ? null : (
          <div className="overflow-hidden rounded-card border border-[var(--separator)] bg-[var(--bg-elevated)]">
            {networks.map((entry) => {
              const connected = entry.status === 'connected';
              return (
                <div
                  key={entry.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3',
                    'border-b border-[var(--separator)] last:border-b-0',
                  )}
                >
                  <Checkbox
                    // A connected network has nothing to connect, so its row
                    // says so rather than offering to do it again.
                    checked={connected || chosen.has(entry.id)}
                    disabled={connected}
                    onChange={() => toggle(entry.id)}
                    label={`Connect to ${entry.name}`}
                    labelHidden
                  />
                  <StatusDot status={entry.status} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body text-[var(--label-primary)]">
                      {entry.name}
                    </span>
                    <span className="truncate text-footnote text-[var(--label-tertiary)]">
                      {entry.autojoin.length === 0
                        ? entry.statusText
                        : `${entry.statusText} · joins ${entry.autojoin.join(', ')}`}
                    </span>
                  </div>
                  {connected ? <Badge tone="accent">Connected</Badge> : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={selected.length === 0}
            onClick={() => onConnect(selected.map((entry) => entry.id))}
          >
            {allChosen && selectable.length > 1
              ? 'Connect to all of them'
              : selected.length === 1
                ? 'Connect'
                : `Connect to ${selected.length}`}
          </Button>
          {selectable.length < 2 ? null : (
            <Button
              onClick={() =>
                setChosen(allChosen ? new Set() : new Set(selectable.map((entry) => entry.id)))
              }
            >
              {allChosen ? 'Clear all' : 'Select all'}
            </Button>
          )}
          <Button variant="plain" onClick={onSkip}>
            Not now
          </Button>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--separator)] pt-4">
          <p className="flex-1 text-footnote text-[var(--label-tertiary)]">
            Networks are kept on this device only, and never sent anywhere.
          </p>
          <Button size="small" onClick={onAddNetwork}>
            Add a network
          </Button>
        </div>
      </div>
    </div>
  );
}
