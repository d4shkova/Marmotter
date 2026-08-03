import type { ChannelState, ListEntry, NetworkState } from '@marmotter/client';
import { type ListKind, serializeModeChanges } from '@marmotter/protocol';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Decoder } from '../decoder/Decoder.js';
import { ListGroup } from '../layout/ListGroup.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { Sheet } from '../primitives/Sheet.js';
import { Spinner } from '../primitives/Spinner.js';
import { Stepper } from '../primitives/Stepper.js';
import { Table } from '../primitives/Table.js';
import { Tabs } from '../primitives/Tabs.js';
import { TextField } from '../primitives/TextField.js';
import { Toggle } from '../primitives/Toggle.js';
import {
  type ChannelSettings,
  channelControls,
  diffChannelModes,
  settingsFrom,
  unexplainedModes,
} from './channel-settings.js';
import { membersMatching } from './mask.js';

export interface ChannelPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly network: NetworkState;
  readonly channel: ChannelState;
  /** Sends a raw line. Everything this panel does goes out as MODE or TOPIC. */
  readonly onSend: (line: string) => void;
  /** Whether the user may change anything, or is only looking. */
  readonly canModerate?: boolean;
  /** Invites somebody in. Absent where the shell has no session to send with. */
  readonly onInvite?: (nick: string) => void;
  /** Names to offer as quick picks — the friends list, typically. */
  readonly inviteSuggestions?: readonly string[];
}

/** The list modes, in the order the tabs show them. */
const LIST_TABS: readonly {
  readonly kind: ListKind;
  readonly mode: string;
  readonly label: string;
  readonly blurb: string;
  readonly addLabel: string;
}[] = [
  {
    kind: 'ban',
    mode: 'b',
    label: 'Banned',
    blurb: 'People matching these cannot join or send messages.',
    addLabel: 'Ban somebody',
  },
  {
    kind: 'quiet',
    mode: 'q',
    label: 'Muted',
    blurb: 'People matching these can stay, but cannot send messages.',
    addLabel: 'Mute somebody',
  },
  {
    kind: 'invite',
    mode: 'I',
    label: 'Invited',
    blurb: 'People matching these can join without an invitation, even when the channel is closed.',
    addLabel: 'Let somebody in',
  },
  {
    kind: 'except',
    mode: 'e',
    label: 'Allowed',
    blurb: 'People matching these are let in even when a ban would otherwise catch them.',
    addLabel: 'Allow somebody',
  },
];

type TabValue = 'settings' | ListKind;

/**
 * Everything about a channel that is not its messages.
 *
 * This is the largest single piece of CLAUDE.md's abstraction layer: the modes
 * become labelled controls, the four list modes become tables with a mask
 * builder and a Remove button, and the topic becomes a text field. Nothing here
 * shows a mode letter in its primary copy — the letters live in the decoder
 * beside each row, which is where somebody who wants them can find them.
 *
 * Which tabs exist is decided by the network's own `CHANMODES`. A server with
 * no mute list never shows a Muted tab, because a tab that cannot work is worse
 * than no tab.
 */
