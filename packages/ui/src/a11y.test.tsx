import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ChannelState,
  type Message,
  type NetworkState,
  emptyChannel,
  initialNetworkState,
} from '@marmotter/client';
import { DEFAULT_ISUPPORT, applyISupport, makeSource } from '@marmotter/protocol';
import { AddNetwork } from './app/AddNetwork.js';
import { Composer } from './app/Composer.js';
import { MemberList } from './app/MemberList.js';
import { MessageList } from './app/MessageList.js';
import { MessageRow } from './app/MessageRow.js';
import { RawLog } from './app/RawLog.js';
import { Settings } from './app/Settings.js';
import { Sidebar } from './app/Sidebar.js';
import { buildRows } from './app/rows.js';
import { Decoder } from './decoder/Decoder.js';
import { ListGroup, SectionHeader } from './layout/ListGroup.js';
import { NavBar } from './layout/NavBar.js';
import { TabBar } from './layout/TabBar.js';
import { Avatar } from './primitives/Avatar.js';
import { Badge, StatusDot } from './primitives/Badge.js';
import { Button } from './primitives/Button.js';
import { Checkbox } from './primitives/Checkbox.js';
import { ContextMenu } from './primitives/ContextMenu.js';
import { EmptyState } from './primitives/EmptyState.js';
import { IconButton } from './primitives/IconButton.js';
import { ListRow } from './primitives/ListRow.js';
import { Modal } from './primitives/Modal.js';
import { Popover } from './primitives/Popover.js';
import { RadioGroup } from './primitives/Radio.js';
import { SearchField } from './primitives/SearchField.js';
import { SegmentedControl } from './primitives/SegmentedControl.js';
import { Select } from './primitives/Select.js';
import { Sheet } from './primitives/Sheet.js';
import { Spinner } from './primitives/Spinner.js';
import { Stepper } from './primitives/Stepper.js';
import { Table } from './primitives/Table.js';
import { Tabs } from './primitives/Tabs.js';
import { TextField } from './primitives/TextField.js';
import { ToastRegion } from './primitives/Toast.js';
import { Toggle } from './primitives/Toggle.js';
import { Tooltip } from './primitives/Tooltip.js';

afterEach(cleanup);

/**
 * The accessibility floor from CLAUDE.md, checked rather than assumed.
 *
 * axe cannot see colour contrast here — jsdom has no layout and no computed
 * colours — so contrast is covered separately by `tokens.test.ts`, which checks
 * the ramp itself. What axe does catch is the structural half: a control with
 * no name, a role used wrongly, a label pointing at nothing.
 */
async function expectNoViolations(ui: ReactNode): Promise<void> {
  const { container } = render(<main>{ui}</main>);
  const results = await axe.run(container, {
    // Needs real layout and computed styles, neither of which jsdom has.
    rules: { 'color-contrast': { enabled: false } },
  });

  const described = results.violations.map(
    (violation) => `${violation.id}: ${violation.description}`,
  );
  expect(described).toEqual([]);
}

/** A small but realistic conversation, for the shell components. */
const supportFixture = applyISupport(DEFAULT_ISUPPORT, [
  'PREFIX=(qaohv)~&@%+',
  'CHANTYPES=#',
  'CASEMAPPING=rfc1459',
]);

const messageFixture = (id: string, text: string, kind: Message['kind'] = 'privmsg'): Message => ({
  id,
  kind,
  at: new Date('2026-08-02T09:00:00.000Z'),
  fromServerTime: true,
  source: makeSource('tamsin', '~t', 'host.example'),
  target: '#marmotter',
  text,
  account: undefined,
  replyTo: undefined,
  pending: false,
  tags: new Map(),
});

const channelFixture = (): ChannelState => ({
  ...emptyChannel('#marmotter'),
  joined: true,
  messages: [messageFixture('a', 'morning all'), messageFixture('b', 'jonquil set +mnt', 'mode')],
  members: new Map([
    [
      'tamsin',
      {
        nick: 'tamsin',
        user: '~t',
        host: 'host.example',
        account: 'tam',
        realname: 'Tamsin',
        away: false,
        bot: false,
        prefixes: '@',
      },
    ],
  ]),
});

const networkFixture = (): NetworkState => ({
  ...initialNetworkState('libera', 'Libera.Chat', 'marmot'),
  phase: 'registered',
  support: supportFixture,
  channels: new Map([['#marmotter', channelFixture()]]),
  rawLog: [
    { at: new Date('2026-08-02T09:00:00.000Z'), direction: 'out', line: 'CAP LS 302' },
    { at: new Date('2026-08-02T09:00:01.000Z'), direction: 'in', line: ':srv 001 marmot :Welcome' },
  ],
});

