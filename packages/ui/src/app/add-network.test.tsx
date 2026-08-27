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

describe('AddNetwork autojoin', () => {
  it('saves the channels typed on the line', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<AddNetwork open onClose={() => {}} onAdd={onAdd} newId={() => 'id-1'} />);

    await user.selectOptions(screen.getByLabelText('Which network?'), 'custom');
    await user.type(screen.getByLabelText('Server address'), 'irc.example.net');
    await user.type(screen.getByLabelText('Your name on this network'), 'marmot');
    await user.type(screen.getByLabelText('Channels to join automatically'), '#marmotter, #irc');
    await user.click(screen.getByRole('button', { name: 'Add network' }));

    const profile = onAdd.mock.calls[0]?.[0] as NetworkProfile;
    expect(profile.autojoin).toEqual([{ target: '#marmotter' }, { target: '#irc' }]);
  });

  it('shows what an edited network already joins, and keeps it untouched', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    const profile = { ...pinnedProfile(), autojoin: [{ target: '#one' }, { target: '#two' }] };
    render(<AddNetwork open editing={profile} onClose={() => {}} onAdd={onAdd} />);

    const field = screen.getByLabelText('Channels to join automatically');
    expect((field as HTMLInputElement).value).toBe('#one, #two');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((onAdd.mock.calls[0]?.[0] as NetworkProfile).autojoin).toEqual(profile.autojoin);
  });

  it('keeps a channel’s saved key when the line is edited', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    const key = { kind: 'secret-ref', id: 'k1' } as const;
    const profile = { ...pinnedProfile(), autojoin: [{ target: '#private', key }] };
    render(<AddNetwork open editing={profile} onClose={() => {}} onAdd={onAdd} />);

    // Adding a second channel must not cost the first one its password.
    await user.type(screen.getByLabelText('Channels to join automatically'), ' #open');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((onAdd.mock.calls[0]?.[0] as NetworkProfile).autojoin).toEqual([
      { target: '#private', key },
      { target: '#open' },
    ]);
  });
});

describe('AddNetwork errors', () => {
  it('prints a complaint under the field it is about', async () => {
    const user = userEvent.setup();
    render(<AddNetwork open onClose={() => {}} onAdd={() => {}} />);

    await user.selectOptions(screen.getByLabelText('Which network?'), 'custom');
    await user.click(screen.getByRole('button', { name: 'Add network' }));

    // Named by the field rather than left at the foot of a form long enough to
    // have scrolled it out of sight.
    const address = screen.getByLabelText('Server address');
    expect(address.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('address of the server');
  });
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
    expect(screen.getByRole('radio', { name: 'Encrypted' })).toBeDefined();
    expect(screen.queryByText('Encrypted, certificate checked')).toBeNull();
    expect(screen.queryByText('Encrypted, certificate not checked')).toBeNull();
  });

  it('states the consequence of the security choice in force', async () => {
    const user = userEvent.setup();
    render(<AddNetwork open onClose={() => {}} onAdd={() => {}} />);

    // CLAUDE.md requires the security implication in plain language. Condensing
    // three descriptions to one must not drop it for the chosen option.
    await user.click(screen.getByRole('radio', { name: 'Not encrypted' }));
    expect(screen.getByText(/can read everything you send/)).toBeDefined();
  });

  it('leaves out the web-address option where there is nowhere to type one', () => {
    render(<AddNetwork open onClose={() => {}} onAdd={() => {}} />);
    // A network picked from the directory has a host and a port, not a URL.
    expect(screen.queryByRole('radio', { name: 'A web address' })).toBeNull();
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
