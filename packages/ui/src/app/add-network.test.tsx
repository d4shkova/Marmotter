import type { NetworkProfile } from '@marmotter/shared';
import { defaultLoggingPolicy } from '@marmotter/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddNetwork } from './AddNetwork.js';

afterEach(cleanup);

const pinnedProfile = (): NetworkProfile => ({
  id: 'n1',
  name: 'Home',
  servers: [{ host: 'irc.home.example', port: 6697, tls: { mode: 'tls', verifyCert: false } }],
  identity: {
    nick: 'marmot',
    altNicks: ['marmot_', 'marmot__'],
    username: 'marmot',
    realname: 'marmot',
  },
  autojoin: [],
  connectCommands: [],
  encoding: 'utf-8',
  autoReconnect: true,
  logging: defaultLoggingPolicy,
});

describe('AddNetwork security', () => {
  it('saves a new encrypted network with certificate checking on', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AddNetwork open onClose={() => {}} onAdd={onAdd} newId={() => 'id-1'} />);

    await user.selectOptions(screen.getByLabelText('Which network?'), 'custom');
    await user.type(screen.getByLabelText('Server address'), 'irc.example.net');
    await user.type(screen.getByLabelText('Your name on this network'), 'marmot');
    await user.click(screen.getByRole('button', { name: 'Add network' }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const profile = onAdd.mock.calls[0]?.[0] as NetworkProfile;
    expect(profile.servers[0]?.tls).toEqual({ mode: 'tls', verifyCert: true });
  });

  it('offers a single Encrypted option, not two certificate choices', () => {
    render(<AddNetwork open onClose={() => {}} onAdd={() => {}} />);
    expect(screen.getByRole('radio', { name: /Encrypted/ })).toBeDefined();
    expect(screen.queryByText('Encrypted, certificate checked')).toBeNull();
    expect(screen.queryByText('Encrypted, certificate not checked')).toBeNull();
  });

  it('keeps an accepted unverified certificate when the network is edited', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AddNetwork open editing={pinnedProfile()} onClose={() => {}} onAdd={onAdd} />);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const profile = onAdd.mock.calls[0]?.[0] as NetworkProfile;
    // Editing the address must not quietly turn checking back on and break a
    // connection the user had already chosen to trust.
    expect(profile.servers[0]?.tls).toEqual({ mode: 'tls', verifyCert: false });
  });
});
