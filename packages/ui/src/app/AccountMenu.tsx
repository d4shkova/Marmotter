import type { NetworkState } from '@marmotter/client';
import { type ReactNode, useState } from 'react';
import { Button } from '../primitives/Button.js';
import { Popover } from '../primitives/Popover.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import { TextField } from '../primitives/TextField.js';

export interface AccountMenuProps {
  readonly network: NetworkState;
  /** Sets away with a message, or clears it when given nothing. */
  readonly onSetAway: (message?: string) => void;
  readonly onChangeNick: (nick: string) => void;
  readonly onOpenPeople?: () => void;
  readonly className?: string;
}

/**
 * Who you are on this network, and whether you are here.
 *
 * `AWAY` is one of the few IRC commands whose name already matches what a
 * person means by it, so the only translation needed is turning a command with
 * an optional trailing argument into a switch with a message beside it — and
 * making "back" a thing you press rather than a command you send with no
 * argument, which is not discoverable at all.
 */
export function AccountMenu({
  network,
  onSetAway,
  onChangeNick,
  onOpenPeople,
  className,
}: AccountMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [nick, setNick] = useState(network.nick);

  const connected = network.phase === 'registered';

  const apply = (next: 'here' | 'away'): void => {
    if (next === 'away') {
      onSetAway(message.trim() === '' ? 'Away' : message.trim());
    } else {
      onSetAway();
    }
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Your account"
      placement="top"
      {...(className === undefined ? {} : { className })}
      trigger={
        <Button
          size="small"
          variant="plain"
          onClick={() => setOpen(!open)}
          aria-label={`You are ${network.nick}${network.away ? ', away' : ''}`}
        >
          {network.nick}
          {network.away ? ' · Away' : ''}
        </Button>
      }
    >
      <div className="flex w-64 flex-col gap-3 p-3">
        <div>
          <p className="text-subhead font-semibold text-[var(--label-primary)]">{network.nick}</p>
          <p className="text-caption-1 text-[var(--label-secondary)]">
            {network.account === undefined
              ? `On ${network.name}, not signed in to an account`
              : `Signed in to ${network.name} as ${network.account}`}
          </p>
        </div>

        <SegmentedControl
          label="Whether you are here"
          value={network.away ? 'away' : 'here'}
          onChange={apply}
          segments={[
            { value: 'here', label: 'Available' },
            { value: 'away', label: 'Away' },
          ]}
        />

        <TextField
          label="Away message"
          value={message}
          disabled={!connected}
          placeholder="Back later"
          hint="Shown to anyone who messages you while you are away."
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply('away');
            }
          }}
        />

        <TextField
          label="Your name here"
          value={nick}
          disabled={!connected}
          hint="Other people see this. Changing it takes effect at once."
          onChange={(event) => setNick(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && nick.trim() !== '' && nick.trim() !== network.nick) {
              event.preventDefault();
              onChangeNick(nick.trim());
              setOpen(false);
            }
          }}
        />

        <div className="flex justify-between gap-2">
          {onOpenPeople === undefined ? (
            <span />
          ) : (
            <Button
              size="small"
              variant="plain"
              onClick={() => {
                onOpenPeople();
                setOpen(false);
              }}
            >
              Friends and ignored
            </Button>
          )}
          <Button
            size="small"
            variant="primary"
            disabled={!connected || nick.trim() === '' || nick.trim() === network.nick}
            onClick={() => {
              onChangeNick(nick.trim());
              setOpen(false);
            }}
          >
            Change name
          </Button>
        </div>
      </div>
    </Popover>
  );
}
