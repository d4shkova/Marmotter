import type { IgnoreRule, NetworkState, NotifyEntry } from '@marmotter/client';
import { completeMask, isActive, notifyLimit } from '@marmotter/client';
import { type ReactNode, useState } from 'react';
import { ListGroup } from '../layout/ListGroup.js';
import { StatusDot } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { Checkbox } from '../primitives/Checkbox.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { ListRow } from '../primitives/ListRow.js';
import { Select } from '../primitives/Select.js';
import { Table } from '../primitives/Table.js';
import { Tabs } from '../primitives/Tabs.js';
import { TextField } from '../primitives/TextField.js';

export interface PeoplePanelProps {
  readonly network: NetworkState;
  readonly onWatch: (nick: string) => void;
  readonly onUnwatch: (nick: string) => void;
  readonly onMessage: (nick: string) => void;
  readonly onIgnore: (mask: string, options: IgnoreOptions) => void;
  readonly onUnignore: (mask: string) => void;
  readonly className?: string;
}

export interface IgnoreOptions {
  readonly scope: {
    readonly messages: boolean;
    readonly notices: boolean;
    readonly ctcp: boolean;
    readonly invites: boolean;
    readonly events: boolean;
  };
  /** Milliseconds until it lapses, or undefined for indefinite. */
  readonly durationMs?: number;
  readonly note?: string;
}

/** How long a mute lasts, offered as durations rather than as a timestamp. */
const DURATIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '0', label: 'Until I remove it' },
  { value: `${60 * 60 * 1000}`, label: 'One hour' },
  { value: `${8 * 60 * 60 * 1000}`, label: 'Eight hours' },
  { value: `${24 * 60 * 60 * 1000}`, label: 'One day' },
  { value: `${7 * 24 * 60 * 60 * 1000}`, label: 'One week' },
];

const SCOPES: readonly { readonly key: keyof IgnoreOptions['scope']; readonly label: string }[] = [
  { key: 'messages', label: 'Messages' },
  { key: 'notices', label: 'Notices' },
  { key: 'ctcp', label: 'Automated requests' },
  { key: 'invites', label: 'Invitations' },
  { key: 'events', label: 'Joining and leaving' },
];

/**
 * The two lists a person keeps about other people: who they want to hear from,
 * and who they do not.
 *
 * Both are in one place because they answer the same question from opposite
 * ends, and because neither is big enough to earn a screen of its own.
 *
 * The friends list never says which mechanism the network runs underneath —
 * MONITOR, WATCH, or a slow WHOIS poll. Which one it is changes nothing a
 * person can act on, and naming it would be exactly the kind of protocol detail
 * CLAUDE.md keeps out of the interface.
 */
export function PeoplePanel({
  network,
  onWatch,
  onUnwatch,
  onMessage,
  onIgnore,
  onUnignore,
  className,
}: PeoplePanelProps): ReactNode {
  const [tab, setTab] = useState<'friends' | 'ignored'>('friends');

  const friends = [...network.notify.values()];
  const limit = notifyLimit(network.support);
  const now = new Date();
  const rules = network.ignores.filter((rule) => isActive(rule, now));

  return (
    <div className={className}>
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
        <h1 className="text-title-2 font-bold text-[var(--label-primary)]">People</h1>

        <Tabs
          label="People"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'friends' as const, label: 'Friends', count: friends.length },
            { value: 'ignored' as const, label: 'Ignored', count: rules.length },
          ]}
        >
          {tab === 'friends' ? (
            <Friends
              friends={friends}
              limit={limit}
              networkName={network.name}
              onWatch={onWatch}
              onUnwatch={onUnwatch}
              onMessage={onMessage}
            />
          ) : (
            <Ignored rules={rules} onIgnore={onIgnore} onUnignore={onUnignore} />
          )}
        </Tabs>
      </div>
    </div>
  );
}

