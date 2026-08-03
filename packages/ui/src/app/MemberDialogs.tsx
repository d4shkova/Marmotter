import type { ChannelState, Member, NetworkState } from '@marmotter/client';
import { type ReactNode, useMemo, useState } from 'react';
import { Button } from '../primitives/Button.js';
import { RadioGroup } from '../primitives/Radio.js';
import { Sheet } from '../primitives/Sheet.js';
import { TextField } from '../primitives/TextField.js';
import { Toggle } from '../primitives/Toggle.js';
import { type BanScope, banOptions, membersMatching } from './mask.js';

export interface BanDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly network: NetworkState;
  readonly channel: ChannelState;
  readonly member: Member;
  /** Sends the lines the dialog builds. */
  readonly onSend: (line: string) => void;
}

/**
 * The ban builder.
 *
 * CLAUDE.md asks for host, account and nick scope with a preview of the
 * resulting mask, and that is the whole design: somebody picks who they mean to
 * stop, sees the mask it produces and who here it would catch, and decides. The
 * options come from what the network advertises — no account ban on a server
 * with no extbans — so nothing offered here can be chosen and then silently do
 * nothing.
 *
 * A sheet rather than a modal, per the primitive's own rule: it has a form in
 * it, and modals here ask one question with two answers.
 */
export function BanDialog({
  open,
  onClose,
  network,
  channel,
  member,
  onSend,
}: BanDialogProps): ReactNode {
  const options = useMemo(() => banOptions(member, network.support), [member, network.support]);
  // Defaults to the address rather than the name: a name ban is stepped around
  // by typing a different name, and offering it as the default would make the
  // easy choice the ineffective one.
  const [scope, setScope] = useState<BanScope>(options[1]?.scope ?? 'nick');
  const [alsoRemove, setAlsoRemove] = useState(true);
  const [reason, setReason] = useState('');

  const chosen = options.find((option) => option.scope === scope) ?? options[0];
  const affected = useMemo(
    () =>
      chosen === undefined
        ? []
        : membersMatching(chosen.mask, channel.members.values(), network.support),
    [chosen, channel.members, network.support],
  );

  const confirm = (): void => {
    if (chosen === undefined) {
      return;
    }
    onSend(`MODE ${channel.name} +b ${chosen.mask}`);
    if (alsoRemove) {
      const text = reason.trim();
      onSend(
        text === ''
          ? `KICK ${channel.name} ${member.nick}`
          : `KICK ${channel.name} ${member.nick} :${text}`,
      );
    }
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Ban ${member.nick}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={chosen === undefined} onClick={confirm}>
            {alsoRemove ? 'Ban and remove' : 'Ban'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <RadioGroup
          legend="Who should this stop?"
          name="ban-scope"
          value={scope}
          onChange={setScope}
          options={options.map((option) => ({
            value: option.scope,
            label: option.label,
            description: option.description,
          }))}
        />

        {chosen === undefined ? null : (
          <div className="rounded-control bg-[var(--fill-tertiary)] px-3 py-2">
            <p className="font-mono text-caption-1 text-[var(--label-primary)]">{chosen.mask}</p>
            <p aria-live="polite" className="pt-0.5 text-caption-1 text-[var(--label-secondary)]">
              {describeReach(affected)}
            </p>
          </div>
        )}

        <Toggle
          label="Remove them from the channel too"
          hint="A ban on its own does not remove somebody who is already here."
          checked={alsoRemove}
          onChange={setAlsoRemove}
        />

        {!alsoRemove ? null : (
          <TextField
            label="Reason"
            hint="Everybody in the channel sees this. Leave it empty for none."
            value={reason}
            placeholder="Optional"
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </div>
    </Sheet>
  );
}

export interface KickDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly channel: ChannelState;
  readonly member: Member;
  readonly onSend: (line: string) => void;
}

/**
 * Removing somebody, with the reason optional and the consequence stated.
 *
 * A kick is not a ban and the two are reliably confused, so this says which one
 * it is rather than leaving somebody surprised when the person walks back in.
 */
export function KickDialog({ open, onClose, channel, member, onSend }: KickDialogProps): ReactNode {
  const [reason, setReason] = useState('');

  const confirm = (): void => {
    const text = reason.trim();
    onSend(
      text === ''
        ? `KICK ${channel.name} ${member.nick}`
        : `KICK ${channel.name} ${member.nick} :${text}`,
    );
    setReason('');
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Remove ${member.nick}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={confirm}>
            Remove
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-subhead text-[var(--label-secondary)]">
          {member.nick} will be removed from {channel.name}. They can come straight back unless you
          ban them as well.
        </p>
        <TextField
          label="Reason"
          hint="Everybody in the channel sees this. Leave it empty for none."
          value={reason}
          placeholder="Optional"
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              confirm();
            }
          }}
        />
      </div>
    </Sheet>
  );
}

/** Who a mask would catch, among the people here now. */
function describeReach(affected: readonly Member[]): string {
  switch (affected.length) {
    case 0:
      return 'Nobody currently here matches this.';
    case 1:
      return `This matches 1 person here: ${affected[0]?.nick ?? ''}.`;
    default:
      return `This matches ${affected.length} people here: ${affected
        .map((entry) => entry.nick)
        .slice(0, 5)
        .join(', ')}.`;
  }
}
