import type { NetworkState } from '@marmotter/client';
import { type ReactNode, useMemo, useState } from 'react';
import { ListGroup } from '../layout/ListGroup.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { Tabs } from '../primitives/Tabs.js';
import { TextField } from '../primitives/TextField.js';
import { accountStatus, detectServices, servicesCommands } from './services.js';

export interface AccountPanelProps {
  readonly network: NetworkState;
  /** Sends a line. Everything here is a message to a service. */
  readonly onSend: (line: string) => void;
  readonly className?: string;
}

type Tab = 'account' | 'register' | 'cloak';

/**
 * Registering, signing in, and changing an account — without `/msg NickServ`.
 *
 * CLAUDE.md's abstraction table names this row explicitly, and the reason it
 * exists is that services are the single least discoverable part of IRC: a
 * person who has managed to connect and join a channel still has no way to
 * learn that their name can be reserved, let alone how.
 *
 * Two rules shape it. SASL is preferred wherever the network offers it, so on
 * those networks this panel points at the network's own settings rather than
 * offering a worse second way to do the same thing. And where the services
 * package cannot be identified, the panel still works — using the forms Atheme
 * and Anope share, and saying that it is guessing, because a legible failure
 * beats a hidden control.
 */
export function AccountPanel({ network, onSend, className }: AccountPanelProps): ReactNode {
  const [tab, setTab] = useState<Tab>('account');
  const pkg = useMemo(() => detectServices(network), [network]);
  const services = useMemo(() => servicesCommands(pkg), [pkg]);
  const status = accountStatus(network);

  const connected = network.phase === 'registered';

  return (
    <div className={className}>
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
        <div>
          <h1 className="text-title-2 font-bold text-[var(--label-primary)]">Your account</h1>
          <p className="pt-1 text-subhead text-[var(--label-secondary)]">
            {status.signedIn
              ? `Signed in to ${network.name} as ${status.account ?? ''}.`
              : `Not signed in to ${network.name}.`}
          </p>
        </div>

        {!connected ? (
          <EmptyState
            title="Not connected"
            description={`Connect to ${network.name} before changing anything about your account there.`}
          />
        ) : (
          <Tabs
            label="Account"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'account' as const, label: status.signedIn ? 'Settings' : 'Sign in' },
              { value: 'register' as const, label: 'Register' },
              ...(services.requestCloak === undefined
                ? []
                : [{ value: 'cloak' as const, label: 'Hide my address' }]),
            ]}
          >
            {tab === 'account' ? (
              status.signedIn ? (
                <Manage services={services} onSend={onSend} />
              ) : (
                <SignIn
                  network={network}
                  services={services}
                  saslAvailable={status.saslAvailable}
                  onSend={onSend}
                />
              )
            ) : tab === 'register' ? (
              <Register network={network} services={services} onSend={onSend} />
            ) : (
              <Cloak services={services} onSend={onSend} />
            )}
          </Tabs>
        )}

        <p className="text-caption-1 text-[var(--label-tertiary)]">
          {services.name === undefined
            ? 'Marmotter could not tell which account system this network runs, so it is using the commands most networks accept. If something here does not work, the raw log will show exactly what was sent.'
            : `This network runs ${services.name}. Everything here is sent as an ordinary message to its account service, and appears in the raw log.`}
        </p>
      </div>
    </div>
  );
}

type Services = ReturnType<typeof servicesCommands>;

function Register({
  network,
  services,
  onSend,
}: {
  readonly network: NetworkState;
  readonly services: Services;
  readonly onSend: (line: string) => void;
}): ReactNode {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  const mismatch = confirm !== '' && confirm !== password;
  const ready = password.length >= 8 && !mismatch && confirm !== '';

  return (
    <div className="flex flex-col gap-4 py-2">
      <ListGroup
        header={`Reserve the name ${network.nick}`}
        footer="Registering claims this name on this network so nobody else can use it, and lets Marmotter sign you in automatically next time."
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <TextField
            label="Password"
            type="password"
            value={password}
            hint="At least eight characters. This is not your Marmotter password — it belongs to the network."
            onChange={(event) => setPassword(event.target.value)}
          />
          <TextField
            label="Password again"
            type="password"
            value={confirm}
            {...(mismatch ? { error: 'These do not match.' } : {})}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <TextField
            label="Email address"
            type="email"
            value={email}
            hint="Most networks send a confirmation here, and need it to reset a lost password."
            onChange={(event) => setEmail(event.target.value)}
          />
          <div>
            <Button
              variant="primary"
              disabled={!ready}
              onClick={() => {
                onSend(services.register(password, email.trim()));
                setPassword('');
                setConfirm('');
                setDone(true);
              }}
            >
              Register this name
            </Button>
          </div>
          {!done ? null : (
            <p aria-live="polite" className="text-caption-1 text-[var(--label-secondary)]">
              Sent. The network&rsquo;s reply appears in the server tab — most ask you to confirm by
              email before the name is yours.
            </p>
          )}
        </div>
      </ListGroup>
    </div>
  );
}

