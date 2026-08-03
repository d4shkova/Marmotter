import type { ChannelState, NetworkState } from '@marmotter/client';
import { fold } from '@marmotter/protocol';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../primitives/Button.js';
import { Checkbox } from '../primitives/Checkbox.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { Select } from '../primitives/Select.js';
import { TextField } from '../primitives/TextField.js';
import {
  CAPABILITIES,
  type AccessEntry,
  accessCommands,
  flagDiff,
  parseAccessListing,
} from './chanserv.js';
import { detectServices } from './services.js';

export interface ChannelAccessProps {
  readonly network: NetworkState;
  readonly channel: ChannelState;
  readonly onSend: (line: string) => void;
  readonly className?: string;
}

/**
 * Who is allowed to do what in a channel, remembered by the network's services
 * rather than by the channel itself.
 *
 * This is the difference between "you are an operator right now" and "you are
 * an operator whenever you come back", which IRC keeps in two entirely
 * different places and no client explains. The member list handles the first;
 * this handles the second.
 *
 * The shape follows the package. Atheme stores capabilities, so it gets the
 * grid CLAUDE.md asks for. Anope and ergo store roles, so they get roles — a
 * grid there would quietly round somebody's choices to the nearest role and
 * throw the rest away.
 */
export function ChannelAccess({
  network,
  channel,
  onSend,
  className,
}: ChannelAccessProps): ReactNode {
  const pkg = useMemo(() => detectServices(network), [network]);
  const commands = useMemo(() => accessCommands(pkg), [pkg]);
  const [newTarget, setNewTarget] = useState('');

  // What ChanServ said, read from the conversation its replies landed in. The
  // panel does not intercept anything: the notices are in the query where they
  // belong, and this reads the most recent run of them.
  const replies = useMemo(() => {
    const query = network.queries.get(fold('ChanServ', network.support.caseMapping));
    return (query?.messages ?? [])
      .filter((message) => message.kind === 'notice')
      .slice(-60)
      .map((message) => message.text);
  }, [network.queries, network.support.caseMapping]);

  const entries = useMemo(
    () => parseAccessListing(replies, commands.model),
    [replies, commands.model],
  );

  // Asked for once when the panel opens. Refreshing on every render would send
  // a FLAGS query per keystroke elsewhere in the sheet.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || commands.model === 'unsupported') {
      return;
    }
    asked.current = true;
    onSend(commands.list(channel.name));
  }, [commands, channel.name, onSend]);

  if (commands.model === 'unsupported') {
    return (
      <div className={className}>
        <EmptyState
          title="Marmotter cannot tell how this network stores permissions"
          description="Its account system is not one Marmotter recognises, so it will not guess at commands that grant permissions. You can still set them from the command bar, and the raw log shows exactly what the network replies."
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 ${className ?? ''}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-subhead text-[var(--label-secondary)]">
          These stay with the person after they leave, unlike the roles in the member list. Changes
          are sent to the network&rsquo;s channel service and take effect when it replies.
        </p>
        <Button size="small" onClick={() => onSend(commands.list(channel.name))}>
          Refresh
        </Button>
      </div>

      <div className="flex items-end gap-2">
        <TextField
          label="Give somebody permissions"
          className="flex-1"
          value={newTarget}
          placeholder="Their account name"
          hint="Use the account they log in with, not the name they are using now."
          onChange={(event) => setNewTarget(event.target.value)}
        />
        <Button
          variant="primary"
          disabled={newTarget.trim() === ''}
          onClick={() => {
            const target = newTarget.trim();
            onSend(
              commands.model === 'flags'
                ? commands.setFlags(channel.name, target, 'v', '')
                : commands.setRole(channel.name, target, commands.roles[0]?.value ?? 'VOP'),
            );
            setNewTarget('');
          }}
        >
          Add
        </Button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing set, or nothing readable"
          description={`Either nobody has standing permissions in ${channel.name}, or this network words its reply in a way Marmotter cannot read. The reply itself is in the conversation with the channel service.`}
        />
      ) : commands.model === 'flags' ? (
        <FlagGrid
          entries={entries}
          onChange={(entry, wanted) => {
            const { add, remove } = flagDiff(entry.flags, wanted);
            if (add !== '' || remove !== '') {
              onSend(commands.setFlags(channel.name, entry.target, add, remove));
            }
          }}
          onRemove={(entry) => onSend(commands.remove(channel.name, entry.target))}
        />
      ) : (
        <RoleList
          entries={entries}
          roles={commands.roles}
          onChange={(entry, role) => onSend(commands.setRole(channel.name, entry.target, role))}
          onRemove={(entry) => onSend(commands.remove(channel.name, entry.target))}
        />
      )}

      <p className="text-caption-1 text-[var(--label-tertiary)]">
        Only the permissions shown here are changed. Anything else somebody has been granted is left
        alone, so this panel cannot quietly take away something it does not display.
      </p>
    </div>
  );
}

