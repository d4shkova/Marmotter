import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ListGroup, SectionHeader } from '../layout/ListGroup.js';
import { Avatar } from './Avatar.js';
import { Badge, StatusDot } from './Badge.js';
import { Button } from './Button.js';
import { EmptyState } from './EmptyState.js';
import { ListRow } from './ListRow.js';
import { SwipeRow } from './SwipeRow.js';
import { Table } from './Table.js';
import { Tabs } from './Tabs.js';
import { ToastRegion } from './Toast.js';
import { Toggle } from './Toggle.js';
import { Tooltip } from './Tooltip.js';

export default {
  title: 'Primitives/Display',
} satisfies Meta;

export const Badges: StoryObj = {
  render: () => (
    <div className="flex items-center gap-3">
      <Badge>Bot</Badge>
      <Badge tone="accent">Registered</Badge>
      <Badge tone="alert">Banned</Badge>
      <Badge tone="count" label="12 unread messages">
        12
      </Badge>
      <Badge tone="count" label="More than 99 unread messages">
        99+
      </Badge>
    </div>
  ),
};

export const ConnectionStatus: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-2">
      {(['connected', 'connecting', 'failed', 'offline'] as const).map((status) => (
        <span key={status} className="flex items-center gap-2 text-subhead">
          <StatusDot status={status} />
          {status}
        </span>
      ))}
    </div>
  ),
};

export const Avatars: StoryObj = {
  render: () => (
    <div className="flex items-center gap-3">
      {['tamsin', 'jonquil', 'bramble', 'corvid', 'emilyp', '[dunlin]'].map((nick) => (
        <span key={nick} className="flex flex-col items-center gap-1">
          <Avatar nick={nick} size="large" />
          <span className="text-caption-2 text-[var(--label-tertiary)]">{nick}</span>
        </span>
      ))}
      <Avatar nick="tamsin" away />
    </div>
  ),
};

export const GroupedList: StoryObj = {
  render: function GroupedList() {
    const [logging, setLogging] = useState(false);

    return (
      <div className="flex w-96 flex-col gap-6">
        <ListGroup
          header="Networks"
          footer="Networks are stored on this device and never sent anywhere."
        >
          <ListRow
            title="Libera.Chat"
            subtitle="6 channels"
            leading={<StatusDot status="connected" />}
            onClick={() => {}}
          />
          <ListRow
            title="OFTC"
            subtitle="2 channels"
            leading={<StatusDot status="connecting" />}
            onClick={() => {}}
          />
          <ListRow
            title="dashkova.co.uk"
            subtitle="Could not reach the server"
            leading={<StatusDot status="failed" />}
            onClick={() => {}}
          />
        </ListGroup>

        <ListGroup header="Logging" footer="Logs stay on this device. Nothing is uploaded.">
          <ListRow
            title="Keep a log of conversations"
            trailing={
              <Toggle
                label="Keep a log of conversations"
                labelHidden
                checked={logging}
                onChange={setLogging}
              />
            }
          />
          <ListRow title="Where logs are kept" trailing="App data folder" onClick={() => {}} />
          <ListRow title="Delete all logs" destructive onClick={() => {}} />
        </ListGroup>
      </div>
    );
  },
};

export const Headers: StoryObj = {
  render: () => (
    <div className="w-96">
      <SectionHeader
        action={
          <Button variant="plain" size="small">
            Edit
          </Button>
        }
      >
        Channels
      </SectionHeader>
    </div>
  ),
};

export const Empty: StoryObj = {
  render: () => (
    <div className="w-96">
      <EmptyState
        title="You haven't joined any channels yet"
        description="Browse what this network has, or type a name you already know."
        action={<Button variant="primary">Browse channels</Button>}
      />
    </div>
  ),
};

export const EmptyWithNoHistory: StoryObj = {
  render: () => (
    <div className="w-96">
      <EmptyState
        title="No earlier messages"
        description="This network doesn't keep history, so the conversation starts here."
      />
    </div>
  ),
};

