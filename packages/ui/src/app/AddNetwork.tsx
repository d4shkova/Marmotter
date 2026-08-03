import type {
  AuthConfig,
  NetworkProfile,
  SecretRef,
  ServerEndpoint,
  TlsConfig,
} from '@marmotter/shared';
import { NETWORKS, defaultLoggingPolicy, findNetwork } from '@marmotter/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '../primitives/Button.js';
import { RadioGroup } from '../primitives/Radio.js';
import { Select, type SelectOption } from '../primitives/Select.js';
import { Sheet } from '../primitives/Sheet.js';
import { TextField } from '../primitives/TextField.js';
import { Toggle } from '../primitives/Toggle.js';
import { hasSecret, putSecret, replaceSecret } from './secrets.js';

/** The value the network picker uses for "not one of these". */
const CUSTOM = 'custom';

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

/** How to sign in, as a person would describe it rather than as a mechanism. */
type LoginMethod = 'none' | 'sasl' | 'nickserv';

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

/** Which login method a saved profile was using. */
const loginOf = (auth: AuthConfig | undefined): LoginMethod => {
  switch (auth?.type) {
    case 'sasl-plain':
    case 'sasl-scram':
    case 'sasl-external':
      return 'sasl';
    case 'nickserv':
      return 'nickserv';
    default:
      return 'none';
  }
};

/** The account name saved against a login method, where it has one. */
const accountOf = (auth: AuthConfig | undefined): string =>
  auth?.type === 'sasl-plain' || auth?.type === 'sasl-scram' || auth?.type === 'nickserv'
    ? auth.account
    : '';

/**
 * The network picker's options.
 *
 * The large networks first, then the escape hatch, then everything else
 * alphabetically — "Somewhere else" sits near the top because a hundred and
 * thirty names below it is a long way to scroll to say "none of these".
 */
const NETWORK_OPTIONS: readonly SelectOption[] = [
  ...NETWORKS.filter((network) => network.popular === true).map((network) => ({
    value: network.id,
    label: network.name,
    group: 'Popular networks',
  })),
  { value: CUSTOM, label: 'Somewhere else…', group: 'Not listed' },
  ...NETWORKS.filter((network) => network.popular !== true).map((network) => ({
    value: network.id,
    label: network.name,
    group: 'All networks',
  })),
];