const noop = (): void => {};

describe('every component passes axe', () => {
  it.each([
    ['Button', <Button key="b">Join channel</Button>],
    [
      'Button, busy',
      <Button key="bb" busy>
        Joining
      </Button>,
    ],
    [
      'Button, destructive',
      <Button key="bd" variant="destructive">
        Ban
      </Button>,
    ],
    [
      'IconButton',
      <IconButton key="ib" label="Show member list" icon={<span>M</span>} onClick={noop} />,
    ],
    ['Spinner', <Spinner key="s" label="Loading channels" />],
    [
      'TextField',
      <TextField key="tf" label="Nickname" hint="What other people see." defaultValue="marmot" />,
    ],
    [
      'TextField, invalid',
      <TextField key="tfe" label="Nickname" error="That name is already in use." />,
    ],
    [
      'Select',
      <Select
        key="sel"
        label="Encoding"
        options={[
          { value: 'utf-8', label: 'UTF-8' },
          { value: 'iso-8859-1', label: 'Latin-1' },
        ]}
      />,
    ],
    [
      'Toggle',
      <Toggle
        key="tg"
        label="Only members can send messages"
        hint="People outside the channel are blocked."
        checked
        onChange={noop}
      />,
    ],
    ['Checkbox', <Checkbox key="cb" label="Remember this network" checked onChange={noop} />],
    [
      'Checkbox, mixed',
      <Checkbox
        key="cbm"
        label="Can change the topic"
        checked={false}
        indeterminate
        onChange={noop}
      />,
    ],
    [
      'RadioGroup',
      <RadioGroup
        key="rg"
        legend="Connection security"
        value="tls"
        onChange={noop}
        options={[
          { value: 'tls', label: 'Encrypted', description: 'Nobody in between can read it.' },
          { value: 'off', label: 'Not encrypted', description: 'Anyone in between can read it.' },
        ]}
      />,
    ],
    ['Stepper', <Stepper key="st" label="Member limit" value={50} onChange={noop} />],
    [
      'SearchField',
      <SearchField key="sf" label="Search channels" value="marmot" onValueChange={noop} />,
    ],
    [
      'SegmentedControl',
      <SegmentedControl
        key="sc"
        label="Ban scope"
        value="host"
        onChange={noop}
        segments={[
          { value: 'nick', label: 'This name' },
          { value: 'host', label: 'This address' },
        ]}
      />,
    ],
    ['ListRow', <ListRow key="lr" title="Libera.Chat" subtitle="6 channels" onClick={noop} />],
    [
      'ListGroup',
      <ListGroup key="lg" header="Networks" footer="Networks are stored on this device only.">
        <ListRow title="Libera.Chat" onClick={noop} />
        <ListRow title="OFTC" onClick={noop} />
      </ListGroup>,
    ],
    ['SectionHeader', <SectionHeader key="sh">Channels</SectionHeader>],
    [
      'Badge',
      <Badge key="bg" tone="count" label="3 unread messages">
        3
      </Badge>,
    ],
    ['StatusDot', <StatusDot key="sd" status="connected" />],
    ['Avatar', <Avatar key="av" nick="tamsin" />],
    [
      'EmptyState',
      <EmptyState
        key="es"
        title="You haven't joined any channels yet"
        description="Browse what this network has, or type a name you already know."
        action={<Button variant="primary">Browse channels</Button>}
      />,
    ],
    [
      'Table',
      <Table
        key="tb"
        caption="Bans in #test"
        rowKey={(row: { mask: string }) => row.mask}
        rows={[{ mask: '*!*@example.com' }]}
        columns={[
          {
            id: 'mask',
            header: 'Who',
            mono: true,
            render: (row: { mask: string }) => row.mask,
            compare: (a: { mask: string }, b: { mask: string }) => a.mask.localeCompare(b.mask),
          },
        ]}
        sort={{ columnId: 'mask', direction: 'asc' }}
        onSortChange={noop}
      />,
    ],
    [
      'Tabs',
      <Tabs
        key="tabs"
        label="Channel moderation"
        value="bans"
        onChange={noop}
        tabs={[
          { value: 'bans', label: 'Bans', count: 2 },
          { value: 'mutes', label: 'Mutes', count: 0 },
        ]}
      >
        <p>Nobody is banned.</p>
      </Tabs>,
    ],
    [
      'Toasts',
      <ToastRegion
        key="tr"
        onDismiss={noop}
        toasts={[
          { id: '1', text: 'Joined #marmotter.' },
          { id: '2', text: 'That channel is invite-only.', tone: 'error' },
        ]}
      />,
    ],
    [
      'Tooltip',
      <Tooltip key="tt" content="Copy this line">
        <span>Copy</span>
      </Tooltip>,
    ],
    [
      'NavBar',
      <NavBar key="nb" title="#marmotter" subtitle="42 people" trailing={<Badge>42</Badge>} />,
    ],
    [
      'TabBar',
      <TabBar
        key="tbar"
        value="chats"
        onChange={noop}
        items={[
          { value: 'chats', label: 'Chats', icon: <span>C</span>, badge: 3 },
          { value: 'you', label: 'You', icon: <span>Y</span> },
        ]}
      />,
    ],
    ['Decoder', <Decoder key="dc" token="+mnt" />],
    [
      'Sheet',
      <Sheet key="sheet" open title="Add a network" onClose={noop}>
        <TextField label="Name" />
      </Sheet>,
    ],
    [
      'Modal',
      <Modal
        key="modal"
        open
        title="Ban tamsin?"
        message="They will not be able to rejoin until the ban is removed."
        confirmLabel="Ban"
        destructive
        onConfirm={noop}
        onClose={noop}
      />,
    ],
    [
      'Popover',
      <Popover key="pop" open label="Filters" onClose={noop} trigger={<Button>Filter</Button>}>
        <Checkbox label="Hide empty channels" checked onChange={noop} />
      </Popover>,
    ],
    [
      'ContextMenu',
      <ContextMenu
        key="cm"
        open
        label="Actions for tamsin"
        onClose={noop}
        items={[
          { id: 'msg', label: 'Send a message', onSelect: noop },
          { id: 'ban', label: 'Ban', onSelect: noop, destructive: true, startsGroup: true },
        ]}
      />,
    ],
    [
      'MessageRow',
      <div key="mr">
        {buildRows(channelFixture().messages, { foldEvents: true }).map((row) => (
          <MessageRow
            key={row.id}
            row={row}
            nickWidth={12}
            alignNicksRight
            showTimestamps
            onReply={noop}
            onCopy={noop}
          />
        ))}
      </div>,
    ],
    [
      'MessageList',
      <div key="ml" className="h-64">
        <MessageList
          network={networkFixture()}
          conversation={channelFixture()}
          nickWidth={12}
          alignNicksRight
          showTimestamps
          foldEvents
        />
      </div>,
    ],
    [
      'Composer',
      <Composer
        key="cp"
        value="hello"
        onChange={noop}
        onSend={noop}
        target="#marmotter"
        nicks={['tamsin']}
        channels={['#marmotter']}
        fold={(text: string) => text.toLowerCase()}
        typing={['jonquil']}
      />,
    ],
    ['MemberList', <MemberList key="mem" network={networkFixture()} channel={channelFixture()} />],
    [
      'Sidebar',
      <Sidebar
        key="sb"
        networks={[networkFixture()]}
        selection={{ networkId: 'libera', target: '#marmotter' }}
        onSelect={noop}
        unreadFor={() => ({ count: 3, highlight: false })}
        collapsed={new Set()}
        onToggleCollapsed={noop}
        onReorder={noop}
        onAddNetwork={noop}
        onOpenSettings={noop}
      />,
    ],
    ['RawLog', <RawLog key="rl" network={networkFixture()} onCopy={noop} />],
    [
      'Settings',
      <Settings
        key="set"
        networks={[networkFixture()]}
        appearance={{
          nickColumnWidth: 12,
          alignNicksRight: true,
          foldEvents: true,
          showTimestamps: true,
          unfurlLinks: false,
          highlightWords: [],
          notificationsEnabled: true,
        }}
        onAppearanceChange={noop}
        onReconnect={noop}
        onDisconnect={noop}
        onRemove={noop}
        onAddNetwork={noop}
      />,
    ],
    ['AddNetwork', <AddNetwork key="an" open onClose={noop} onAdd={noop} />],
  ])('%s', async (_name, ui) => {
    await expectNoViolations(ui);
  });
});