export function ChannelPanel({
  open,
  onClose,
  network,
  channel,
  onSend,
  canModerate = true,
  onInvite,
  inviteSuggestions = [],
}: ChannelPanelProps): ReactNode {
  const support = network.support;
  const controls = useMemo(() => channelControls(channel.modes, support), [channel.modes, support]);

  const [tab, setTab] = useState<TabValue>('settings');
  const [settings, setSettings] = useState<ChannelSettings>(() => settingsFrom(controls));
  const [topic, setTopic] = useState(channel.topic?.text ?? '');
  const [newMask, setNewMask] = useState('');
  const [invitee, setInvitee] = useState('');
  /** The controls the settings state was built from, so a MODE resets the form. */
  const [basis, setBasis] = useState(controls);

  // The channel changing underneath the panel — somebody else setting a mode —
  // has to win over an untouched form, or the panel would quietly re-apply
  // stale settings when saved.
  if (basis !== controls) {
    setBasis(controls);
    setSettings(settingsFrom(controls));
    setTopic(channel.topic?.text ?? '');
  }

  const available = LIST_TABS.filter((entry) => support.chanModes.list.includes(entry.mode));
  const pending = diffChannelModes(controls, settings, support);
  const topicChanged = topic.trim() !== (channel.topic?.text ?? '').trim();
  const hidden = unexplainedModes(support);

  const applySettings = (): void => {
    for (const command of serializeModeChanges(pending, support)) {
      onSend(`MODE ${channel.name} ${command.modeString} ${command.params.join(' ')}`.trim());
    }
    if (topicChanged) {
      onSend(`TOPIC ${channel.name} :${topic.trim()}`);
    }
    onClose();
  };

  const listTab = available.find((entry) => entry.kind === tab);

  // A list is fetched when its tab is first opened, not on join. Four `MODE +b`
  // queries per channel at join time is a burst of traffic for tables most
  // people never look at, and some networks rate-limit it.
  const requested = useRef(new Set<ListKind>());
  useEffect(() => {
    if (!open || listTab === undefined || requested.current.has(listTab.kind)) {
      return;
    }
    requested.current.add(listTab.kind);
    onSend(`MODE ${channel.name} +${listTab.mode}`);
  }, [open, listTab, channel.name, onSend]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={channel.name}
      {...(tab !== 'settings'
        ? {}
        : {
            footer: (
              <>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                  variant="primary"
                  disabled={!canModerate || (pending.length === 0 && !topicChanged)}
                  onClick={applySettings}
                >
                  Save changes
                </Button>
              </>
            ),
          })}
    >
      <Tabs
        label="Channel"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'settings' as const, label: 'Settings' },
          ...available.map((entry) => ({
            value: entry.kind,
            label: entry.label,
            count: channel.lists[entry.kind].length,
          })),
        ]}
      >
        {tab === 'settings' ? (
          <div className="flex flex-col gap-6 py-2">
            <ListGroup
              header="Topic"
              {...(channel.topic?.setBy === undefined
                ? {}
                : { footer: `Last changed by ${channel.topic.setBy}.` })}
            >
              <div className="px-4 py-3">
                <TextField
                  label="What this channel is about"
                  labelHidden
                  value={topic}
                  disabled={!canModerate}
                  placeholder="What is this channel about?"
                  onChange={(event) => setTopic(event.target.value)}
                />
              </div>
            </ListGroup>

            {onInvite === undefined ? null : (
              <ListGroup
                header="Invite somebody"
                footer="They get a notification, and can join even when the channel is closed."
              >
                <div className="flex items-end gap-2 px-4 py-3">
                  <TextField
                    label="Their name"
                    className="flex-1"
                    value={invitee}
                    placeholder="Their name"
                    onChange={(event) => setInvitee(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && invitee.trim() !== '') {
                        event.preventDefault();
                        onInvite(invitee.trim());
                        setInvitee('');
                      }
                    }}
                  />
                  <Button
                    variant="primary"
                    disabled={invitee.trim() === ''}
                    onClick={() => {
                      onInvite(invitee.trim());
                      setInvitee('');
                    }}
                  >
                    Invite
                  </Button>
                </div>
                {inviteSuggestions.length === 0 ? null : (
                  <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                    {inviteSuggestions.slice(0, 8).map((name) => (
                      <Button key={name} size="small" onClick={() => setInvitee(name)}>
                        {name}
                      </Button>
                    ))}
                  </div>
                )}
              </ListGroup>
            )}

            <ListGroup
              header="Who can take part"
              {...(hidden.length === 0
                ? {}
                : {
                    footer:
                      'This network has settings Marmotter cannot describe. They are still reachable from the command bar and visible in the raw log.',
                  })}
            >
              {controls.length === 0 ? (
                <div className="px-4 py-3 text-subhead text-[var(--label-secondary)]">
                  This network has not said which settings this channel has.
                </div>
              ) : (
                controls.map((control) => (
                  <div key={control.mode} className="px-4 py-3">
                    {control.kind === 'flag' ? (
                      <Toggle
                        label={control.title}
                        hint={control.caveat ?? control.detail}
                        checked={settings[control.mode]?.enabled ?? false}
                        disabled={!canModerate}
                        onChange={(enabled) =>
                          setSettings((current) => ({
                            ...current,
                            [control.mode]: { enabled, value: current[control.mode]?.value ?? '' },
                          }))
                        }
                      />
                    ) : control.kind === 'password' ? (
                      <TextField
                        label={control.title}
                        hint={control.detail}
                        type="password"
                        value={settings[control.mode]?.value ?? ''}
                        disabled={!canModerate}
                        placeholder="No password"
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            [control.mode]: {
                              enabled: event.target.value.trim() !== '',
                              value: event.target.value,
                            },
                          }))
                        }
                      />
                    ) : (
                      <Stepper
                        label={control.title}
                        value={Number.parseInt(settings[control.mode]?.value ?? '0', 10) || 0}
                        min={0}
                        max={9999}
                        format={(size) => (size === 0 ? 'No limit' : `${size} people`)}
                        disabled={!canModerate}
                        onChange={(next) =>
                          setSettings((current) => ({
                            ...current,
                            [control.mode]: { enabled: next > 0, value: String(next) },
                          }))
                        }
                      />
                    )}
                    <div className="pt-1">
                      {/* The letters come from the server's own grouping, so
                          `+q` reads as a mute where the network keeps a mute
                          list and as ownership where it does not. */}
                      <Decoder
                        token={`+${control.mode}`}
                        context={{
                          roleModes: support.prefixes.map((entry) => entry.mode).join(''),
                          listModes: support.chanModes.list,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </ListGroup>
          </div>
        ) : listTab === undefined ? null : (
          <MaskList
            network={network}
            channel={channel}
            tab={listTab}
            canModerate={canModerate}
            mask={newMask}
            onMaskChange={setNewMask}
            onAdd={() => {
              const value = newMask.trim();
              if (value !== '') {
                onSend(`MODE ${channel.name} +${listTab.mode} ${value}`);
                setNewMask('');
              }
            }}
            onRemove={(entry) => onSend(`MODE ${channel.name} -${listTab.mode} ${entry.mask}`)}
          />
        )}
      </Tabs>
    </Sheet>
  );
}

