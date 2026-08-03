import {
  type ChannelState,
  type Message,
  type NetworkState,
  emptyChannel,
  initialNetworkState,
} from '@marmotter/client';
import { DEFAULT_ISUPPORT, applyISupport, makeSource } from '@marmotter/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { TabBar } from '../layout/TabBar.js';
import { AddNetwork } from './AddNetwork.js';
import { AppShell } from './AppShell.js';
import { Composer } from './Composer.js';
import { Marmotter } from './Marmotter.js';
import { MemberList } from './MemberList.js';
import { MessageList } from './MessageList.js';
import { MessageRow } from './MessageRow.js';
import { RawLog } from './RawLog.js';
import { Settings } from './Settings.js';
import { Sidebar } from './Sidebar.js';
import { TextPrompt } from './TextPrompt.js';
import { buildRows } from './rows.js';
import type { TargetRef, Unread } from './view-store.js';

export default { title: 'Application' } satisfies Meta;

const support = applyISupport(DEFAULT_ISUPPORT, [
  'PREFIX=(qaohv)~&@%+',
  'CHANTYPES=#',
  'CASEMAPPING=rfc1459',
  'NETWORK=Libera.Chat',
]);

const at = (minutes: number) => new Date(Date.UTC(2026, 7, 2, 9, minutes));

const say = (
  nick: string,
  text: string,
  minute: number,
  extra: Partial<Message> = {},
): Message => ({
  id: `m${minute}${nick}`,
  kind: 'privmsg',
  at: at(minute),
  fromServerTime: true,
  source: makeSource(nick, `~${nick[0]}`, 'host.example'),
  target: '#marmotter',
  text,
  account: undefined,
  replyTo: undefined,
  pending: false,
  tags: new Map(),
  ...extra,
});

const event = (nick: string, kind: Message['kind'], minute: number): Message =>
  say(nick, `${nick} ${kind === 'join' ? 'joined' : 'left'}`, minute, { kind });

const messages: Message[] = [
  say('jonquil', 'morning all', 1),
  say('jonquil', 'did the build finish?', 2),
  say('tamsin', 'jonquil: yes, about ten minutes ago', 3),
  say('tamsin', 'logs are at https://example.com/build/4821 if you want them', 4),
  event('bramble', 'join', 5),
  event('corvid', 'join', 5),
  event('dunlin', 'join', 5),
  say('bramble', 'anything I should look at?', 6),
  say('marmot', 'not yet — still reading', 7, { pending: true }),
  say('tamsin', 'waves', 8, { kind: 'action', text: 'waves' }),
  say('irc.libera.chat', 'jonquil set +mnt', 9, { kind: 'mode' }),
];

const member = (nick: string, prefixes: string, extra: Record<string, unknown> = {}) =>
  [
    nick,
    {
      nick,
      user: `~${nick[0]}`,
      host: 'host.example',
      account: undefined,
      realname: nick,
      away: false,
      bot: false,
      prefixes,
      ...extra,
    },
  ] as const;

const channel = (): ChannelState => ({
  ...emptyChannel('#marmotter'),
  joined: true,
  topic: { text: 'Building a nicer IRC client', setBy: 'tamsin', at: at(0) },
  messages,
  members: new Map([
    member('jonquil', '@'),
    member('tamsin', '+', { account: 'tam' }),
    member('bramble', ''),
    member('corvid', '', { away: true }),
    member('dunlin', '', { bot: true }),
    member('marmot', ''),
  ]),
});

const network = (): NetworkState => ({
  ...initialNetworkState('libera', 'Libera.Chat', 'marmot'),
  phase: 'registered',
  support,
  channels: new Map([['#marmotter', channel()]]),
  rawLog: [
    { at: at(0), direction: 'out', line: 'CAP LS 302' },
    { at: at(0), direction: 'in', line: ':irc.libera.chat CAP * LS :sasl server-time' },
    { at: at(0), direction: 'out', line: 'NICK marmot' },
    { at: at(1), direction: 'in', line: ':irc.libera.chat 001 marmot :Welcome' },
    {
      at: at(2),
      direction: 'in',
      line: ':jonquil!~j@host.example PRIVMSG #marmotter :morning all',
    },
  ],
});

