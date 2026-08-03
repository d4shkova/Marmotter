import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from './Button.js';
import { Checkbox } from './Checkbox.js';
import { Field } from './Field.js';
import { IconButton } from './IconButton.js';
import { RadioGroup } from './Radio.js';
import { SearchField } from './SearchField.js';
import { SegmentedControl } from './SegmentedControl.js';
import { Select } from './Select.js';
import { Spinner } from './Spinner.js';
import { Stepper } from './Stepper.js';
import { TextField } from './TextField.js';
import { Toggle } from './Toggle.js';

/**
 * Stories are written with the copy the product actually uses, not with
 * "Lorem ipsum" or "Button 1". Placeholder copy hides the two things these
 * stories exist to show: whether a real label fits, and whether it reads the
 * way CLAUDE.md's interface-copy rules require.
 */

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3">{children}</div>
);

const Stack = ({ children }: { children: React.ReactNode }) => (
  <div className="flex w-80 flex-col gap-4">{children}</div>
);

const MenuIcon = () => (
  <svg viewBox="0 0 16 16" className="size-4 fill-none stroke-current stroke-2">
    <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round" />
  </svg>
);

export default {
  title: 'Primitives/Controls',
} satisfies Meta;

export const Buttons: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Row>
        <Button variant="primary">Join channel</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="plain">Browse channels</Button>
        <Button variant="destructive">Ban</Button>
      </Row>
      <Row>
        <Button size="small">Small</Button>
        <Button size="medium">Medium</Button>
        <Button size="large">Large</Button>
      </Row>
      <Row>
        <Button busy>Connecting</Button>
        <Button disabled>Join channel</Button>
      </Row>
      <div className="w-72">
        <Button variant="primary" full>
          Add this network
        </Button>
      </div>
    </div>
  ),
};

export const IconButtons: StoryObj = {
  render: () => (
    <Row>
      <IconButton label="Show member list" icon={<MenuIcon />} size="small" />
      <IconButton label="Show member list" icon={<MenuIcon />} />
      <IconButton label="Show member list" icon={<MenuIcon />} size="large" />
      <IconButton label="Show member list" icon={<MenuIcon />} pressed />
      <IconButton label="Remove this ban" icon={<MenuIcon />} destructive />
      <IconButton label="Show member list" icon={<MenuIcon />} disabled />
    </Row>
  ),
};

export const Spinners: StoryObj = {
  render: () => (
    <Row>
      <Spinner size="small" label="Loading channels" />
      <Spinner label="Loading channels" />
      <Spinner size="large" label="Loading channels" />
    </Row>
  ),
};

export const TextFields: StoryObj = {
  render: () => (
    <Stack>
      <TextField label="Nickname" defaultValue="marmot" hint="What other people see." />
      <TextField label="Server address" placeholder="irc.example.net" />
      <TextField
        label="Nickname"
        defaultValue="marmot"
        error="That name is already in use on this network."
      />
      <TextField label="Password" type="password" defaultValue="hunter2" />
      <TextField label="Nickname" defaultValue="marmot" disabled />
    </Stack>
  ),
};

export const FieldShell: StoryObj = {
  render: () => (
    <Stack>
      {/* The label, hint and error shell every control shares. Shown on its own
          because a caller with a control of its own reaches for it directly. */}
      <Field id="shell-hint" label="Real name" hint="Shown on your profile.">
        <input id="shell-hint" className="rounded-control bg-[var(--fill-tertiary)] px-3 py-2" />
      </Field>
      <Field id="shell-error" label="Real name" error="That is longer than this network allows.">
        <input id="shell-error" className="rounded-control bg-[var(--fill-tertiary)] px-3 py-2" />
      </Field>
    </Stack>
  ),
};

export const Selects: StoryObj = {
  render: () => (
    <Stack>
      <Select
        label="Encoding"
        defaultValue="utf-8"
        hint="Only change this for a network that predates UTF-8."
        options={[
          { value: 'utf-8', label: 'UTF-8' },
          { value: 'iso-8859-1', label: 'Latin-1' },
          { value: 'windows-1251', label: 'Cyrillic' },
        ]}
      />
    </Stack>
  ),
};

export const Toggles: StoryObj = {
  render: function Toggles() {
    const [moderated, setModerated] = useState(true);
    const [outside, setOutside] = useState(false);

    return (
      <Stack>
        <Toggle
          label="Only voiced people can send messages"
          checked={moderated}
          onChange={setModerated}
        />
        <Toggle
          label="Allow messages from outside the channel"
          hint="People who have not joined can still send to it."
          checked={outside}
          onChange={setOutside}
        />
        <Toggle label="Keep a log on this device" checked={false} onChange={() => {}} disabled />
      </Stack>
    );
  },
};

export const Checkboxes: StoryObj = {
  render: function Checkboxes() {
    const [checked, setChecked] = useState(true);

    return (
      <Stack>
        <Checkbox label="Reconnect automatically" checked={checked} onChange={setChecked} />
        <Checkbox label="Can change the topic" checked={false} indeterminate onChange={() => {}} />
        <Checkbox label="Can remove people" checked={false} onChange={() => {}} />
        <Checkbox label="Can manage bans" checked disabled onChange={() => {}} />
      </Stack>
    );
  },
};

export const Radios: StoryObj = {
  render: function Radios() {
    const [value, setValue] = useState('verified');

    return (
      <Stack>
        <RadioGroup
          legend="Connection security"
          value={value}
          onChange={setValue}
          options={[
            {
              value: 'verified',
              label: 'Encrypted, certificate checked',
              description: 'Recommended. Nobody in between can read or change your messages.',
            },
            {
              value: 'pinned',
              label: 'Encrypted, certificate pinned',
              description:
                'For a server using its own certificate. You confirm the certificate once.',
            },
            {
              value: 'off',
              label: 'Not encrypted',
              description:
                'Anyone between you and the server can read everything you send, including your password.',
            },
          ]}
        />
      </Stack>
    );
  },
};

export const Steppers: StoryObj = {
  render: function Steppers() {
    const [limit, setLimit] = useState(0);

    return (
      <Stack>
        <Stepper
          label="Member limit"
          value={limit}
          onChange={setLimit}
          min={0}
          max={999}
          format={(value) => (value === 0 ? 'No limit' : String(value))}
        />
      </Stack>
    );
  },
};

export const Searching: StoryObj = {
  render: function Searching() {
    const [query, setQuery] = useState('');

    return (
      <Stack>
        <SearchField label="Search channels" value={query} onValueChange={setQuery} />
        <SearchField label="Search channels" value="marmot" onValueChange={() => {}} />
      </Stack>
    );
  },
};

export const Segments: StoryObj = {
  render: function Segments() {
    const [scope, setScope] = useState('address');

    return (
      <div className="flex flex-col gap-4">
        <SegmentedControl
          label="Ban scope"
          value={scope}
          onChange={setScope}
          segments={[
            { value: 'name', label: 'This name' },
            { value: 'address', label: 'This address' },
            { value: 'account', label: 'This account' },
          ]}
        />
        <div className="w-80">
          <SegmentedControl
            label="Ban scope"
            full
            value={scope}
            onChange={setScope}
            segments={[
              { value: 'name', label: 'This name' },
              { value: 'address', label: 'This address' },
            ]}
          />
        </div>
      </div>
    );
  },
};