export interface AddNetworkProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAdd: (profile: NetworkProfile) => void;
  /**
   * The network being changed, when this is an edit rather than an addition.
   *
   * Everything the form does not show — the autojoin list, connect commands,
   * the logging policy — is carried through untouched, so editing an address
   * cannot quietly discard the rest of somebody's setup.
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
  const [choice, setChoice] = useState<string>('libera-chat');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6697');
  /** Whether the port is the person's number or the form's, which decides
      whether changing the security setting may replace it. */
  const [portEdited, setPortEdited] = useState(false);
  const [nick, setNick] = useState('');
  const [security, setSecurity] = useState<Security>('verified');
  const [socketUrl, setSocketUrl] = useState('');
  const [login, setLogin] = useState<LoginMethod>('none');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  /** True when a password is already stored and the field is deliberately blank. */
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [operatorCommands, setOperatorCommands] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Opening the sheet loads whatever it is opening onto: a blank form for a new
  // network, the saved values for one being edited.
  useEffect(() => {
    if (!open) {
      return;
    }
    setError(undefined);
    setPassword('');
    if (editing === undefined) {
      setChoice('libera-chat');
      setName('');
      setHost('');
      setPort(String(PORT_FOR.verified));
      setPortEdited(false);
      setNick('');
      setSecurity('verified');
      setSocketUrl('');
      setLogin('none');
      setAccount('');
      setPasswordSaved(false);
      setOperatorCommands(false);
      return;
    }

    const endpoint = editing.servers[0];
    const mode = securityOf(endpoint);
    setChoice(CUSTOM);
    setName(editing.name);
    setHost(endpoint?.host ?? '');
    setPort(String(endpoint?.port ?? PORT_FOR[mode]));
    // A saved port is somebody's decision, whatever it is.
    setPortEdited(true);
    setNick(editing.identity.nick);
    setSecurity(mode);
    setSocketUrl(endpoint?.tls.mode === 'websocket' ? endpoint.tls.url : '');
    setLogin(loginOf(editing.auth));
    setAccount(accountOf(editing.auth));
    setPasswordSaved(hasSecret(secretOf(editing.auth)));
    setOperatorCommands(editing.operatorCommands === true);
  }, [open, editing]);

  const chosen = findNetwork(choice);
  // An edit always shows the fields directly: the directory is a shortcut for
  // filling in a blank form, not a description of a network already saved.
  const custom = choice === CUSTOM || editing !== undefined;

  const effective = {
    name: custom ? name : (chosen?.name ?? ''),
    host: custom ? host : (chosen?.host ?? ''),
    port: custom ? Number.parseInt(port, 10) : (chosen?.port ?? PORT_FOR.verified),
  };

  const usesSocket = security === 'websocket';

  /** Picking a network sets where it is and how it expects to be reached. */
  const changeNetwork = (next: string): void => {
    setChoice(next);
    const network = findNetwork(next);
    if (network === undefined) {
      return;
    }
    const wanted: Security = network.tls ? 'verified' : 'off';
    setSecurity(wanted);
    if (!portEdited) {
      setPort(String(network.port));
    }
  };

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
    operatorCommands,
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

  /**
   * The authentication for the chosen login method.
   *
   * The password goes to the secret store and only its reference goes into the
   * profile, so nothing holding a profile is holding a password. An existing
   * reference is written through rather than replaced, which is what lets
   * somebody edit a network's address without retyping a password they already
   * gave — and what makes an empty password field on an edit mean "leave it"
   * rather than "clear it".
   */
  const authFor = (): AuthConfig | undefined => {
    if (login === 'none') {
      return undefined;
    }
    const previous = secretOf(editing?.auth);
    const typed = password.trim();
    const ref =
      typed !== ''
        ? previous === undefined
          ? putSecret(typed)
          : replaceSecret(previous, typed)
        : previous;
    if (ref === undefined) {
      return undefined;
    }
    // SASL PLAIN rather than SCRAM: every network offering SASL offers PLAIN,
    // and it is only ever sent inside TLS. SCRAM is chosen by the profile, not
    // guessed at here.
    return login === 'sasl'
      ? { type: 'sasl-plain', account: account.trim(), password: ref }
      : { type: 'nickserv', account: account.trim(), password: ref };
  };

  /** Complains about a login that cannot work, or returns nothing. */
  const loginProblem = (): string | undefined => {
    if (login === 'none') {
      return undefined;
    }
    if (account.trim() === '') {
      return 'Enter the account name you signed up with, or set signing in to Not signed in.';
    }
    if (password.trim() === '' && !passwordSaved) {
      return 'Enter the password for that account.';
    }
    return undefined;
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
    const problem = loginProblem();
    if (problem !== undefined) {
      setError(problem);
      return;
    }

    const endpoint: ServerEndpoint = {
      host: effective.host.trim(),
      port: effective.port,
      tls: TLS_FOR[security],
    };
    const auth = authFor();

    onAdd({
      id: editing?.id ?? newId?.() ?? crypto.randomUUID(),
      name: effective.name.trim() === '' ? endpoint.host : effective.name.trim(),
      servers: [endpoint],
      identity: identityFor(nick.trim()),
      ...carried,
      ...(auth === undefined ? {} : { auth }),
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
    const problem = loginProblem();
    if (problem !== undefined) {
      setError(problem);
      return;
    }

    const auth = authFor();

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
      ...(auth === undefined ? {} : { auth }),
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
          <Select
            label="Which network?"
            labelNote="Click to select"
            value={choice}
            onChange={(event) => changeNetwork(event.target.value)}
            options={NETWORK_OPTIONS}
            hint={
              chosen === undefined
                ? 'Enter a server below.'
                : `${chosen.host} on port ${chosen.port}${chosen.tls ? ', encrypted' : ', not encrypted'}.`
            }
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

        <RadioGroup
          legend="Signing in"
          value={login}
          onChange={(next) => setLogin(next as LoginMethod)}
          options={[
            {
              value: 'none',
              label: 'Not signed in',
              description: 'Fine for most networks, and for a name nobody has registered.',
            },
            {
              value: 'sasl',
              label: 'Sign in while connecting',
              description:
                'Recommended where the network offers it. Your name is yours before anybody else can see you online.',
            },
            {
              value: 'nickserv',
              label: 'Sign in after connecting',
              description:
                'For older networks. Sends your password to the account service once you are on, which means a moment where you are online and not yet signed in.',
            },
          ]}
        />

        {login === 'none' ? null : (
          <>
            <TextField
              label="Account name"
              value={account}
              placeholder={nick === '' ? 'marmot' : nick}
              onChange={(event) => setAccount(event.target.value)}
              hint="The account you registered with the network, which is often the same as your name."
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              autoComplete="off"
              onChange={(event) => setPassword(event.target.value)}
              hint={
                passwordSaved && password === ''
                  ? 'A password is saved for this network. Leave this empty to keep it.'
                  : security === 'off'
                    ? 'This network is set to connect unencrypted, so this password is readable by anyone in between.'
                    : 'Kept for this session only, and never written to disk.'
              }
            />
          </>
        )}

        <Toggle
          label="I am a server operator on this network"
          hint="Offers the operator commands — sign in as an operator, disconnect somebody, message every operator — in the command bar. It grants nothing: the network decides what you may actually do."
          checked={operatorCommands}
          onChange={setOperatorCommands}
        />

        {error === undefined ? null : (
          <p role="alert" className="text-footnote text-[var(--danger)]">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** The secret reference a login method carries, where it carries one. */
function secretOf(auth: AuthConfig | undefined): SecretRef | undefined {
  switch (auth?.type) {
    case 'sasl-plain':
    case 'sasl-scram':
    case 'nickserv':
    case 'server-password':
      return auth.password;
    default:
      return undefined;
  }
}
