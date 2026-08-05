import {
  type ChannelDirectory,
  type ChannelState,
  type Message,
  type NetworkState,
  emptyChannel,
  initialNetworkState,
} from '@marmotter/client';
import {
  DEFAULT_CTCP_POLICY,
  DEFAULT_ISUPPORT,
  applyISupport,
  makeSource,
} from '@marmotter/protocol';
import { defaultLoggingPolicy } from '@marmotter/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { TabBar } from '../layout/TabBar.js';
import { AccountMenu } from './AccountMenu.js';
import { AccountPanel } from './AccountPanel.js';
import { AddNetwork } from './AddNetwork.js';
import { AppShell } from './AppShell.js';
import { ChannelAccess } from './ChannelAccess.js';
import { ChannelBrowser } from './ChannelBrowser.js';
import { ChannelPanel } from './ChannelPanel.js';
import { Composer } from './Composer.js';
import { DccBrowser } from './DccBrowser.js';
import { DccMonitorPanel } from './DccMonitorPanel.js';
import type { DccOfferRecord } from './view-store.js';
import { InviteBanner } from './Invites.js';
import { CreateChannel } from './CreateChannel.js';
import { ListPrompt } from './ListPrompt.js';
import { BanDialog, KickDialog } from './MemberDialogs.js';
import { PeoplePanel } from './PeoplePanel.js';
import { Marmotter } from './Marmotter.js';
import { MemberList } from './MemberList.js';
import { MessageList } from './MessageList.js';
import { MessageRow } from './MessageRow.js';
import { RawLog } from './RawLog.js';
import { Settings } from './Settings.js';
import { Sidebar } from './Sidebar.js';
import { TextPrompt } from './TextPrompt.js';
import { WhoisCard } from './WhoisCard.js';
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

const directory = (): ChannelDirectory => ({
  entries: [
    { channel: '#marmotter', members: 42, topic: 'Building the client | logs off' },
    { channel: '#libera', members: 1_204, topic: 'Welcome to Libera.Chat' },
    { channel: '#irc', members: 318, topic: 'Talking about the protocol itself' },
    { channel: '#rust', members: 2_880, topic: 'Rust programming language' },
    { channel: '#tauri', members: 96, topic: '' },
  ],
  loading: false,
  complete: true,
  truncated: false,
});

/** A channel with settings and lists to look at, for the channel panel. */
const moderatedChannel = (): ChannelState => ({
  ...channel(),
  modes: {
    flags: new Set(['n', 't', 'm', 'l']),
    params: new Map([['l', '120']]),
  },
  lists: {
    ban: [
      { mask: '*!*@spam.example', setBy: 'jonquil', at: at(0) },
      { mask: 'troublemaker!*@*', setBy: 'tamsin', at: at(1) },
    ],
    quiet: [{ mask: '*!*@noisy.example', setBy: 'jonquil', at: at(2) }],
    invite: [],
    except: [{ mask: '*!*@trusted.example', setBy: 'tamsin', at: undefined }],
  },
});

/** Somebody to build a ban against. */
const troublemaker = () => ({
  nick: 'corvid',
  user: '~c',
  host: 'pool-31.isp.example',
  account: 'corvid_acct',
  realname: 'corvid',
  away: false,
  bot: false,
  prefixes: '',
});

