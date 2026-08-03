import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '../primitives/Button.js';
import { Sheet } from '../primitives/Sheet.js';
import { TextField } from '../primitives/TextField.js';
import { Toggle } from '../primitives/Toggle.js';

export interface NewChannel {
  readonly name: string;
  readonly topic: string;
  /** Nobody gets in without an invitation. `+i`. */
  readonly inviteOnly: boolean;
  /** Empty for none. `+k`. */
  readonly password: string;
  /** Kept out of the channel list and out of other people's WHOIS. `+s`. */
  readonly secret: boolean;
}

export interface CreateChannelProps {
  readonly open: boolean;
  readonly networkName: string;
  /** What the network calls a channel prefix — `#` on all but a few. */
  readonly prefix?: string;
  /** Whether the network can keep a channel out of its list at all. */
  readonly supportsSecret?: boolean;
  readonly onCreate: (channel: NewChannel) => void;
  readonly onCancel: () => void;
}

/**
 * Making a channel.
 *
 * There is no "create" on IRC. A channel exists because somebody is in it, so
 * making one is joining a name nobody is using and being handed it — which is
 * an excellent design and a terrible thing to have to know. Here it is a form
 * with a name and some settings, and the join, the modes and the topic go out
 * underneath in the order the server needs them.
 *
 * The settings offered are the ones somebody making a channel actually decides:
 * who can get in, whether there is a password, and whether it is listed. The
 * rest of the mode space belongs in channel settings, after the channel exists.
 */
export function CreateChannel({
  open,
  networkName,
  prefix = '#',
  supportsSecret = true,
  onCreate,
  onCancel,
}: CreateChannelProps): ReactNode {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [inviteOnly, setInviteOnly] = useState(false);
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setName('');
      setTopic('');
      setInviteOnly(false);
      setPassword('');
      setSecret(false);
      setError(undefined);
    }
  }, [open]);

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === prefix) {
      setError('Give the channel a name.');
      return;
    }
    // The protocol separates parameters on spaces and lists on commas, so a
    // name containing either cannot be joined. Saying so here beats the server
    // refusing the join for a reason nobody can see. (A bell is illegal too and
    // is left to the server: nothing types one, and the check would then be
    // rejecting names for a reason this message does not give.)
    if (/[\s,]/.test(trimmed)) {
      setError('A channel name cannot contain spaces or commas.');
      return;
    }

    onCreate({
      name: trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`,
      topic: topic.trim(),
      inviteOnly,
      password: password.trim(),
      secret,
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title="Create a channel"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Create channel
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="text-subhead text-[var(--label-secondary)]">
          A channel on {networkName} exists as long as somebody is in it. Creating one puts you in
          it as its operator; when the last person leaves, it goes away along with these settings.
        </p>

        <TextField
          label="Name"
          value={name}
          placeholder={`${prefix}marmotter`}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          hint={`The ${prefix} is added for you if you leave it off.`}
          {...(error === undefined ? {} : { error })}
        />

        <TextField
          label="Topic"
          value={topic}
          placeholder="What this channel is for"
          onChange={(event) => setTopic(event.target.value)}
          hint="Optional. Everyone joining sees it."
        />

        <Toggle
          label="Only invited people can join"
          hint="Anyone else is turned away until you invite them."
          checked={inviteOnly}
          onChange={setInviteOnly}
        />

        <TextField
          label="Password"
          value={password}
          type="password"
          autoComplete="off"
          onChange={(event) => setPassword(event.target.value)}
          hint="Optional. People need this to join, and you will have to pass it on to them yourself."
        />

        {!supportsSecret ? null : (
          <Toggle
            label="Keep it out of the channel list"
            hint="People can still join if they know the name."
            checked={secret}
            onChange={setSecret}
          />
        )}

        <button type="submit" className="sr-only">
          Create channel
        </button>
      </form>
    </Sheet>
  );
}

/**
 * The lines that make a channel, in the order a server will accept them.
 *
 * The join has to land first — nobody may set a mode on a channel they are not
 * in — and it is the join itself that makes us operator, which is what lets the
 * rest through. Pure, so the ordering is testable without a socket.
 */
export function createChannelLines(channel: NewChannel): readonly string[] {
  // No key on the join. A channel nobody is in has no password yet, so sending
  // one would be answering a question the server has not asked; the password is
  // something we set once we are in and holding the channel.
  const lines: string[] = [`JOIN ${channel.name}`];

  const flags = `${channel.inviteOnly ? 'i' : ''}${channel.secret ? 's' : ''}${channel.password === '' ? '' : 'k'}`;
  if (flags !== '') {
    lines.push(
      channel.password === ''
        ? `MODE ${channel.name} +${flags}`
        : `MODE ${channel.name} +${flags} ${channel.password}`,
    );
  }

  if (channel.topic !== '') {
    lines.push(`TOPIC ${channel.name} :${channel.topic}`);
  }

  return lines;
}
