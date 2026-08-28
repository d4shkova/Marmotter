import type {
  AuthConfig,
  NetworkProfile,
  SecretRef,
  ServerEndpoint,
  TlsConfig,
} from '@marmotter/shared';
import {
  EMPTY_IDENTITY,
  NETWORKS,
  type DefaultIdentity,
  findNetwork,
  identityFrom,
} from '@marmotter/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '../primitives/Button.js';
import { Field } from '../primitives/Field.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import { Select, type SelectOption } from '../primitives/Select.js';
import { Sheet } from '../primitives/Sheet.js';
import { TextField } from '../primitives/TextField.js';
import { Toggle } from '../primitives/Toggle.js';
import { putSecret, replaceSecret } from './secrets.js';
import { formatAutojoin, parseAutojoin } from './autojoin.js';

/** The value the network picker uses for "not one of these". */
const CUSTOM = 'custom';

/**
 * The security choices, as a person makes them.
 *
 * There is no separate "certificate checked" and "certificate not checked" any
 * more: "Encrypted" means checked, and if the check fails the app offers to
 * connect without it and remembers the answer. So the one thing a person used to
 * have to know up front — whether their server's certificate is signed by a
 * recognised authority — is now discovered for them.
 */
type Security = 'encrypted' | 'off' | 'websocket';

/**
 * The port each kind of connection conventionally listens on.
 *
 * Every network on the planet agrees on these two numbers, so making somebody
 * change 6697 to 6667 by hand after saying "not encrypted" is asking them to
 * know a fact the form already knows. The field stays editable: agreement is
 * not universality, and a network on 7000 is not unusual.
 */
const PORT_FOR: Record<Security, number> = {
  encrypted: 6697,
  off: 6667,
  websocket: 443,
};

/** How to sign in, as a person would describe it rather than as a mechanism. */
type LoginMethod = 'none' | 'sasl' | 'nickserv';

/** Which control a complaint belongs under, and what it says. */
interface FormError {
  readonly field: 'host' | 'port' | 'nick' | 'socket' | 'account' | 'password';
  readonly message: string;
}

/** The message for one field, or nothing if the complaint is about another. */
const errorFor = (error: FormError | undefined, field: FormError['field']): string | undefined =>
  error?.field === field ? error.message : undefined;

/** Which security choice an existing endpoint was saved with. */
const securityOf = (endpoint: ServerEndpoint | undefined): Security => {
  const tls = endpoint?.tls;
  if (tls === undefined) {
    return 'encrypted';
  }
  switch (tls.mode) {
    case 'off':
      return 'off';
    case 'websocket':
      return 'websocket';
    case 'tls':
      // Checked and not-checked are one choice now; the difference is remembered
      // separately so accepting an unverified certificate is not undone on save.
      return 'encrypted';
  }
};