function SignIn({
  network,
  services,
  saslAvailable,
  onSend,
}: {
  readonly network: NetworkState;
  readonly services: Services;
  readonly saslAvailable: boolean;
  readonly onSend: (line: string) => void;
}): ReactNode {
  const [account, setAccount] = useState(network.nick);
  const [password, setPassword] = useState('');

  return (
    <div className="flex flex-col gap-4 py-2">
      {!saslAvailable ? null : (
        <div className="rounded-card bg-[var(--bg-elevated)] p-4">
          <p className="text-subhead font-semibold text-[var(--label-primary)]">
            This network can sign you in as you connect
          </p>
          <p className="pt-1 text-caption-1 text-[var(--label-secondary)]">
            That is better than signing in afterwards: it happens before anyone can see you join,
            and your password is never sent as an ordinary message. Set it on this network in
            Settings, under the network&rsquo;s own entry.
          </p>
        </div>
      )}

      <ListGroup
        header="Sign in now"
        footer="This sends your password as a message to the network's account service. It is not encrypted beyond the connection itself."
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <TextField
            label="Account name"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && account.trim() !== '' && password !== '') {
                event.preventDefault();
                onSend(services.identify(account.trim(), password));
                setPassword('');
              }
            }}
          />
          <div>
            <Button
              variant="primary"
              disabled={account.trim() === '' || password === ''}
              onClick={() => {
                onSend(services.identify(account.trim(), password));
                setPassword('');
              }}
            >
              Sign in
            </Button>
          </div>
        </div>
      </ListGroup>
    </div>
  );
}

function Manage({
  services,
  onSend,
}: {
  readonly services: Services;
  readonly onSend: (line: string) => void;
}): ReactNode {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');

  const mismatch = confirm !== '' && confirm !== next;
  const ready =
    next.length >= 8 &&
    !mismatch &&
    confirm !== '' &&
    (!services.passwordChangeNeedsCurrent || current !== '');

  return (
    <div className="flex flex-col gap-6 py-2">
      <ListGroup header="Change your password">
        <div className="flex flex-col gap-3 px-4 py-3">
          {!services.passwordChangeNeedsCurrent ? null : (
            <TextField
              label="Current password"
              type="password"
              value={current}
              hint="This network asks for it before making the change."
              onChange={(event) => setCurrent(event.target.value)}
            />
          )}
          <TextField
            label="New password"
            type="password"
            value={next}
            hint="At least eight characters."
            onChange={(event) => setNext(event.target.value)}
          />
          <TextField
            label="New password again"
            type="password"
            value={confirm}
            {...(mismatch ? { error: 'These do not match.' } : {})}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <div>
            <Button
              variant="primary"
              disabled={!ready}
              onClick={() => {
                onSend(services.changePassword(current, next));
                setCurrent('');
                setNext('');
                setConfirm('');
              }}
            >
              Change password
            </Button>
          </div>
        </div>
      </ListGroup>

      <ListGroup
        header="Email address"
        footer="Used to confirm the account and to recover it if you lose the password."
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <TextField
            label="Email address"
            type="email"
            value={email}
            placeholder="you@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
          <div>
            <Button
              disabled={email.trim() === ''}
              onClick={() => {
                onSend(services.setEmail(email.trim()));
                setEmail('');
              }}
            >
              Update email
            </Button>
          </div>
        </div>
      </ListGroup>
    </div>
  );
}

function Cloak({
  services,
  onSend,
}: {
  readonly services: Services;
  readonly onSend: (line: string) => void;
}): ReactNode {
  const [vhost, setVhost] = useState('');
  const [sent, setSent] = useState(false);
  const request = services.requestCloak;

  if (request === undefined) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <ListGroup
        header="Hide where you connect from"
        footer="A cloak replaces your real address with a made-up one, so other people cannot see where you connect from. It hides nothing from the network's own operators, and messages are not private from them either way."
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <TextField
            label="What to show instead"
            value={vhost}
            placeholder="somewhere/nice"
            hint="Most networks review the request by hand and only accept some shapes. Yours may refuse it."
            onChange={(event) => setVhost(event.target.value)}
          />
          <div>
            <Button
              variant="primary"
              disabled={vhost.trim() === ''}
              onClick={() => {
                onSend(request(vhost.trim()));
                setSent(true);
              }}
            >
              Request this
            </Button>
          </div>
          {!sent ? null : (
            <p aria-live="polite" className="text-caption-1 text-[var(--label-secondary)]">
              Sent. The reply appears in the server tab, and on most networks a person has to
              approve it before anything changes.
            </p>
          )}
        </div>
      </ListGroup>
    </div>
  );
}
