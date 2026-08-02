import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from './Button.js';
import { Checkbox } from './Checkbox.js';
import { ContextMenu } from './ContextMenu.js';
import { Modal } from './Modal.js';
import { Popover } from './Popover.js';
import { Sheet } from './Sheet.js';
import { TextField } from './TextField.js';

export default {
  title: 'Primitives/Overlays',
} satisfies Meta;

export const SheetCentred: StoryObj = {
  render: function SheetCentred() {
    const [open, setOpen] = useState(true);

    return (
      <>
        <Button onClick={() => setOpen(true)}>Add a network</Button>
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title="Add a network"
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Add network
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4 pt-2">
            <TextField label="Name" placeholder="Libera.Chat" />
            <TextField label="Server address" placeholder="irc.libera.chat" />
            <TextField label="Nickname" placeholder="marmot" />
          </div>
        </Sheet>
      </>
    );
  },
};

export const SheetFromTheBottom: StoryObj = {
  render: function SheetFromTheBottom() {
    const [open, setOpen] = useState(true);

    return (
      <>
        <Button onClick={() => setOpen(true)}>Show members</Button>
        <Sheet bottom open={open} onClose={() => setOpen(false)} title="Members of #marmotter">
          <ul className="flex flex-col gap-2 pt-2 text-body">
            {['jonquil', 'tamsin', 'bramble', 'corvid'].map((nick) => (
              <li key={nick}>{nick}</li>
            ))}
          </ul>
        </Sheet>
      </>
    );
  },
};

export const ConfirmingSomethingDestructive: StoryObj = {
  render: function ConfirmingSomethingDestructive() {
    const [open, setOpen] = useState(true);

    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Ban
        </Button>
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="Ban tamsin from #marmotter?"
          message="They won't be able to rejoin until somebody removes the ban."
          confirmLabel="Ban"
          destructive
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  },
};

export const Popovers: StoryObj = {
  render: function Popovers() {
    const [open, setOpen] = useState(true);
    const [hideEmpty, setHideEmpty] = useState(true);

    return (
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label="Channel list filters"
        trigger={<Button onClick={() => setOpen((current) => !current)}>Filter</Button>}
      >
        <div className="flex flex-col gap-3">
          <Checkbox label="Hide empty channels" checked={hideEmpty} onChange={setHideEmpty} />
          <Checkbox label="Hide channels with no topic" checked={false} onChange={() => {}} />
        </div>
      </Popover>
    );
  },
};

export const MemberActions: StoryObj = {
  render: () => (
    <ContextMenu
      open
      label="Actions for tamsin"
      onClose={() => {}}
      items={[
        { id: 'message', label: 'Send a message', onSelect: () => {} },
        { id: 'profile', label: 'View profile', onSelect: () => {} },
        { id: 'invite', label: 'Invite to a channel', onSelect: () => {} },
        { id: 'op', label: 'Make an operator', onSelect: () => {}, startsGroup: true },
        { id: 'voice', label: 'Give voice', onSelect: () => {} },
        { id: 'mute', label: 'Mute', onSelect: () => {}, startsGroup: true },
        { id: 'remove', label: 'Remove from channel', onSelect: () => {}, destructive: true },
        { id: 'ban', label: 'Remove and ban', onSelect: () => {}, destructive: true },
        { id: 'ignore', label: 'Ignore', onSelect: () => {}, disabled: true },
      ]}
    />
  ),
};
