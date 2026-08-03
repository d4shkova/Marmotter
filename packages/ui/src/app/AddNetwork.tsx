import type { NetworkProfile, ServerEndpoint, TlsConfig } from '@marmotter/shared';
import { defaultLoggingPolicy } from '@marmotter/shared';
import { type ReactNode, useEffect, useState } from 'react';
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

type Security = 'verified' | 'pinned' | 'off' | 'websocket';

const TLS_FOR: Record<Exclude<Security, 'websocket'>, TlsConfig> = {
  verified: { mode: 'tls', verifyCert: true },
  pinned: { mode: 'tls', verifyCert: false },
  off: { mode: 'off' },
};

/**
 * The port each kind of connection conventionally listens on.
 *
 * Every network on the planet agrees on these two numbers, so making somebody
 * change 6697 to 6667 by hand after saying "not encrypted" is asking them to
 * know a fact the form already knows. The field stays editable: agreement is
 * not universality, and a network on 7000 is not unusual.
 */
const PORT_FOR: Record<Security, number> = {
  verified: 6697,
  pinned: 6697,
  off: 6667,
  websocket: 443,
};

/** Which security choice an existing endpoint was saved with. */
const securityOf = (endpoint: ServerEndpoint | undefined): Security => {
  const tls = endpoint?.tls;
  if (tls === undefined) {
    return 'verified';
  }
  switch (tls.mode) {
    case 'off':
      return 'off';
    case 'websocket':
      return 'websocket';
    case 'tls':
      return tls.verifyCert ? 'verified' : 'pinned';
  }
};

export interface AddNetworkProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAdd: (profile: NetworkProfile) => void;
  /**
   * The network being changed, when this is an edit rather than an addition.
   *
   * Everything the form does not show — the autojoin list, connect commands,
   * the logging policy, the saved credential — is carried through untouched, so
   * editing an address cannot quietly discard the rest of somebody's setup.
   */
  readonly editing?: NetworkProfile;
  /** Generates the profile ID. Injected so tests are deterministic. */
  readonly newId?: () => string;
}

/**
 * The "Add a network" flow, and the "Edit network" flow, which are the same
 * form asked at two different times.
 *
 * The security choice is made here, per endpoint, at profile-creation time —
 * and each option says what it means for the person rather than naming a
 * protocol setting. "Not encrypted" spells out that anyone in between can read
 * the password, because that is the consequence and nobody should have to
 * already know it.
 */