const failedNetwork = (): NetworkState => ({
  ...initialNetworkState('dashkova', 'dashkova.co.uk', 'marmot'),
  phase: 'disconnected',
  lastClose: { kind: 'network-error', message: 'connection refused' },
});

const noUnread = (): Unread => ({ count: 0, highlight: false });

export const Rows: StoryObj = {
  render: () => (
    <div className="w-[42rem]">
      {buildRows(messages, { foldEvents: true }).map((row) => (
        <MessageRow
          key={row.id}
          row={row}
          nickWidth={12}
          alignNicksRight
          showTimestamps
          isMember={(word) => channel().members.has(word.toLowerCase())}
          onReply={() => {}}
          onCopy={() => {}}
        />
      ))}
    </div>
  ),
};

export const RowsLeftAligned: StoryObj = {
  render: () => (
    <div className="w-[42rem]">
      {buildRows(messages, { foldEvents: false }).map((row) => (
        <MessageRow
          key={row.id}
          row={row}
          nickWidth={10}
          alignNicksRight={false}
          showTimestamps={false}
        />
      ))}
    </div>
  ),
};

export const Messages: StoryObj = {
  render: () => (
    <div className="flex h-96 w-[42rem] flex-col rounded-card border border-[var(--separator)]">
      <MessageList
        network={network()}
        conversation={channel()}
        nickWidth={12}
        alignNicksRight
        showTimestamps
        foldEvents
        unreadCount={2}
        isHighlight={(message) => message.text.includes('jonquil:')}
      />
    </div>
  ),
};

export const Composing: StoryObj = {
  render: function Composing() {
    const [value, setValue] = useState('tamsin: thanks, looking now');

    return (
      <div className="w-[42rem] rounded-card border border-[var(--separator)]">
        <Composer
          value={value}
          onChange={setValue}
          onSend={() => setValue('')}
          target="#marmotter"
          nicks={['jonquil', 'tamsin', 'bramble', 'corvid']}
          channels={['#marmotter', '#ircv3']}
          fold={(text) => text.toLowerCase()}
          typing={['jonquil']}
        />
      </div>
    );
  },
};

export const ComposingAReply: StoryObj = {
  render: function ComposingAReply() {
    const [value, setValue] = useState('');

    return (
      <div className="w-[42rem] rounded-card border border-[var(--separator)]">
        <Composer
          value={value}
          onChange={setValue}
          onSend={() => setValue('')}
          target="#marmotter"
          nicks={['jonquil']}
          channels={[]}
          fold={(text) => text.toLowerCase()}
          replyingTo={{ id: 'm2', nick: 'jonquil', text: 'did the build finish?' }}
          onCancelReply={() => {}}
        />
      </div>
    );
  },
};

export const Members: StoryObj = {
  render: () => (
    <div className="h-96 w-56">
      <MemberList
        network={network()}
        channel={channel()}
        menuFor={(entry) => [
          { id: 'msg', label: 'Send a message', onSelect: () => {} },
          { id: 'ban', label: `Ban ${entry.nick}`, onSelect: () => {}, destructive: true },
        ]}
      />
    </div>
  ),
};

export const Channels: StoryObj = {
  render: function Channels() {
    const [selection, setSelection] = useState<TargetRef | undefined>({
      networkId: 'libera',
      target: '#marmotter',
    });

    return (
      <div className="h-96 w-64">
        <Sidebar
          networks={[network()]}
          selection={selection}
          onSelect={setSelection}
          unreadFor={(ref) =>
            ref.target === '#marmotter' ? { count: 4, highlight: true } : noUnread()
          }
          collapsed={new Set()}
          onToggleCollapsed={() => {}}
          onReorder={() => {}}
          onAddNetwork={() => {}}
          onOpenSettings={() => {}}
          onBrowseChannels={() => {}}
        />
      </div>
    );
  },
};

