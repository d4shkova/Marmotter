import type { NetworkState } from '@marmotter/client';
import type { ReactNode } from 'react';
import { StatusDot, type ConnectionStatus } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { ListRow } from '../primitives/ListRow.js';
import { Stepper } from '../primitives/Stepper.js';
import { Toggle } from '../primitives/Toggle.js';
import { ListGroup } from '../layout/ListGroup.js';
import type { Appearance } from './view-store.js';

export interface SettingsProps {
  readonly networks: readonly NetworkState[];
  readonly appearance: Appearance;
  readonly onAppearanceChange: (changes: Partial<Appearance>) => void;
  /** Reconnects a network whose connection dropped or failed. */
  readonly onReconnect: (networkId: string) => void;
  readonly onDisconnect: (networkId: string) => void;
  /** Forgets a network and tears its connection down. */
  readonly onRemove: (networkId: string) => void;
  readonly onAddNetwork: () => void;
  readonly className?: string;
}

const statusOf = (network: NetworkState): ConnectionStatus => {
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
};

const statusText = (network: NetworkState): string => {
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
};

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

/**
 * The settings screen.
 *
 * This is where a network is removed from — the one place a person expects to
 * manage the networks they have added — and where a failed connection can be
 * retried with the reason for the failure shown next to it, rather than a
 * server tab that says "connecting" forever.
 *
 * The appearance controls change the message list live, so a person can see
 * what right-aligned nicks or a wider nick column does to the density they are
 * about to read a thousand lines at.
 */
export function Settings({
  networks,
  appearance,
  onAppearanceChange,
  onReconnect,
  onDisconnect,
  onRemove,
  onAddNetwork,
  className,
}: SettingsProps): ReactNode {
  return (
    <div className={className}>
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6">
        <h1 className="text-title-2 font-bold text-[var(--label-primary)]">Settings</h1>

        <ListGroup
          header="Networks"
          footer="Networks are stored on this device only, and never sent anywhere."
        >
          {networks.length === 0 ? (
            <ListRow title="No networks yet" subtitle="Add one to start talking." />
          ) : (
            networks.map((network) => (
              <ListRow
                key={network.id}
                leading={<StatusDot status={statusOf(network)} />}
                title={network.name}
                subtitle={statusText(network)}
                trailing={
                  <div className="flex items-center gap-1.5">
                    {network.phase === 'registered' || network.phase === 'registering' ? (
                      <Button size="small" onClick={() => onDisconnect(network.id)}>
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="secondary"
                        busy={network.phase === 'connecting'}
                        onClick={() => onReconnect(network.id)}
                      >
                        {network.phase === 'connecting' ? 'Connecting' : 'Connect'}
                      </Button>
                    )}
                    <Button size="small" variant="destructive" onClick={() => onRemove(network.id)}>
                      Remove
                    </Button>
                  </div>
                }
              />
            ))
          )}
        </ListGroup>

        <div className="px-1">
          <Button variant="primary" onClick={onAddNetwork}>
            Add a network
          </Button>
        </div>

        <ListGroup
          header="Message list"
          footer="These change how messages are laid out. The window updates as you change them."
        >
          <div className="px-4 py-3">
            <Toggle
              label="Group join, part and quit messages"
              hint="Folds a burst of them into one line, rather than showing each."
              checked={appearance.foldEvents}
              onChange={(foldEvents) => onAppearanceChange({ foldEvents })}
            />
          </div>
          <div className="px-4 py-3">
            <Toggle
              label="Show timestamps"
              checked={appearance.showTimestamps}
              onChange={(showTimestamps) => onAppearanceChange({ showTimestamps })}
            />
          </div>
          <div className="px-4 py-3">
            <Toggle
              label="Line names up against the message"
              hint="Puts the name on the right edge of its column, as HexChat does."
              checked={appearance.alignNicksRight}
              onChange={(alignNicksRight) => onAppearanceChange({ alignNicksRight })}
            />
          </div>
          <div className="px-4 py-3">
            <Stepper
              label="Name column width"
              value={appearance.nickColumnWidth}
              min={6}
              max={24}
              onChange={(nickColumnWidth) => onAppearanceChange({ nickColumnWidth })}
            />
          </div>
        </ListGroup>

        <ListGroup
          header="Links"
          footer="Marmotter never asks another site for a preview unless you turn this on: doing so would tell that site your address."
        >
          <div className="px-4 py-3">
            <Toggle
              label="Show a preview for links"
              hint="Off by default. A preview means asking the linked site for it, which reveals your address to it."
              checked={appearance.unfurlLinks}
              onChange={(unfurlLinks) => onAppearanceChange({ unfurlLinks })}
            />
          </div>
        </ListGroup>
      </div>
    </div>
  );
}
