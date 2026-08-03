import type { Meta, StoryObj } from '@storybook/react-vite';
import { Decoder } from './Decoder.js';

/**
 * The signature element.
 *
 * These stories are written as the lines they will actually appear inside,
 * because the decoder's job is to sit in the flow of a sentence without
 * shouting — the boldness is in the panel, not the trigger.
 */
export default {
  title: 'Decoder',
  component: Decoder,
} satisfies Meta<typeof Decoder>;

type Story = StoryObj<typeof Decoder>;

export const TheWorkedExample: Story = {
  args: { token: '+mnt' },
  render: (args) => (
    <p className="max-w-md text-body">
      jonquil set the channel to <Decoder {...args} />.
    </p>
  ),
};

export const OneModeAtATime: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-body">
      {['+i', '+k', '+l', '+b', '+q', '+e', '+I'].map((token) => (
        <span key={token}>
          <Decoder token={token} />
        </span>
      ))}
    </div>
  ),
};

export const RemovingAMode: Story = {
  args: { token: '-m' },
  render: (args) => (
    <p className="max-w-md text-body">
      tamsin changed the channel: <Decoder {...args} />.
    </p>
  ),
};

export const AMixedChange: Story = {
  args: { token: '+m-t' },
  render: (args) => (
    <p className="max-w-md text-body">
      The channel is now <Decoder {...args} />.
    </p>
  ),
};

export const RolesOnANetworkThatAdvertisesThem: Story = {
  render: () => (
    <p className="max-w-md text-body">
      jonquil is now <Decoder token="+o" context={{ roleModes: 'qaohv' }} /> here.
    </p>
  ),
};

export const TheSameLetterMeaningTwoThings: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-3 text-body">
      <p>
        On a network where the mode grants ownership:{' '}
        <Decoder token="+q" context={{ roleModes: 'qaohv' }} />
      </p>
      <p>
        On a network where it holds a mute list:{' '}
        <Decoder token="+q" context={{ listModes: 'beIq' }} />
      </p>
    </div>
  ),
};

export const AnError: Story = {
  args: { token: '473' },
  render: (args) => (
    <p className="max-w-md text-body">
      #private is invite-only. <Decoder {...args}>Why?</Decoder>
    </p>
  ),
};

export const UserModes: Story = {
  render: () => (
    <p className="max-w-md text-body">
      You are connected as <Decoder token="+ix" />.
    </p>
  ),
};

export const AServicesConcept: Story = {
  render: () => (
    <p className="max-w-md text-body">
      This network supports <Decoder token="SASL">logging in while connecting</Decoder> and{' '}
      <Decoder token="CertFP">certificate login</Decoder>.
    </p>
  ),
};

export const ACtcpRequest: Story = {
  render: () => (
    <p className="max-w-md text-body">
      tamsin sent a <Decoder token="VERSION">version request</Decoder>.
    </p>
  ),
};

export const NothingToSay: Story = {
  args: { token: 'wibble' },
  render: (args) => (
    <p className="max-w-md text-body">
      An unrecognised token stays inert rather than opening an empty panel: <Decoder {...args} />.
    </p>
  ),
};
