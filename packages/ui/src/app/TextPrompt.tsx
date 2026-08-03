import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '../primitives/Button.js';
import { Sheet } from '../primitives/Sheet.js';
import { TextField } from '../primitives/TextField.js';

export interface TextPromptProps {
  readonly open: boolean;
  readonly title: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly hint?: string;
  /** Names the confirm button after what it does, e.g. "Join". */
  readonly confirmLabel: string;
  readonly initialValue?: string;
  readonly onConfirm: (value: string) => void;
  readonly onCancel: () => void;
}

/**
 * A one-field prompt.
 *
 * This is the shape most of the GUI overlay takes: an action a person chose
 * from a menu that needs one piece of information — a channel to join, a reason
 * for a kick. Rather than a command line, they get a labelled field with a
 * button that names what happens.
 */
export function TextPrompt({
  open,
  title,
  label,
  placeholder,
  hint,
  confirmLabel,
  initialValue = '',
  onConfirm,
  onCancel,
}: TextPromptProps): ReactNode {
  const [value, setValue] = useState(initialValue);

  // Reset whenever the prompt reopens, so a previous answer does not linger.
  useEffect(() => {
    if (open) {
      setValue(initialValue);
    }
  }, [open, initialValue]);

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed !== '') {
      onConfirm(trimmed);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={value.trim() === ''}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label={label}
          value={value}
          placeholder={placeholder}
          {...(hint === undefined ? {} : { hint })}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
        />
        {/* A submit input with no visible button, so Enter confirms the form. */}
        <button type="submit" className="sr-only">
          {confirmLabel}
        </button>
      </form>
    </Sheet>
  );
}
