import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { Badge, StatusDot } from '../primitives/Badge.js';
import { IconButton } from '../primitives/IconButton.js';
import { ListRow } from '../primitives/ListRow.js';
import { ListGroup } from './ListGroup.js';
import { NavBar } from './NavBar.js';
import { TabBar } from './TabBar.js';
import { TitleBar } from './TitleBar.js';

export default {
  title: 'Layout',
} satisfies Meta;

const Glyph = ({ children }: { children: string }) => (
  <span className="text-callout font-semibold">{children}</span>
);

export const TitleBarWindowControls: StoryObj = {
  render: () => (
    <div className="w-96 overflow-hidden rounded-card border border-[var(--separator)]">
      <TitleBar title="Marmotter" controls="custom" maximized={false} />
      <div className="p-4 text-subhead text-[var(--label-secondary)]">
        Windows and Linux, where the app draws the window buttons itself.
      </div>
    </div>
  ),
};

export const TitleBarTrafficLightInset: StoryObj = {
  render: () => (
    <div className="w-96 overflow-hidden rounded-card border border-[var(--separator)]">
      <TitleBar title="Marmotter" controls="native-inset" />
      <div className="p-4 text-subhead text-[var(--label-secondary)]">
        macOS keeps its own buttons, so the bar leaves room for them.
      </div>
    </div>
  ),
};

export const NavBarCompact: StoryObj = {
  render: () => (
    <div className="w-96 overflow-hidden rounded-card border border-[var(--separator)]">
      <NavBar
        title="#marmotter"
        subtitle="42 people · Building a nicer IRC client"
        leading={<IconButton label="Back to channels" icon={<Glyph>‹</Glyph>} />}
        trailing={<IconButton label="Show member list" icon={<Glyph>≡</Glyph>} />}
      />
      <div className="p-4 text-subhead text-[var(--label-secondary)]">Messages go here.</div>
    </div>
  ),
};

export const NavBarLargeTitleCollapsing: StoryObj = {
  render: function NavBarLargeTitleCollapsing() {
    const scroller = useRef<HTMLDivElement>(null);

    return (
      <div className="w-96 overflow-hidden rounded-card border border-[var(--separator)]">
        <NavBar title="Settings" largeTitle scrollRef={scroller} />
        <div ref={scroller} className="h-64 overflow-y-auto p-4">
          <div className="flex flex-col gap-2 text-subhead text-[var(--label-secondary)]">
            {Array.from({ length: 20 }, (_, index) => (
              <p key={index}>Scroll to watch the large title give way.</p>
            ))}
          </div>
        </div>
      </div>
    );
  },
};

export const BottomTabBar: StoryObj = {
  render: function BottomTabBar() {
    const [section, setSection] = useState('chats');

    return (
      <div className="flex h-64 w-80 flex-col overflow-hidden rounded-card border border-[var(--separator)]">
        <div className="flex-1 p-4 text-subhead text-[var(--label-secondary)]">
          Showing: {section}
        </div>
        <TabBar
          value={section}
          onChange={setSection}
          items={[
            { value: 'chats', label: 'Chats', icon: <Glyph>◍</Glyph>, badge: 12 },
            { value: 'friends', label: 'Friends', icon: <Glyph>◎</Glyph> },
            {
              value: 'mentions',
              label: 'Mentions',
              icon: <Glyph>◐</Glyph>,
              badge: 2,
              highlighted: true,
            },
            { value: 'you', label: 'You', icon: <Glyph>◒</Glyph> },
          ]}
        />
      </div>
    );
  },
};

export const SidebarShape: StoryObj = {
  render: () => (
    <div className="w-72">
      <ListGroup header="Libera.Chat">
        <ListRow
          title="#marmotter"
          leading={<StatusDot status="connected" />}
          trailing={
            <Badge tone="count" label="4 unread messages">
              4
            </Badge>
          }
          selected
          onClick={() => {}}
        />
        <ListRow title="#ircv3" onClick={() => {}} />
        <ListRow
          title="tamsin"
          trailing={
            <Badge tone="alert" label="1 message mentioning you">
              1
            </Badge>
          }
          onClick={() => {}}
        />
      </ListGroup>
    </div>
  ),
};