/** A network with friends, mutes and an invitation waiting. */
const social = (): NetworkState => ({
  ...network(),
  away: true,
  account: 'marmot',
  notify: new Map([
    ['tamsin', { nick: 'tamsin', online: true, known: true }],
    ['jonquil', { nick: 'jonquil', online: false, known: true }],
    ['bramble', { nick: 'bramble', online: false, known: false }],
  ]),
  ignores: [
    {
      mask: 'spammer!*@*',
      scope: { messages: true, notices: true, ctcp: true, invites: true, events: false },
      expiresAt: undefined,
      note: 'Kept posting links',
    },
  ],
  invites: [{ channel: '#ircv3', from: 'tamsin', at: at(3) }],
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

function fileOffers(): DccOfferRecord[] {
  const now = Date.now();
  return [
    {
      id: '1',
      networkId: 'libera',
      networkName: 'Libera.Chat',
      from: 'ferdinand',
      target: '#marmotter',
      filename: 'winter-hike.jpg',
      host: '198.51.100.20',
      port: 5001,
      size: 2_411_520,
      passive: false,
      receivedAt: now - 40_000,
      status: 'available',
    },
    {
      id: '2',
      networkId: 'libera',
      networkName: 'Libera.Chat',
      from: 'ilse',
      target: 'ilse',
      filename: 'meeting-notes.pdf',
      host: '203.0.113.7',
      port: 5002,
      size: 184_320,
      passive: false,
      receivedAt: now - 6 * 60_000,
      status: 'downloaded',
      savedPath: '/home/you/Downloads/meeting-notes.pdf',
    },
    {
      id: '3',
      networkId: 'libera',
      networkName: 'Libera.Chat',
      from: 'basil',
      target: '#marmotter',
      filename: 'firmware.bin',
      host: '198.51.100.44',
      port: 0,
      size: 8_388_608,
      passive: true,
      receivedAt: now - 2 * 60 * 60_000,
      status: 'available',
    },
  ];
}

export const TheFileMonitor: StoryObj = {
  render: function TheFileMonitor() {
    const [active, setActive] = useState(true);
    return (
      <div className="w-64">
        <DccMonitorPanel
          active={active}
          seen={active ? 3 : 0}
          onStart={() => setActive(true)}
          onStop={() => setActive(false)}
          onOpen={() => {}}
        />
      </div>
    );
  },
};

export const BrowsingFiles: StoryObj = {
  render: () => (
    <div className="h-[32rem] w-[52rem] overflow-hidden rounded-card border border-[var(--separator)]">
      <DccBrowser
        className="h-full overflow-y-auto"
        offers={fileOffers()}
        downloadFolder="/home/you/Downloads"
        onDownload={() => {}}
        onChooseFolder={() => {}}
        onClear={() => {}}
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

export const BrowsingChannels: StoryObj = {
  render: () => (
    <div className="flex h-96 w-[46rem] flex-col rounded-card border border-[var(--separator)]">
      <ChannelBrowser
        network={{ ...network(), directory: directory() }}
        onRefresh={() => {}}
        onJoin={() => {}}
        joined={new Set(['#marmotter'])}
      />
    </div>
  ),
};

export const BrowsingChannelsWhileLoading: StoryObj = {
  render: () => (
    <div className="flex h-96 w-[46rem] flex-col rounded-card border border-[var(--separator)]">
      <ChannelBrowser
        network={{ ...network(), directory: { ...directory(), loading: true, complete: false } }}
        onRefresh={() => {}}
        onJoin={() => {}}
      />
    </div>
  ),
};

export const TheChannelPanel: StoryObj = {
  render: function TheChannelPanel() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="text-[var(--accent)]">
          Channel settings
        </button>
        <ChannelPanel
          open={open}
          onClose={() => setOpen(false)}
          network={network()}
          channel={moderatedChannel()}
          onSend={() => {}}
        />
      </>
    );
  },
};

export const TheChannelPanelWithoutOps: StoryObj = {
  render: () => (
    <ChannelPanel
      open
      onClose={() => {}}
      network={network()}
      channel={moderatedChannel()}
      onSend={() => {}}
      canModerate={false}
    />
  ),
};

export const BuildingABan: StoryObj = {
  render: function BuildingABan() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="text-[var(--accent)]">
          Ban somebody
        </button>
        <BanDialog
          open={open}
          onClose={() => setOpen(false)}
          network={network()}
          channel={moderatedChannel()}
          member={troublemaker()}
          onSend={() => {}}
        />
      </>
    );
  },
};

export const RemovingSomebody: StoryObj = {
  render: () => (
    <KickDialog
      open
      onClose={() => {}}
      channel={moderatedChannel()}
      member={troublemaker()}
      onSend={() => {}}
    />
  ),
};

export const FriendsAndIgnored: StoryObj = {
  render: () => (
    <div className="w-[42rem]">
      <PeoplePanel
        network={social()}
        onWatch={() => {}}
        onUnwatch={() => {}}
        onMessage={() => {}}
        onIgnore={() => {}}
        onUnignore={() => {}}
      />
    </div>
  ),
};

export const AnInvitation: StoryObj = {
  render: () => (
    <div className="w-[42rem] rounded-card border border-[var(--separator)]">
      <InviteBanner invites={social().invites} onAccept={() => {}} onDismiss={() => {}} />
    </div>
  ),
};

export const YourAccount: StoryObj = {
  render: () => (
    <div className="flex h-64 w-[42rem] items-end justify-center">
      <AccountMenu
        network={social()}
        onSetAway={() => {}}
        onChangeNick={() => {}}
        onOpenPeople={() => {}}
      />
    </div>
  ),
};

export const YourAccountSettings: StoryObj = {
  render: () => (
    <div className="w-[42rem]">
      <AccountPanel network={social()} onSend={() => {}} />
    </div>
  ),
};

export const RegisteringAName: StoryObj = {
  render: () => (
    <div className="w-[42rem]">
      <AccountPanel network={{ ...network(), account: undefined }} onSend={() => {}} />
    </div>
  ),
};

