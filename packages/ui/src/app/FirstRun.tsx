/**
 * The first thing Marmotter asks.
 *
 * mIRC opens on this and every client since has had some version of it: a name,
 * a couple of fallbacks for when it is taken, and optionally who you are. Then
 * it stops asking. Marmotter had no equivalent, so a third network meant typing
 * the same nick a third time.
 *
 * Three rules shape the copy. The two optional fields say plainly who can see
 * them, because "Full name" sounds private and is not — `WHOIS` hands it to any
 * stranger who asks. The fallbacks are pre-filled rather than demanded, since
 * the client used to generate exactly these on its own and somebody who does
 * not care should not have to think about it. And nothing here is a password:
 * this screen never asks for one, and says so, because a setup screen asking
 * for a name and a password in the same breath teaches people to type an IRC
 * password into anything that asks.
 */

import {
  type DefaultIdentity,
  EMPTY_IDENTITY,
  nickProblem,
  suggestedAlternates,
} from '@marmotter/shared';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '../primitives/Button.js';
import { Sheet } from '../primitives/Sheet.js';
import { TextField } from '../primitives/TextField.js';

export interface FirstRunProps {
  readonly open: boolean;
  /** Saves the answers and closes. */
  readonly onDone: (identity: DefaultIdentity) => void;
  /**
   * Closes without saving anything.
   *
   * Skipping is allowed: somebody who wants to get on with it types their name
   * into the "Add a network" form instead, which still works and always has.
   */
  readonly onSkip: () => void;
  /** What to start from, when this is being opened again from Settings. */
  readonly initial?: DefaultIdentity;
  /** Names the confirm button, so Settings can say "Save" rather than "Continue". */
  readonly confirmLabel?: string;
}

export function FirstRun({
  open,
  onDone,
  onSkip,
  initial = EMPTY_IDENTITY,
  confirmLabel = 'Continue',
}: FirstRunProps): ReactNode {
  const [identity, setIdentity] = useState<DefaultIdentity>(initial);
  /** Whether the fallbacks are still the ones we suggested, and may be replaced. */
  const [alternatesUntouched, setAlternatesUntouched] = useState(
    initial.altNick === '' && initial.thirdNick === '',
  );
  const [showErrors, setShowErrors] = useState(false);

  const set = (changes: Partial<DefaultIdentity>): void =>
    setIdentity((current) => ({ ...current, ...changes }));

  /**
   * Typing a name fills in the fallbacks underneath it.
   *
   * Only while they are still ours: once somebody has typed their own second
   * choice, editing the first name must not overwrite it.
   */
  const changeNick = (nick: string): void => {
    if (alternatesUntouched) {
      set({ nick, ...suggestedAlternates(nick) });
    } else {
      set({ nick });
    }
  };

  const problems = {
    nick: nickProblem(identity.nick),
    altNick: identity.altNick === '' ? undefined : nickProblem(identity.altNick),
    thirdNick: identity.thirdNick === '' ? undefined : nickProblem(identity.thirdNick),
  };
  const ready =
    problems.nick === undefined &&
    problems.altNick === undefined &&
    problems.thirdNick === undefined;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready) {
      setShowErrors(true);
      return;
    }
    onDone({
      nick: identity.nick.trim(),
      altNick: identity.altNick.trim(),
      thirdNick: identity.thirdNick.trim(),
      realname: identity.realname.trim(),
      email: identity.email.trim(),
    });
  };

  /** The error props for a field: present only once the form has been tried. */
  const errorFor = (key: keyof typeof problems): { error: string } | Record<string, never> => {
    const problem = showErrors ? problems[key] : undefined;
    return problem === undefined ? {} : { error: problem };
  };

  return (
    <Sheet
      open={open}
      onClose={onSkip}
      title="What should people call you?"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onSkip}>Skip</Button>
          <Button variant="primary" onClick={submit}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-callout text-[var(--label-secondary)]">
          This is the name you appear under. Marmotter uses it on every network you add, so you only
          enter it once — and you can still use a different one on any network.
        </p>

        <TextField
          label="Name"
          value={identity.nick}
          onChange={(event) => changeNick(event.target.value)}
          placeholder="tamsin"
          autoFocus
          {...errorFor('nick')}
        />

        <div className="flex flex-col gap-3">
          <p className="text-footnote text-[var(--label-secondary)]">
            Names on IRC are first come, first served. If yours is taken when you connect, Marmotter
            tries these instead.
          </p>
          <TextField
            label="If that is taken"
            value={identity.altNick}
            onChange={(event) => {
              setAlternatesUntouched(false);
              set({ altNick: event.target.value });
            }}
            placeholder="tamsin_"
            {...errorFor('altNick')}
          />
          <TextField
            label="And if that is taken too"
            value={identity.thirdNick}
            onChange={(event) => {
              setAlternatesUntouched(false);
              set({ thirdNick: event.target.value });
            }}
            placeholder="tamsin__"
            {...errorFor('thirdNick')}
          />
        </div>

        <TextField
          label="Full name (optional)"
          value={identity.realname}
          onChange={(event) => set({ realname: event.target.value })}
          placeholder="Tamsin"
          // Not a privacy nicety: this is genuinely public, and "Full name" on a
          // setup screen reads as though it were not. Anybody on the network can
          // ask for it, and people put a website or nothing here for that reason.
          hint="Anyone on a network can look this up. Leave it blank, or put whatever you would tell a stranger."
        />

        <TextField
          label="Email (optional)"
          type="email"
          value={identity.email}
          onChange={(event) => set({ email: event.target.value })}
          placeholder="you@example.com"
          // Only used where a network's own account service asks for one. It is
          // never sent when connecting, which is worth saying, because an email
          // field on a connection screen implies otherwise.
          hint="Only used if you register an account with a network later. It is never sent when you connect."
        />

        <p className="text-footnote text-[var(--label-tertiary)]">
          Marmotter never asks for a password here. If you have an account on a network, you enter
          that when you add the network.
        </p>

        {/* Enter from any field submits the form. The footer's button is
            outside the form and cannot be its default, so this stands in —
            `hidden` rather than `sr-only`, which would put a second control
            with the same name into the accessibility tree. A display:none
            submit button is still the form's default button. */}
        <button type="submit" hidden>
          {confirmLabel}
        </button>
      </form>
    </Sheet>
  );
}
