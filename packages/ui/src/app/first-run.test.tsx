import { EMPTY_IDENTITY } from '@marmotter/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstRun } from './FirstRun.js';

afterEach(cleanup);

/** Exact label match: "Name" and "Full name (optional)" both contain "Name". */
const field = (name: string): HTMLInputElement =>
  screen.getByRole('textbox', { name }) as HTMLInputElement;

const type = (name: string, value: string): void => {
  fireEvent.change(field(name), { target: { value } });
};

describe('setting up a name', () => {
  it('fills in the two fallbacks as the name is typed', () => {
    // The client used to generate exactly these on its own. Somebody who does
    // not care about fallbacks should not have to think about them.
    render(<FirstRun open onDone={vi.fn()} onSkip={vi.fn()} />);

    type('Name', 'tamsin');

    expect(field('If that is taken').value).toBe('tamsin_');
    expect(field('And if that is taken too').value).toBe('tamsin__');
  });

  it('stops suggesting once somebody has chosen their own fallback', () => {
    // Editing the first name must not overwrite a second choice they typed.
    render(<FirstRun open onDone={vi.fn()} onSkip={vi.fn()} />);

    type('Name', 'tamsin');
    type('If that is taken', 'tamsin|away');
    type('Name', 'jonquil');

    expect(field('If that is taken').value).toBe('tamsin|away');
    expect(field('And if that is taken too').value).toBe('tamsin__');
  });

  it('hands back everything that was filled in', () => {
    const onDone = vi.fn();
    render(<FirstRun open onDone={onDone} onSkip={vi.fn()} />);

    type('Name', 'tamsin');
    type('Full name (optional)', 'Tamsin');
    type('Email (optional)', 'tamsin@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onDone).toHaveBeenCalledWith({
      nick: 'tamsin',
      altNick: 'tamsin_',
      thirdNick: 'tamsin__',
      realname: 'Tamsin',
      email: 'tamsin@example.com',
    });
  });

  it('is happy with only a name, since the rest is optional', () => {
    const onDone = vi.fn();
    render(<FirstRun open onDone={onDone} onSkip={vi.fn()} />);

    type('Name', 'tamsin');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0]).toMatchObject({ realname: '', email: '' });
  });

  it('says what is wrong with a name rather than refusing silently', () => {
    const onDone = vi.fn();
    render(<FirstRun open onDone={onDone} onSkip={vi.fn()} />);

    type('Name', '1tamsin');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onDone).not.toHaveBeenCalled();
    // All three: the fallbacks were filled in from the name, so they inherit
    // whatever is wrong with it, and each says so against its own field.
    expect(screen.getAllByText('A name cannot start with a number or a hyphen.')).toHaveLength(3);
  });

  it('says nothing is wrong before anything has been tried', () => {
    // An error on a field nobody has finished typing into is a scolding.
    render(<FirstRun open onDone={vi.fn()} onSkip={vi.fn()} />);

    type('Name', '1tam');
    expect(screen.queryByText(/cannot start with a number/)).toBeNull();
  });

  it('can be skipped, because the network form still takes a name', () => {
    const onSkip = vi.fn();
    const onDone = vi.fn();
    render(<FirstRun open onDone={onDone} onSkip={onSkip} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('reopens on what was saved, for changing it later', () => {
    render(
      <FirstRun
        open
        initial={{
          ...EMPTY_IDENTITY,
          nick: 'tamsin',
          altNick: 'tamsin|away',
          realname: 'Tamsin',
        }}
        confirmLabel="Save"
        onDone={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(field('Name').value).toBe('tamsin');
    expect(field('If that is taken').value).toBe('tamsin|away');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('says who can see the real name, because "full name" implies otherwise', () => {
    // WHOIS hands this to any stranger who asks. A setup screen that does not
    // say so is inviting somebody to put their actual name in it.
    render(<FirstRun open onDone={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText(/Anyone on a network can look this up/)).toBeDefined();
  });

  it('never asks for a password, and says it never will', () => {
    render(<FirstRun open onDone={vi.fn()} onSkip={vi.fn()} />);

    expect(screen.queryAllByDisplayValue('')).not.toHaveLength(0);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText(/never asks for a password here/)).toBeDefined();
  });
});