/** A network whose ChanServ has answered, so the grid has rows. */
const withAthemeReplies = (): NetworkState => {
  const base = network();
  const notice = (id: string, text: string): Message => ({
    ...say('ChanServ', text, 1),
    id,
    kind: 'notice',
    target: 'ChanServ',
  });
  return {
    ...base,
    motd: ['Services provided by Atheme IRC Services'],
    queries: new Map([
      [
        'chanserv',
        {
          ...emptyChannel('ChanServ'),
          messages: [
            notice('c1', '1     tamsin                 +AFORefiorstv (FOUNDER)'),
            notice('c2', '2     jonquil                +AVvo'),
            notice('c3', '3     bramble                +Vv'),
          ],
        },
      ],
    ]),
  };
};

export const WhoCanDoWhat: StoryObj = {
  render: () => (
    <div className="w-[52rem]">
      <ChannelAccess network={withAthemeReplies()} channel={moderatedChannel()} onSend={() => {}} />
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

export const EditingANetwork: StoryObj = {
  render: function EditingANetwork() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="text-[var(--accent)]">
          Edit this network
        </button>
        <AddNetwork
          open={open}
          editing={{
            id: 'dashkova',
            name: 'dashkova.co.uk',
            servers: [
              { host: 'irc.dashkova.co.uk', port: 6697, tls: { mode: 'tls', verifyCert: true } },
            ],
            identity: {
              nick: 'marmot',
              altNicks: ['marmot_', 'marmot__'],
              username: 'marmot',
              realname: 'marmot',
            },
            autojoin: [{ target: '#marmotter' }],
            connectCommands: [],
            encoding: 'utf-8',
            autoReconnect: true,
            logging: defaultLoggingPolicy,
          }}
          onClose={() => setOpen(false)}
          onAdd={() => setOpen(false)}
        />
      </>
    );
  },
};

export const CreatingAChannel: StoryObj = {
  render: function CreatingAChannel() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="text-[var(--accent)]">
          Create channel
        </button>
        <CreateChannel
          open={open}
          networkName="Libera.Chat"
          onCreate={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  },
};

export const AskingForTheChannelList: StoryObj = {
  render: function AskingForTheChannelList() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="text-[var(--accent)]">
          Browse channels
        </button>
        <ListPrompt
          open={open}
          networkName="Libera.Chat"
          channelCount={23_871}
          limit={20_000}
          onCancel={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
        />
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
      showBrowseChannelsShortcut: true,
    });
    const [ctcp, setCtcp] = useState(DEFAULT_CTCP_POLICY);
    const [userOptions, setUserOptions] = useState({
      dccMonitorEnabled: false,
      downloadFolder: undefined as string | undefined,
    });

    return (
      <div className="h-[36rem] w-[40rem] overflow-hidden rounded-card border border-[var(--separator)]">
        <Settings
          className="h-full overflow-y-auto"
          networks={[network(), failedNetwork()]}
          appearance={appearance}
          onAppearanceChange={(changes) => setAppearance((current) => ({ ...current, ...changes }))}
          ctcp={ctcp}
          onCtcpChange={(changes) => setCtcp((current) => ({ ...current, ...changes }))}
          userOptions={userOptions}
          onUserOptionsChange={(changes) =>
            setUserOptions((current) => ({ ...current, ...changes }))
          }
          dccAvailable
          onChooseDownloadFolder={() =>
            setUserOptions((current) => ({ ...current, downloadFolder: '/home/you/Downloads' }))
          }
          onReconnect={() => {}}
          onDisconnect={() => {}}
          onEdit={() => {}}
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

export const Profile: StoryObj = {
  render: function Profile() {
    const [open, setOpen] = useState(true);
    // A WHOIS the reducer has already assembled — what the card shows instead
    // of the numerics it was built from.
    const withProfile: NetworkState = {
      ...network(),
      whois: new Map([
        [
          'jonquil',
          {
            nick: 'jonquil',
            user: '~j',
            host: 'host.example',
            realname: 'Jonquil',
            account: 'jonquil',
            server: 'irc.libera.chat',
            serverInfo: 'Libera.Chat Server',
            actualHost: '203.0.113.7',
            channels: ['@#marmotter', '+#irc'],
            idleSeconds: 8_130,
            signonAt: at(0),
            away: undefined,
            isOperator: false,
            isBot: false,
            secure: true,
            complete: true,
          },
        ],
      ]),
    };

    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="text-[var(--accent)]">
          View details
        </button>
        <WhoisCard
          open={open}
          nick="jonquil"
          network={withProfile}
          onClose={() => setOpen(false)}
          onMessage={() => setOpen(false)}
        />
      </>
    );
  },
};
