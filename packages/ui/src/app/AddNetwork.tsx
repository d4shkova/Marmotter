import type { NetworkProfile, ServerEndpoint, TlsConfig } from '@marmotter/shared';
import { defaultLoggingPolicy } from '@marmotter/shared';
import { type ReactNode, useState } from 'react';
import { Button } from '../primitives/Button.js';
import { RadioGroup } from '../primitives/Radio.js';
import { Sheet } from '../primitives/Sheet.js';
import { TextField } from '../primitives/TextField.js';

export interface NetworkPreset {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly description: string;
}

/**
 * The networks offered up front.
 *
 * All three default to TLS on 6697 with verification on, which is the default
 * CLAUDE.md sets for any new profile.
 */
export const PRESETS: readonly NetworkPreset[] = [
  {
    id: 'libera',
    name: 'Libera.Chat',
    host: 'irc.libera.chat',
    port: 6697,
    description: 'Where most open-source projects talk.',
  },
  {
    id: 'oftc',
    name: 'OFTC',
    host: 'irc.oftc.net',
    port: 6697,
    description: 'Home to Debian, Tor, and others.',
  },
  {
    id: 'dashkova',
    name: 'dashkova.co.uk',
    host: 'irc.dashkova.co.uk',
    port: 6697,
    description: 'A small private network.',
  },
];

type Security = 'verified' | 'pinned' | 'off';

const TLS_FOR: Record<Security, TlsConfig> = {
  verified: { mode: 'tls', verifyCert: true },
  pinned: { mode: 'tls', verifyCert: false },
  off: { mode: 'off' },
};

export interface AddNetworkProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAdd: (profile: NetworkProfile) => void;
  /** Generates the profile ID. Injected so tests are deterministic. */
  readonly newId?: () => string;
}

/**
 * The "Add a network" flow.
 *
 * The security choice is made here, per endpoint, at profile-creation time —
 * and each option says what it means for the person rather than naming a
 * protocol setting. "Not encrypted" spells out that anyone in between can read
 * the password, because that is the consequence and nobody should have to
 * already know it.
 */
export function AddNetwork({ open, onClose, onAdd, newId }: AddNetworkProps): ReactNode {
  const [preset, setPreset] = useState<string>('libera');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6697');
  const [nick, setNick] = useState('');
  const [security, setSecurity] = useState<Security>('verified');
  const [error, setError] = useState<string | undefined>(undefined);

  const chosen = PRESETS.find((entry) => entry.id === preset);
  const custom = preset === 'custom';

  const effective = {
    name: custom ? name : (chosen?.name ?? ''),
    host: custom ? host : (chosen?.host ?? ''),
    port: custom ? Number.parseInt(port, 10) : (chosen?.port ?? 6697),
  };

  const submit = (): void => {
    if (effective.host.trim() === '') {
      setError('Enter the address of the server to connect to.');
      return;
    }
    if (nick.trim() === '') {
      setError('Choose a name for other people to see.');
      return;
    }
    if (!Number.isInteger(effective.port) || effective.port < 1 || effective.port > 65535) {
      setError('The port has to be a number between 1 and 65535.');
      return;
    }

    const endpoint: ServerEndpoint = {
      host: effective.host.trim(),
      port: effective.port,
      tls: TLS_FOR[security],
    };

    onAdd({
      id: newId?.() ?? crypto.randomUUID(),
      name: effective.name.trim() === '' ? endpoint.host : effective.name.trim(),
      servers: [endpoint],
      identity: {
        nick: nick.trim(),
        // A second and third try, so a taken name does not stop the connection.
        altNicks: [`${nick.trim()}_`, `${nick.trim()}__`],
        username: nick.trim(),
        realname: nick.trim(),
      },
      autojoin: [],
      connectCommands: [],
      encoding: 'utf-8',
      autoReconnect: true,
      logging: defaultLoggingPolicy,
    });

    setError(undefined);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a network"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Add network
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 pt-2">
        <RadioGroup
          legend="Which network?"
          value={preset}
          onChange={setPreset}
          options={[
            ...PRESETS.map((entry) => ({
              value: entry.id,
              label: entry.name,
              description: entry.description,
            })),
            { value: 'custom', label: 'Somewhere else', description: 'Enter a server yourself.' },
          ]}
        />

        {custom ? (
          <>
            <TextField
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              hint="What this network is called in the sidebar."
            />
            <TextField
              label="Server address"
              value={host}
              placeholder="irc.example.net"
              onChange={(event) => setHost(event.target.value)}
            />
            <TextField
              label="Port"
              value={port}
              inputMode="numeric"
              onChange={(event) => setPort(event.target.value)}
              hint="6697 for an encrypted connection, 6667 for an unencrypted one."
            />
          </>
        ) : null}

        <TextField
          label="Your name on this network"
          value={nick}
          placeholder="marmot"
          onChange={(event) => setNick(event.target.value)}
          hint="Other people see this. You can change it later."
          {...(error === undefined ? {} : { error })}
        />

        <RadioGroup
          legend="Connection security"
          value={security}
          onChange={setSecurity}
          options={[
            {
              value: 'verified',
              label: 'Encrypted, certificate checked',
              description:
                'Recommended. Nobody between you and the server can read or change what you send.',
            },
            {
              value: 'pinned',
              label: 'Encrypted, certificate not checked',
              description:
                'For a server using its own certificate. Still encrypted, but you cannot be sure who you are talking to the first time.',
            },
            {
              value: 'off',
              label: 'Not encrypted',
              description:
                'Anyone between you and the server can read everything you send, including your password.',
            },
          ]}
        />
      </div>
    </Sheet>
  );
}