describe('keyboard operation', () => {
  it('moves through a segmented control with the arrow keys', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Ban scope"
        value="nick"
        onChange={onChange}
        segments={[
          { value: 'nick', label: 'This name' },
          { value: 'host', label: 'This address' },
        ]}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('host');
  });

  it('wraps around at the end of a segmented control', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Ban scope"
        value="host"
        onChange={onChange}
        segments={[
          { value: 'nick', label: 'This name' },
          { value: 'host', label: 'This address' },
        ]}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('nick');
  });

  it('keeps only the selected segment in the tab order', () => {
    render(
      <SegmentedControl
        label="Ban scope"
        value="host"
        onChange={noop}
        segments={[
          { value: 'nick', label: 'This name' },
          { value: 'host', label: 'This address' },
        ]}
      />,
    );

    expect(screen.getByRole('radio', { name: 'This address' })).toHaveProperty('tabIndex', 0);
    expect(screen.getByRole('radio', { name: 'This name' })).toHaveProperty('tabIndex', -1);
  });

  it('moves through a menu with the arrow keys and picks with Enter', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        open
        label="Actions for tamsin"
        onClose={onClose}
        items={[
          { id: 'msg', label: 'Send a message', onSelect: noop },
          { id: 'ban', label: 'Ban', onSelect, destructive: true },
        ]}
      />,
    );

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('closes a menu with Escape', async () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        open
        label="Actions"
        onClose={onClose}
        items={[{ id: 'a', label: 'Something', onSelect: noop }]}
      />,
    );

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('steps a stepper with the arrow keys', async () => {
    const onChange = vi.fn();
    render(<Stepper label="Member limit" value={10} onChange={onChange} />);

    screen.getByRole('spinbutton').focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenCalledWith(11);
  });

  it('does not step a stepper past its bounds', async () => {
    const onChange = vi.fn();
    render(<Stepper label="Member limit" value={0} min={0} max={5} onChange={onChange} />);

    screen.getByRole('spinbutton').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('overlays and focus', () => {
  it('moves focus into a sheet when it opens', () => {
    render(
      <Sheet open title="Add a network" onClose={noop}>
        <TextField label="Name" />
      </Sheet>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes a sheet on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Sheet open title="Add a network" onClose={onClose}>
        <TextField label="Name" />
      </Sheet>,
    );

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps Tab inside a sheet', async () => {
    render(
      <>
        <button type="button">Outside</button>
        <Sheet open title="Add a network" onClose={noop}>
          <TextField label="Name" />
        </Sheet>
      </>,
    );

    const dialog = screen.getByRole('dialog');
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('names a modal’s confirm button after the action, never "OK"', () => {
    render(
      <Modal
        open
        title="Ban tamsin?"
        message="They will not be able to rejoin."
        confirmLabel="Ban"
        onConfirm={noop}
        onClose={noop}
      />,
    );

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Ban' })).toBeDefined();
  });
});

describe('the decoder', () => {
  it('opens on focus, so it is reachable without a pointer', async () => {
    render(<Decoder token="+mnt" />);

    await userEvent.tab();
    expect(screen.getByRole('tooltip')).toBeDefined();
  });

  it('reads out the meaning rather than the mode letters', () => {
    render(<Decoder token="+mnt" />);

    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-label')).toContain('can send messages');
  });

  it('shows nothing for a token it cannot explain', async () => {
    render(<Decoder token="wibble" />);

    await userEvent.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes on Escape', async () => {
    render(<Decoder token="473" />);

    await userEvent.tab();
    expect(screen.getByRole('tooltip')).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('names that are not decoration', () => {
  it('gives an icon-only button a name', () => {
    render(<IconButton label="Show member list" icon={<span>M</span>} onClick={noop} />);
    expect(screen.getByRole('button', { name: 'Show member list' })).toBeDefined();
  });

  it('says what a connection dot means, rather than only colouring it', () => {
    render(<StatusDot status="failed" />);
    expect(screen.getByText('Connection failed')).toBeDefined();
  });

  it('announces an unread count as a sentence', () => {
    render(
      <Badge tone="count" label="3 unread messages">
        3
      </Badge>,
    );
    expect(screen.getByLabelText('3 unread messages')).toBeDefined();
  });

  it('announces a switch as on or off', () => {
    render(<Toggle label="Only members can send messages" checked onChange={noop} />);
    const control = screen.getByRole('switch', { name: /Only members/ });
    expect(control.getAttribute('aria-checked')).toBe('true');
  });

  it('announces a partly-granted permission as mixed, not as off', () => {
    render(<Checkbox label="Can change the topic" checked={false} indeterminate onChange={noop} />);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('mixed');
  });
});