interface Ban {
  readonly mask: string;
  readonly setBy: string;
  readonly when: string;
}

const bans: Ban[] = [
  { mask: '*!*@203.0.113.0/24', setBy: 'jonquil', when: '2 days ago' },
  { mask: 'spammer!*@*', setBy: 'tamsin', when: 'last week' },
  { mask: '*!~bot@bots.example', setBy: 'bramble', when: 'in March' },
];

export const Tables: StoryObj = {
  render: function Tables() {
    const [sort, setSort] = useState<{ columnId: string; direction: 'asc' | 'desc' }>({
      columnId: 'mask',
      direction: 'asc',
    });

    return (
      <div className="w-[32rem]">
        <Table
          caption="Bans in #marmotter"
          rows={bans}
          rowKey={(ban) => ban.mask}
          sort={sort}
          onSortChange={(columnId) =>
            setSort((current) => ({
              columnId,
              direction:
                current.columnId === columnId && current.direction === 'asc' ? 'desc' : 'asc',
            }))
          }
          columns={[
            {
              id: 'mask',
              header: 'Who',
              mono: true,
              render: (ban) => ban.mask,
              compare: (a, b) => a.mask.localeCompare(b.mask),
            },
            {
              id: 'setBy',
              header: 'Added by',
              render: (ban) => ban.setBy,
              compare: (a, b) => a.setBy.localeCompare(b.setBy),
            },
            { id: 'when', header: 'When', render: (ban) => ban.when, align: 'end' },
          ]}
        />
      </div>
    );
  },
};

export const TabbedPanel: StoryObj = {
  render: function TabbedPanel() {
    const [tab, setTab] = useState('bans');

    return (
      <div className="w-[32rem]">
        <Tabs
          label="Channel moderation"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'bans', label: 'Bans', count: 3 },
            { value: 'mutes', label: 'Mutes', count: 0 },
            { value: 'invites', label: 'Invite exceptions', count: 1 },
            { value: 'exceptions', label: 'Ban exceptions', count: 0 },
          ]}
        >
          <div className="pt-4 text-subhead text-[var(--label-secondary)]">
            {tab === 'bans' ? `${bans.length} entries.` : 'Nothing here yet.'}
          </div>
        </Tabs>
      </div>
    );
  },
};

export const Toasts: StoryObj = {
  render: () => (
    <div className="relative h-40 w-96">
      <ToastRegion
        onDismiss={() => {}}
        toasts={[
          { id: '1', text: 'Joined #marmotter.' },
          {
            id: '2',
            text: '#private is invite-only.',
            tone: 'error',
            action: { label: 'Request an invite', onSelect: () => {} },
          },
        ]}
      />
    </div>
  ),
};

export const Tooltips: StoryObj = {
  render: () => (
    <Tooltip content="Copy this line" delayMs={0}>
      <Button variant="secondary">Hover or focus me</Button>
    </Tooltip>
  ),
};

export const SwipeableRows: StoryObj = {
  name: 'Swipe actions',
  parameters: {
    docs: {
      description: {
        story:
          'Drag a row aside with a finger or a pen to reach the two things people do to a ' +
          'conversation repeatedly. A mouse gets nothing here and opens the same actions by ' +
          'right-clicking instead. Leaving needs most of the row, so brushing the list while ' +
          'scrolling cannot drop you out of a channel.',
      },
    },
  },
  render: () => (
    <div className="w-72 overflow-hidden rounded-card bg-[var(--bg-elevated)]">
      <SwipeRow
        leading={{ label: 'Mark as read', onAction: () => {} }}
        trailing={{ label: 'Leave channel', onAction: () => {}, destructive: true }}
      >
        <ListRow title="#marmotter" subtitle="12 unread" />
      </SwipeRow>
      <SwipeRow trailing={{ label: 'Close conversation', onAction: () => {}, destructive: true }}>
        <ListRow title="dashkova" subtitle="Person" />
      </SwipeRow>
    </div>
  ),
};