function Friends({
  friends,
  limit,
  networkName,
  onWatch,
  onUnwatch,
  onMessage,
}: {
  readonly friends: readonly NotifyEntry[];
  readonly limit: number | undefined;
  readonly networkName: string;
  readonly onWatch: (nick: string) => void;
  readonly onUnwatch: (nick: string) => void;
  readonly onMessage: (nick: string) => void;
}): ReactNode {
  const [nick, setNick] = useState('');
  const full = limit !== undefined && friends.length >= limit;

  const add = (): void => {
    const value = nick.trim();
    if (value !== '' && !full) {
      onWatch(value);
      setNick('');
    }
  };

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-end gap-2">
        <TextField
          label="Tell me when somebody comes online"
          className="flex-1"
          value={nick}
          placeholder="Their name"
          disabled={full}
          hint={
            full
              ? `${networkName} will only watch ${String(limit)} names at once. Remove one to add another.`
              : 'They are not told you are watching.'
          }
          onChange={(event) => setNick(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="primary" disabled={nick.trim() === '' || full} onClick={add}>
          Add
        </Button>
      </div>

      {friends.length === 0 ? (
        <EmptyState
          title="Nobody on the list yet"
          description="Add somebody and Marmotter will tell you when they come online."
        />
      ) : (
        <ListGroup header="Watching">
          {friends.map((friend) => (
            <ListRow
              key={friend.nick}
              leading={<StatusDot status={statusOf(friend)} />}
              title={friend.nick}
              subtitle={describeFriend(friend)}
              trailing={
                <div className="flex items-center gap-1.5">
                  <Button size="small" onClick={() => onMessage(friend.nick)}>
                    Message
                  </Button>
                  <Button size="small" variant="plain" onClick={() => onUnwatch(friend.nick)}>
                    Remove
                  </Button>
                </div>
              }
            />
          ))}
        </ListGroup>
      )}
    </div>
  );
}

function Ignored({
  rules,
  onIgnore,
  onUnignore,
}: {
  readonly rules: readonly IgnoreRule[];
  readonly onIgnore: (mask: string, options: IgnoreOptions) => void;
  readonly onUnignore: (mask: string) => void;
}): ReactNode {
  const [mask, setMask] = useState('');
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState('0');
  const [scope, setScope] = useState<IgnoreOptions['scope']>({
    messages: true,
    notices: true,
    ctcp: true,
    invites: true,
    events: false,
  });

  const nothingSelected = !Object.values(scope).some(Boolean);
  const completed = mask.trim() === '' ? '' : completeMask(mask.trim());

  const add = (): void => {
    if (completed === '' || nothingSelected) {
      return;
    }
    const ms = Number.parseInt(duration, 10);
    onIgnore(completed, {
      scope,
      ...(ms > 0 ? { durationMs: ms } : {}),
      ...(note.trim() === '' ? {} : { note: note.trim() }),
    });
    setMask('');
    setNote('');
  };

  return (
    <div className="flex flex-col gap-5 py-2">
      <p className="text-subhead text-[var(--label-secondary)]">
        Ignoring somebody happens on this device only. Nothing is sent to the network, and they
        cannot tell.
      </p>

      <div className="flex flex-col gap-3 rounded-card bg-[var(--bg-elevated)] p-4">
        <TextField
          label="Who to ignore"
          value={mask}
          placeholder="Their name, or name!user@address"
          hint={
            completed === '' || completed === mask.trim()
              ? 'A name on its own covers them wherever they connect from.'
              : `This will be stored as ${completed}`
          }
          onChange={(event) => setMask(event.target.value)}
        />

        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1 text-subhead font-semibold text-[var(--label-primary)]">
            What to hide
          </legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {SCOPES.map((entry) => (
              <Checkbox
                key={entry.key}
                label={entry.label}
                checked={scope[entry.key]}
                onChange={(checked) =>
                  setScope((current) => ({ ...current, [entry.key]: checked }))
                }
              />
            ))}
          </div>
          {!nothingSelected ? null : (
            <p className="pt-1 text-caption-1 text-[var(--danger)]">
              Pick at least one thing to hide, or the rule would do nothing.
            </p>
          )}
        </fieldset>

        <Select
          label="How long"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          options={DURATIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
        />

        <TextField
          label="Note"
          value={note}
          placeholder="Optional — why you added this"
          onChange={(event) => setNote(event.target.value)}
        />

        <div>
          <Button variant="primary" disabled={completed === '' || nothingSelected} onClick={add}>
            Ignore
          </Button>
        </div>
      </div>

      {rules.length === 0 ? (
        <EmptyState title="Nobody is ignored" description="Anyone you mute will be listed here." />
      ) : (
        <Table
          caption="People being ignored"
          rows={[...rules]}
          rowKey={(rule) => rule.mask}
          columns={[
            {
              id: 'mask',
              header: 'Who',
              mono: true,
              render: (rule) => rule.mask,
              compare: (left, right) => left.mask.localeCompare(right.mask),
            },
            { id: 'scope', header: 'Hiding', render: (rule) => describeScope(rule) },
            { id: 'expiry', header: 'Until', render: (rule) => describeExpiry(rule) },
            {
              id: 'remove',
              header: 'Remove',
              align: 'end',
              render: (rule) => (
                <Button size="small" variant="destructive" onClick={() => onUnignore(rule.mask)}>
                  Stop ignoring
                </Button>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

const statusOf = (friend: NotifyEntry): 'connected' | 'offline' | 'connecting' =>
  !friend.known ? 'connecting' : friend.online ? 'connected' : 'offline';

const describeFriend = (friend: NotifyEntry): string =>
  !friend.known ? 'Waiting to hear' : friend.online ? 'Online now' : 'Not online';

/** What a rule hides, as a sentence rather than as a list of flags. */
function describeScope(rule: IgnoreRule): string {
  const parts = SCOPES.filter((entry) => rule.scope[entry.key]).map((entry) =>
    entry.label.toLowerCase(),
  );
  if (parts.length === SCOPES.length) {
    return 'Everything';
  }
  return parts.length === 0 ? 'Nothing' : parts.join(', ');
}

function describeExpiry(rule: IgnoreRule): string {
  if (rule.expiresAt === undefined) {
    return 'I remove it';
  }
  return rule.expiresAt.toLocaleString();
}