/** One list mode's table, with the mask builder above it. */
function MaskList({
  network,
  channel,
  tab,
  canModerate,
  mask,
  onMaskChange,
  onAdd,
  onRemove,
}: {
  readonly network: NetworkState;
  readonly channel: ChannelState;
  readonly tab: (typeof LIST_TABS)[number];
  readonly canModerate: boolean;
  readonly mask: string;
  readonly onMaskChange: (value: string) => void;
  readonly onAdd: () => void;
  readonly onRemove: (entry: ListEntry) => void;
}): ReactNode {
  const entries = channel.lists[tab.kind];
  const loading = channel.listsLoading.has(tab.kind);

  // Who the mask being typed would catch, among the people here now. The
  // server does the real matching; this is so nobody sends a mask that turns
  // out to be far wider than they meant.
  const affected = useMemo(
    () =>
      mask.trim() === ''
        ? []
        : membersMatching(mask.trim(), channel.members.values(), network.support),
    [mask, channel.members, network.support],
  );

  return (
    <div className="flex flex-col gap-4 py-2">
      <p className="text-subhead text-[var(--label-secondary)]">{tab.blurb}</p>

      {!canModerate ? null : (
        <div className="flex items-end gap-2">
          <TextField
            label={tab.addLabel}
            className="flex-1"
            value={mask}
            placeholder="name!user@address"
            hint={
              mask.trim() === ''
                ? 'Right-click somebody in the member list to build this from who they are.'
                : affected.length === 0
                  ? 'Nobody here matches this right now.'
                  : `This matches ${affected.length === 1 ? '1 person' : `${affected.length} people`} here: ${affected
                      .map((member) => member.nick)
                      .slice(0, 5)
                      .join(', ')}`
            }
            onChange={(event) => onMaskChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onAdd();
              }
            }}
          />
          <Button variant="primary" disabled={mask.trim() === ''} onClick={onAdd}>
            Add
          </Button>
        </div>
      )}

      {loading && entries.length === 0 ? (
        <div className="flex justify-center py-8">
          <Spinner label="Asking the server for the list" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState title={`Nothing on the ${tab.label.toLowerCase()} list`} />
      ) : (
        <Table
          caption={`${tab.label} in ${channel.name}`}
          rows={[...entries]}
          rowKey={(entry) => entry.mask}
          columns={[
            {
              id: 'mask',
              header: 'Who',
              mono: true,
              render: (entry) => entry.mask,
              compare: (left, right) => left.mask.localeCompare(right.mask),
            },
            {
              id: 'setBy',
              header: 'Added by',
              render: (entry) => entry.setBy ?? 'Unknown',
            },
            {
              id: 'at',
              header: 'When',
              render: (entry) =>
                entry.at === undefined ? 'Unknown' : entry.at.toLocaleDateString(),
              compare: (left, right) => (left.at?.getTime() ?? 0) - (right.at?.getTime() ?? 0),
            },
            ...(canModerate
              ? [
                  {
                    id: 'remove',
                    header: 'Remove',
                    align: 'end' as const,
                    render: (entry: ListEntry) => (
                      <Button size="small" variant="destructive" onClick={() => onRemove(entry)}>
                        Remove
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}