export const TheRawLog: StoryObj = {
  render: () => (
    <div className="h-80 w-[42rem] rounded-card border border-[var(--separator)]">
      <RawLog network={network()} onCopy={() => {}} />
    </div>
  ),
};

export const AddingANetwork: StoryObj = {
  render: function AddingANetwork() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="text-[var(--accent)]">
          Add a network
        </button>
        <AddNetwork open={open} onClose={() => setOpen(false)} onAdd={() => setOpen(false)} />
      </>
    );
  },
};

export const TheWholeShell: StoryObj = {
  parameters: { layout: 'fullscreen' },
  render: function TheWholeShell() {
    const [value, setValue] = useState('');
    const [selection, setSelection] = useState<TargetRef | undefined>({
      networkId: 'libera',
      target: '#marmotter',
    });

    return (
      <div className="h-[36rem] overflow-hidden rounded-card border border-[var(--separator)]">
        <AppShell
          sidebar={
            <Sidebar
              networks={[network()]}
              selection={selection}
              onSelect={setSelection}
              unreadFor={noUnread}
              collapsed={new Set()}
              onToggleCollapsed={() => {}}
              onReorder={() => {}}
              onAddNetwork={() => {}}
              onOpenSettings={() => {}}
            />
          }
          aside={<MemberList network={network()} channel={channel()} />}
          tabBar={
            <TabBar
              value="chats"
              onChange={() => {}}
              items={[
                { value: 'chats', label: 'Chats', icon: <span>◍</span>, badge: 4 },
                { value: 'you', label: 'You', icon: <span>◒</span> },
              ]}
            />
          }
          main={
            <>
              <MessageList
                network={network()}
                conversation={channel()}
                nickWidth={12}
                alignNicksRight
                showTimestamps
                foldEvents
              />
              <Composer
                value={value}
                onChange={setValue}
                onSend={() => setValue('')}
                target="#marmotter"
                nicks={['jonquil', 'tamsin']}
                channels={['#marmotter']}
                fold={(text) => text.toLowerCase()}
              />
            </>
          }
        />
      </div>
    );
  },
};

/**
 * The whole client, on first run.
 *
 * The transport never opens, because a story should not dial out to a real
 * network — so this is exactly what somebody sees the first time they start the
 * app, which is the state worth being able to look at.
 */
export const FirstRun: StoryObj = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="h-[36rem] overflow-hidden rounded-card border border-[var(--separator)]">
      <Marmotter
        createTransport={() => ({
          connect: () => new Promise<void>(() => {}),
          send: () => {},
          onLine: () => () => {},
          onClose: () => () => {},
          disconnect: () => {},
        })}
      />
    </div>
  ),
};

export const SettingsScreen: StoryObj = {
  render: function SettingsScreen() {
    const [appearance, setAppearance] = useState({
      nickColumnWidth: 12,
      alignNicksRight: true,
      foldEvents: true,
      showTimestamps: true,
      unfurlLinks: false,
      highlightWords: [] as readonly string[],
      notificationsEnabled: true,
    });

    return (
      <div className="h-[36rem] w-[40rem] overflow-hidden rounded-card border border-[var(--separator)]">
        <Settings
          className="h-full overflow-y-auto"
          networks={[network(), failedNetwork()]}
          appearance={appearance}
          onAppearanceChange={(changes) => setAppearance((current) => ({ ...current, ...changes }))}
          onReconnect={() => {}}
          onDisconnect={() => {}}
          onRemove={() => {}}
          onAddNetwork={() => {}}
        />
      </div>
    );
  },
};

export const JoinAChannel: StoryObj = {
  render: function JoinAChannel() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="text-[var(--accent)]">
          Join a channel
        </button>
        <TextPrompt
          open={open}
          title="Join a channel"
          label="Channel name"
          placeholder="#marmotter"
          hint="The # is added for you if you leave it off."
          confirmLabel="Join"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  },
};