function FlagGrid({
  entries,
  onChange,
  onRemove,
}: {
  readonly entries: readonly AccessEntry[];
  readonly onChange: (entry: AccessEntry, wanted: ReadonlySet<string>) => void;
  readonly onRemove: (entry: AccessEntry) => void;
}): ReactNode {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Who can do what in this channel</caption>
        <thead>
          <tr className="border-b border-[var(--separator)]">
            <th scope="col" className="px-2 py-2 text-caption-1 text-[var(--label-secondary)]">
              Who
            </th>
            {CAPABILITIES.map((capability) => (
              <th
                key={capability.flag}
                scope="col"
                title={capability.detail}
                className="px-2 py-2 align-bottom text-caption-2 font-normal text-[var(--label-secondary)]"
              >
                <span className="block max-w-20">{capability.label}</span>
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-caption-1 text-[var(--label-secondary)]">
              Remove
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.target} className="border-b border-[var(--separator)]">
              <th
                scope="row"
                className="px-2 py-2 font-mono text-footnote font-normal text-[var(--label-primary)]"
              >
                {entry.target}
                {!entry.founder ? null : (
                  <span className="block text-caption-2 text-[var(--label-tertiary)]">Owner</span>
                )}
              </th>
              {CAPABILITIES.map((capability) => {
                const held = entry.flags.includes(capability.flag);
                return (
                  <td key={capability.flag} className="px-2 py-2">
                    <Checkbox
                      label={`${capability.label} — ${entry.target}`}
                      labelHidden
                      checked={held || entry.founder}
                      // The owner holds everything by definition, and a service
                      // will refuse to take one capability off them anyway.
                      disabled={entry.founder}
                      onChange={(checked) => {
                        const wanted = new Set(entry.flags.split(''));
                        if (checked) {
                          wanted.add(capability.flag);
                        } else {
                          wanted.delete(capability.flag);
                        }
                        onChange(entry, wanted);
                      }}
                    />
                  </td>
                );
              })}
              <td className="px-2 py-2">
                <Button
                  size="small"
                  variant="destructive"
                  disabled={entry.founder}
                  onClick={() => onRemove(entry)}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleList({
  entries,
  roles,
  onChange,
  onRemove,
}: {
  readonly entries: readonly AccessEntry[];
  readonly roles: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (entry: AccessEntry, role: string) => void;
  readonly onRemove: (entry: AccessEntry) => void;
}): ReactNode {
  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => (
        <li
          key={entry.target}
          className="flex items-center gap-3 rounded-control px-2 py-2 hover:bg-[var(--fill-quaternary)]"
        >
          <span className="min-w-0 flex-1 truncate font-mono text-footnote text-[var(--label-primary)]">
            {entry.target}
          </span>
          <Select
            label={`What ${entry.target} can do`}
            labelHidden
            value={entry.role}
            onChange={(event) => onChange(entry, event.target.value)}
            options={roles.map((role) => ({ value: role.value, label: role.label }))}
          />
          <Button size="small" variant="destructive" onClick={() => onRemove(entry)}>
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}
