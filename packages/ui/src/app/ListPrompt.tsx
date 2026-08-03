import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '../primitives/Button.js';
import { Sheet } from '../primitives/Sheet.js';
import { TextField } from '../primitives/TextField.js';

export interface ListPromptProps {
  readonly open: boolean;
  /** The network being asked, named in the copy. */
  readonly networkName: string;
  /**
   * How many channels this network says it has, where it has said.
   *
   * Comes from the connection summary the server sends at sign-in, so the
   * warning can be specific rather than generic — "about 24,000" is a reason,
   * "this could be large" is a hedge.
   */
  readonly channelCount?: number;
  /** How many rows Marmotter will keep, so the copy does not have to guess. */
  readonly limit: number;
  readonly initialPattern?: string;
  readonly onConfirm: (pattern: string | undefined) => void;
  readonly onCancel: () => void;
}

/**
 * The question before a channel list.
 *
 * A bare `LIST` is the one ordinary request on IRC that can arrive as tens of
 * thousands of replies in a few seconds, and the person who typed it has no way
 * of knowing that in advance. So this says what is about to happen in numbers
 * they can act on, and offers the mitigation in the same breath: a pattern the
 * network applies at its end, so the flood never leaves the server.
 *
 * Not a warning triangle and not an "are you sure". It is a question with a
 * useful field in it.
 */
export function ListPrompt({
  open,
  networkName,
  channelCount,
  limit,
  initialPattern = '',
  onConfirm,
  onCancel,
}: ListPromptProps): ReactNode {
  const [pattern, setPattern] = useState(initialPattern);

  useEffect(() => {
    if (open) {
      setPattern(initialPattern);
    }
  }, [open, initialPattern]);

  const narrowed = pattern.trim() !== '';

  const submit = (): void => {
    onConfirm(narrowed ? pattern.trim() : undefined);
  };

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={`Channels on ${networkName}`}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {narrowed ? 'Ask for these' : 'Ask for all of them'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="text-subhead text-[var(--label-secondary)]">
          {channelCount === undefined
            ? `Asking for every channel on a busy network means tens of thousands of replies arriving over several seconds, and the window will be slower while they do.`
            : `${networkName} has ${channelCount.toLocaleString()} channels. Asking for all of them means ${channelCount.toLocaleString()} replies arriving over several seconds, and the window will be slower while they do.`}{' '}
          Marmotter keeps the first {limit.toLocaleString()} and shows them as they arrive.
        </p>

        <TextField
          label="Only channels matching"
          value={pattern}
          placeholder="*linux*"
          autoFocus
          onChange={(event) => setPattern(event.target.value)}
          hint="Leave this empty to ask for all of them. Networks differ in what they accept here; most take a name with * in it."
        />

        <button type="submit" className="sr-only">
          Ask
        </button>
      </form>
    </Sheet>
  );
}