export function AddNetwork({ open, onClose, onAdd, editing, newId }: AddNetworkProps): ReactNode {
  const [preset, setPreset] = useState<string>('libera');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6697');
  /** Whether the port is the person's number or the form's, which decides
      whether changing the security setting may replace it. */
  const [portEdited, setPortEdited] = useState(false);
  const [nick, setNick] = useState('');
  const [security, setSecurity] = useState<Security>('verified');
  const [socketUrl, setSocketUrl] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  // Opening the sheet loads whatever it is opening onto: a blank form for a new
  // network, the saved values for one being edited.
  useEffect(() => {
    if (!open) {
      return;
    }
    setError(undefined);
    if (editing === undefined) {
      setPreset('libera');
      setName('');
      setHost('');
      setPort(String(PORT_FOR.verified));
      setPortEdited(false);
      setNick('');
      setSecurity('verified');
      setSocketUrl('');
      return;
    }

    const endpoint = editing.servers[0];
    const mode = securityOf(endpoint);
    setPreset('custom');
    setName(editing.name);
    setHost(endpoint?.host ?? '');
    setPort(String(endpoint?.port ?? PORT_FOR[mode]));
    // A saved port is somebody's decision, whatever it is.
    setPortEdited(true);
    setNick(editing.identity.nick);
    setSecurity(mode);
    setSocketUrl(endpoint?.tls.mode === 'websocket' ? endpoint.tls.url : '');
  }, [open, editing]);

  const chosen = PRESETS.find((entry) => entry.id === preset);
  // An edit always shows the fields directly: the presets are a shortcut for
  // filling in a blank form, not a description of a network already saved.
  const custom = preset === 'custom' || editing !== undefined;

  const effective = {
    name: custom ? name : (chosen?.name ?? ''),
    host: custom ? host : (chosen?.host ?? ''),
    port: custom ? Number.parseInt(port, 10) : (chosen?.port ?? PORT_FOR.verified),
  };

  const usesSocket = security === 'websocket';

  const changeSecurity = (next: string): void => {
    const value = next as Security;
    setSecurity(value);
    if (!portEdited) {
      setPort(String(PORT_FOR[value]));
    }
  };

  /** What to keep from an edited profile, or the defaults for a new one. */
  const carried = {
    autojoin: editing?.autojoin ?? [],
    connectCommands: editing?.connectCommands ?? [],
    encoding: editing?.encoding ?? 'utf-8',
    autoReconnect: editing?.autoReconnect ?? true,
    logging: editing?.logging ?? defaultLoggingPolicy,
    ...(editing?.auth === undefined ? {} : { auth: editing.auth }),
  };

  /**
   * The identity for a nick.
   *
   * On an edit the alternates, username and real name are the user's own and
   * are kept — except the alternates we generated ourselves for the previous
   * nick, which would otherwise leave somebody called `marmot` falling back to
   * a name they have never used.
   */
  const identityFor = (chosenNick: string): NetworkProfile['identity'] => {
    const derived = [`${chosenNick}_`, `${chosenNick}__`];
    if (editing === undefined) {
      return {
        nick: chosenNick,
        // A second and third try, so a taken name does not stop the connection.
        altNicks: derived,
        username: chosenNick,
        realname: chosenNick,
      };
    }
    const previous = editing.identity;
    const wasGenerated =
      previous.altNicks.length === 2 &&
      previous.altNicks[0] === `${previous.nick}_` &&
      previous.altNicks[1] === `${previous.nick}__`;
    return {
      ...previous,
      nick: chosenNick,
      altNicks: wasGenerated ? derived : previous.altNicks,
    };
  };

  const submit = (): void => {
    if (usesSocket) {
      submitSocket();
      return;
    }
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
      id: editing?.id ?? newId?.() ?? crypto.randomUUID(),
      name: effective.name.trim() === '' ? endpoint.host : effective.name.trim(),
      servers: [endpoint],
      identity: identityFor(nick.trim()),
      ...carried,
    });

    setError(undefined);
    onClose();
  };

  /**
   * A WebSocket endpoint is a URL, not a host and a port.
   *
   * It is also the only kind of endpoint the browser build can open at all, so
   * leaving it out of this form would mean the web app could never add a
   * network it could reach.
   */
  const submitSocket = (): void => {
    const url = socketUrl.trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setError('That is not a web address. It should start with wss:// or ws://.');
      return;
    }
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
      setError('A web address for IRC starts with wss:// — or ws:// for an unencrypted one.');
      return;
    }
    if (nick.trim() === '') {
      setError('Choose a name for other people to see.');
      return;
    }

    onAdd({
      id: editing?.id ?? newId?.() ?? crypto.randomUUID(),
      name: effective.name.trim() === '' ? parsed.hostname : effective.name.trim(),
      servers: [
        {
          host: parsed.hostname,
          port: parsed.port === '' ? (parsed.protocol === 'wss:' ? 443 : 80) : Number(parsed.port),
          tls: { mode: 'websocket', url },
        },
      ],
      identity: identityFor(nick.trim()),
      ...carried,
    });

    setError(undefined);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing === undefined ? 'Add a network' : `Edit ${editing.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {editing === undefined ? 'Add network' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 pt-2">
        {editing === undefined ? (
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
        ) : (
          <p className="text-subhead text-[var(--label-secondary)]">
            These take effect on the next connection. If this network is connected now, saving
            reconnects it so it is running on what you saved.
          </p>
        )}

        {custom && usesSocket ? (
          <>
            <TextField
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              hint="What this network is called in the sidebar."
            />
            <TextField
              label="Web address"
              value={socketUrl}
              placeholder="wss://irc.example.net/webirc"
              onChange={(event) => setSocketUrl(event.target.value)}
              hint="Some networks offer one of these. It is the only kind of address a browser can open."
            />
          </>
        ) : custom ? (
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
              onChange={(event) => {
                setPortEdited(true);
                setPort(event.target.value);
              }}
              hint={
                portEdited
                  ? 'Your own number. Changing the security setting leaves it alone.'
                  : `Set to ${PORT_FOR[security]} to match the security setting. Change it and it stays as you leave it.`
              }
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
          onChange={changeSecurity}
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
            {
              value: 'websocket',
              label: 'A web address',
              description:
                'For a network that offers one. This is the only kind a browser can open, and it needs the address rather than a server and port.',
              disabled: !custom,
            },
          ]}
        />
      </div>
    </Sheet>
  );
}