/** Whether a saved endpoint had certificate checking already switched off. */
const certAlreadyAccepted = (endpoint: ServerEndpoint | undefined): boolean =>
  endpoint?.tls.mode === 'tls' && !endpoint.tls.verifyCert;

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
  /**
   * The name and fallbacks the user gave once, at first run.
   *
   * Fills the nick field on a new network so it is not typed again per network.
   * The field stays editable: one network wanting a different name is ordinary,
   * and the fallbacks and real name still come from here.
   */
  readonly defaultIdentity?: DefaultIdentity;
  /**
   * Whether a password typed here will still be here next launch.
   *
   * False on web, and on a desktop machine with no keychain — a Linux session
   * with no Secret Service running has nowhere to put one. The field says which
   * it is, because "remembered" and "not remembered" are both fine and being
   * wrong about which is not.
   */
  readonly remembersPasswords?: boolean;
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
export function AddNetwork({
  open,
  onClose,
  onAdd,
  editing,
  defaultIdentity = EMPTY_IDENTITY,
  remembersPasswords = false,
  newId,
}: AddNetworkProps): ReactNode {
  const [choice, setChoice] = useState<string>('libera-chat');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6697');
  /** Whether the port is the person's number or the form's, which decides
      whether changing the security setting may replace it. */
  const [portEdited, setPortEdited] = useState(false);
  const [nick, setNick] = useState('');
  const [security, setSecurity] = useState<Security>('encrypted');
  /**
   * Whether an unverified certificate was already accepted for this network.
   *
   * Carried through a save so editing the address does not quietly turn checking
   * back on and break a connection the user had already chosen to trust.
   */
  const [certAccepted, setCertAccepted] = useState(false);
  const [socketUrl, setSocketUrl] = useState('');
  const [login, setLogin] = useState<LoginMethod>('none');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  /** True when a password is already stored and the field is deliberately blank. */
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [operatorCommands, setOperatorCommands] = useState(false);
  const [autojoin, setAutojoin] = useState('');
  /**
   * What is wrong, and which field it is wrong in.
   *
   * Named rather than a single message at the foot of the form: an error
   * printed under the control that caused it is the one a person reads, and a
   * form this long can scroll the foot out of sight entirely.
   */
  const [error, setError] = useState<FormError | undefined>(undefined);

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
      setPort(String(PORT_FOR.encrypted));
      setPortEdited(false);
      // Starts from the name given at first run, so the common case is one
      // fewer field to fill in. Still editable: a different name on one
      // network is ordinary.
      setNick(defaultIdentity.nick);
      setSecurity('encrypted');
      setCertAccepted(false);
      setSocketUrl('');
      setLogin('none');
      setAccount('');
      setPasswordSaved(false);
      setOperatorCommands(false);
      setAutojoin('');
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
    setCertAccepted(certAlreadyAccepted(endpoint));
    setSocketUrl(endpoint?.tls.mode === 'websocket' ? endpoint.tls.url : '');
    setLogin(loginOf(editing.auth));
    setAccount(accountOf(editing.auth));
    // A reference is enough: on a profile restored from disk the value itself
    // is in the keychain rather than in this session's memory, and reading the
    // in-memory store would report "no password saved" for every network the
    // user configured last week.
    setPasswordSaved(secretOf(editing.auth) !== undefined);
    setOperatorCommands(editing.operatorCommands === true);
    setAutojoin(formatAutojoin(editing.autojoin));
  }, [open, editing, defaultIdentity.nick]);

  const chosen = findNetwork(choice);
  // An edit always shows the fields directly: the directory is a shortcut for
  // filling in a blank form, not a description of a network already saved.
  const custom = choice === CUSTOM || editing !== undefined;

  const effective = {
    name: custom ? name : (chosen?.name ?? ''),
    host: custom ? host : (chosen?.host ?? ''),
    port: custom ? Number.parseInt(port, 10) : (chosen?.port ?? PORT_FOR.encrypted),
  };

  const usesSocket = security === 'websocket';

  /** Picking a network sets where it is and how it expects to be reached. */
  const changeNetwork = (next: string): void => {
    setChoice(next);
    const network = findNetwork(next);
    if (network === undefined) {
      return;
    }
    const wanted: Security = network.tls ? 'encrypted' : 'off';
    setSecurity(wanted);
    if (!portEdited) {
      setPort(String(network.port));
    }
  };

  const changeSecurity = (next: string): void => {
    const value = next as Security;
    setSecurity(value);
    // Turning encryption off or on by hand starts the certificate question over:
    // an accepted-once exception belongs to a TLS connection, not a plaintext one.
    setCertAccepted(false);
    if (!portEdited) {
      setPort(String(PORT_FOR[value]));
    }
  };

  /** The transport security for the chosen option, as a saved endpoint holds it. */
  const tlsFor = (choice: Security): TlsConfig => {
    switch (choice) {
      case 'off':
        return { mode: 'off' };
      case 'websocket':
        // The socket path builds its own websocket endpoint from the URL.
        return { mode: 'off' };
      case 'encrypted':
        // Checking is on unless the user has already accepted this network's
        // unverified certificate, in which case that choice is kept.
        return certAccepted
          ? { mode: 'tls', verifyCert: false }
          : { mode: 'tls', verifyCert: true };
    }
  };

  /** What to keep from an edited profile, or the defaults for a new one. */
  const carried = {
    // Parsed against what was saved, so a channel that already had a key keeps
    // it rather than losing the password because its name was retyped.
    autojoin: parseAutojoin(autojoin, editing?.autojoin ?? []),
    connectCommands: editing?.connectCommands ?? [],
    encoding: editing?.encoding ?? 'utf-8',
    autoReconnect: editing?.autoReconnect ?? true,
    // Absent means "follow the global logging policy", which is what a network
    // nobody has given its own policy should do.
    ...(editing?.logging === undefined ? {} : { logging: editing.logging }),
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
      // A new network starts from what was given at first run: the fallbacks
      // and the real name come from there, and only the name itself is what
      // this form may have changed.
      return identityFrom(defaultIdentity, chosenNick);
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
  const loginProblem = (): FormError | undefined => {
    if (login === 'none') {
      return undefined;
    }
    if (account.trim() === '') {
      return {
        field: 'account',
        message: 'Enter the account name you signed up with, or choose Not signed in.',
      };
    }
    if (password.trim() === '' && !passwordSaved) {
      return { field: 'password', message: 'Enter the password for that account.' };
    }
    return undefined;
  };

  const submit = (): void => {
    if (usesSocket) {
      submitSocket();
      return;
    }
    if (effective.host.trim() === '') {
      setError({ field: 'host', message: 'Enter the address of the server to connect to.' });
      return;
    }
    if (nick.trim() === '') {
      setError({ field: 'nick', message: 'Choose a name for other people to see.' });
      return;
    }
    if (!Number.isInteger(effective.port) || effective.port < 1 || effective.port > 65535) {
      setError({ field: 'port', message: 'The port has to be a number between 1 and 65535.' });
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
      tls: tlsFor(security),
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
      setError({
        field: 'socket',
        message: 'That is not a web address. It should start with wss:// or ws://.',
      });
      return;
    }
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
      setError({
        field: 'socket',
        message: 'A web address for IRC starts with wss:// — or ws:// for an unencrypted one.',
      });
      return;
    }
    if (nick.trim() === '') {
      setError({ field: 'nick', message: 'Choose a name for other people to see.' });
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

  /**
   * Which fields are rendered right now, so a complaint about one of them is
   * left to it and every other complaint still reaches the foot of the form.
   *
   * Derived rather than listed: a fixed list goes stale the moment a branch
   * changes which controls it draws, and the failure mode is a form that
   * refuses to submit while saying nothing about why.
   */
  const onScreen = new Set<FormError['field']>([
    'nick',
    ...(custom && usesSocket ? (['socket'] as const) : []),
    ...(custom && !usesSocket ? (['host', 'port'] as const) : []),
    ...(login === 'none' ? [] : (['account', 'password'] as const)),
  ]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="wide"
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
      <div className="flex flex-col gap-4 pt-1">
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
          <p className="text-footnote text-[var(--label-secondary)]">
            These take effect on the next connection. If this network is connected now, saving
            reconnects it so it is running on what you saved.
          </p>
        )}

        {/* Paired across two columns on anything wider than a phone: an address
            and its port are one decision, and stacking them is what makes this
            form scroll. */}
        {custom && usesSocket ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                hint="What this network is called in the sidebar."
              />
              <TextField
                label="Your name on this network"
                value={nick}
                placeholder="marmot"
                onChange={(event) => setNick(event.target.value)}
                error={errorFor(error, 'nick')}
                hint="Other people see this."
              />
            </div>
            <TextField
              label="Web address"
              value={socketUrl}
              placeholder="wss://irc.example.net/webirc"
              onChange={(event) => setSocketUrl(event.target.value)}
              error={errorFor(error, 'socket')}
              hint="The only kind of address a browser can open."
            />
          </>
        ) : custom ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                hint="What this network is called in the sidebar."
              />
              <TextField
                label="Your name on this network"
                value={nick}
                placeholder="marmot"
                onChange={(event) => setNick(event.target.value)}
                error={errorFor(error, 'nick')}
                hint="Other people see this."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <TextField
                label="Server address"
                value={host}
                placeholder="irc.example.net"
                onChange={(event) => setHost(event.target.value)}
                error={errorFor(error, 'host')}
              />
              <TextField
                label="Port"
                value={port}
                inputMode="numeric"
                onChange={(event) => {
                  setPortEdited(true);
                  setPort(event.target.value);
                }}
                error={errorFor(error, 'port')}
                // Short enough to stay on one line beside the address: a hint
                // that wraps here opens a ragged gap under the whole row.
                hint={portEdited ? 'Your own number.' : 'Matches security.'}
              />
            </div>
          </>
        ) : (
          <TextField
            label="Your name on this network"
            value={nick}
            placeholder="marmot"
            onChange={(event) => setNick(event.target.value)}
            error={errorFor(error, 'nick')}
            hint={
              defaultIdentity.nick !== '' && nick === defaultIdentity.nick
                ? 'Other people see this. Change it to use a different name here only.'
                : 'Other people see this. You can change it later.'
            }
          />
        )}

        {/* One line of consequence for the option in force, rather than three
            stacked paragraphs for options nobody has chosen. The consequence
            itself is not dropped: CLAUDE.md requires the security implication
            be stated in plain language, and it still is — for the choice that
            is actually going to be used. */}
        <Field
          id="security"
          label="Connection security"
          hint={SECURITY_HINT[security](certAccepted)}
        >
          <SegmentedControl
            label="Connection security"
            value={security}
            onChange={changeSecurity}
            full
            segments={[
              { value: 'encrypted', label: 'Encrypted' },
              { value: 'off', label: 'Not encrypted' },
              // Only where an address can be typed. On a network picked from
              // the directory there is nowhere to put the URL, so offering it
              // disabled was a control that could never be used.
              ...(custom ? [{ value: 'websocket' as Security, label: 'A web address' }] : []),
            ]}
          />
        </Field>

        <Field id="login" label="Signing in" hint={LOGIN_HINT[login]}>
          <SegmentedControl
            label="Signing in"
            value={login}
            onChange={setLogin}
            full
            segments={[
              { value: 'none', label: 'Not signed in' },
              { value: 'sasl', label: 'While connecting' },
              { value: 'nickserv', label: 'After connecting' },
            ]}
          />
        </Field>

        {login === 'none' ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Account name"
              value={account}
              placeholder={nick === '' ? 'marmot' : nick}
              onChange={(event) => setAccount(event.target.value)}
              error={errorFor(error, 'account')}
              hint="Often the same as your name."
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              autoComplete="off"
              onChange={(event) => setPassword(event.target.value)}
              error={errorFor(error, 'password')}
              hint={
                passwordSaved && password === ''
                  ? 'A password is saved. Leave this empty to keep it.'
                  : security === 'off'
                    ? 'This network connects unencrypted, so this is readable in transit.'
                    : remembersPasswords
                      ? // The keychain, not the settings file. Worth naming: it
                        // is the difference between "somewhere the operating
                        // system protects" and "a file in a folder".
                        "Saved to this device's keychain, not to a file."
                      : 'Kept for this session only. This device cannot store it safely.'
              }
            />
          </div>
        )}

        <TextField
          label="Channels to join automatically"
          value={autojoin}
          placeholder="#marmotter, #irc"
          onChange={(event) => setAutojoin(event.target.value)}
          hint="Joined every time this network connects. Separate them with commas or spaces, and leave it empty for none."
        />

        <Toggle
          label="I am a server operator on this network"
          hint="Offers the operator commands in the command bar. It grants nothing: the network decides what you may actually do."
          checked={operatorCommands}
          onChange={setOperatorCommands}
        />

        {/* The complaints that belong to a control are printed under it. This
            catches anything left over, so nothing can fail silently. */}
        {error === undefined || onScreen.has(error.field) ? null : (
          <p role="alert" className="text-footnote text-[var(--danger)]">
            {error.message}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * What each security choice means for the person, in one line.
 *
 * A function of whether the certificate was already accepted, because that
 * changes what "Encrypted" is actually doing on this network.
 */
const SECURITY_HINT: Record<Security, (certAccepted: boolean) => string> = {
  encrypted: (certAccepted) =>
    certAccepted
      ? "Recommended. You've chosen to trust this server's own certificate, so it connects without checking it."
      : "Recommended. Nobody in between can read what you send. If the certificate can't be checked, you'll be asked whether to trust it.",
  off: () =>
    'Anyone between you and the server can read everything you send, including your password.',
  websocket: () =>
    'For a network that offers one. This is the only kind a browser can open, and it needs the address rather than a server and port.',
};

/** What each way of signing in costs or gains, in one line. */
const LOGIN_HINT: Record<LoginMethod, string> = {
  none: 'Fine for most networks, and for a name nobody has registered.',
  sasl: 'Recommended where the network offers it. Your name is yours before anybody else can see you online.',
  nickserv:
    'For older networks. Sends your password to the account service once you are on, so there is a moment where you are online and not yet signed in.',
};

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
