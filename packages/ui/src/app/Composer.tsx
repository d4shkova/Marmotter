import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';
import { IconButton } from '../primitives/IconButton.js';
import { type CompletionState, complete } from './completion.js';

export interface ComposerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Called with the finished line. Slash commands reach it unchanged. */
  readonly onSend: (text: string) => void;
  /** Where it is being sent, for the placeholder and the label. */
  readonly target: string;
  readonly nicks: readonly string[];
  readonly channels: readonly string[];
  readonly fold: (value: string) => string;
  /** Reports that the user is typing, for `draft/typing`. */
  readonly onTyping?: (active: boolean) => void;
  /** People currently typing here, for the indicator. */
  readonly typing?: readonly string[];
  /** The message being replied to, shown as a chip above the field. */
  readonly replyingTo?: { readonly id: string; readonly nick: string; readonly text: string };
  readonly onCancelReply?: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /**
   * Nothing can be said here, only done — the server tab, where there is no
   * conversation to send to but every command still works.
   */
  readonly commandsOnly?: boolean;
  readonly className?: string;
}

/** How long after the last keystroke a typing notification lapses. */
const TYPING_TIMEOUT_MS = 4_000;

/**
 * The message composer.
 *
 * Multi-line with Enter to send and Shift+Enter for a newline, which is the
 * convention every chat app shares. History is walked with the arrow keys only
 * when the caret is at the start or end of the text, so editing a long message
 * does not jump out of it.
 */
export function Composer({
  value,
  onChange,
  onSend,
  target,
  nicks,
  channels,
  fold,
  onTyping,
  typing = [],
  replyingTo,
  onCancelReply,
  disabled = false,
  disabledReason,
  commandsOnly = false,
  className,
}: ComposerProps): ReactNode {
  const field = useRef<HTMLTextAreaElement>(null);
  const completion = useRef<CompletionState | undefined>(undefined);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [history, setHistory] = useState<readonly string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Grow with the content up to a ceiling, so a long message is visible while
  // being written without the field taking over the window.
  useEffect(() => {
    const element = field.current;
    if (element === null) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [value]);

  const noteTyping = (): void => {
    if (onTyping === undefined) {
      return;
    }
    onTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), TYPING_TIMEOUT_MS);
  };

  const send = (): void => {
    const text = value.trim();
    if (text === '') {
      return;
    }
    setHistory((current) => [text, ...current].slice(0, 100));
    setHistoryIndex(-1);
    onChange('');
    clearTimeout(typingTimer.current);
    onTyping?.(false);
    onSend(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const element = event.currentTarget;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const result = complete(value, element.selectionStart, {
        nicks,
        channels,
        fold,
        previous: completion.current,
        backwards: event.shiftKey,
      });
      if (result !== undefined) {
        completion.current = result.state;
        onChange(result.text);
        // The caret has to move after React has written the new value.
        queueMicrotask(() => element.setSelectionRange(result.caret, result.caret));
      }
      return;
    }

    completion.current = undefined;

    // History only when the caret is at the edge, so editing a long message
    // does not jump out of it.
    if (event.key === 'ArrowUp' && element.selectionStart === 0 && history.length > 0) {
      event.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      onChange(history[next] ?? '');
      return;
    }
    if (event.key === 'ArrowDown' && element.selectionStart === value.length) {
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        onChange('');
      } else {
        const next = historyIndex - 1;
        setHistoryIndex(next);
        onChange(history[next] ?? '');
      }
      event.preventDefault();
    }
  };

  return (
    <div
      className={cn(
        'border-t border-[var(--separator)] px-4 py-2',
        'bg-[var(--bg-elevated)]/80 [backdrop-filter:var(--blur-vibrancy)]',
        className,
      )}
    >
      {replyingTo === undefined ? null : (
        <div className="mb-1.5 flex items-center gap-2 rounded-control bg-[var(--fill-tertiary)] px-2 py-1">
          <span aria-hidden="true" className="text-[var(--label-tertiary)]">
            ↩
          </span>
          <span className="min-w-0 flex-1 truncate text-caption-1 text-[var(--label-secondary)]">
            Replying to {replyingTo.nick}: {replyingTo.text}
          </span>
          <IconButton
            label="Cancel reply"
            size="small"
            icon={<span aria-hidden="true">✕</span>}
            onClick={onCancelReply}
          />
        </div>
      )}

      <div className="flex items-end gap-2">
        <label htmlFor="composer" className="sr-only">
          {commandsOnly ? `Command for ${target}` : `Message ${target}`}
        </label>
        <textarea
          id="composer"
          ref={field}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={
            disabled
              ? (disabledReason ?? 'You cannot send here')
              : commandsOnly
                ? 'Type a command, such as /join #channel'
                : `Message ${target}`
          }
          onChange={(event) => {
            onChange(event.target.value);
            noteTyping();
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'flex-1 resize-none rounded-control bg-[var(--fill-tertiary)] px-3 py-2',
            'font-mono text-footnote text-[var(--label-primary)]',
            'placeholder:text-[var(--label-quaternary)]',
            'border border-transparent focus:border-[var(--separator)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
        <IconButton
          label={commandsOnly ? 'Run this command' : `Send to ${target}`}
          icon={<span aria-hidden="true">↑</span>}
          disabled={disabled || value.trim() === ''}
          onClick={send}
        />
      </div>

      <p aria-live="polite" className="h-4 pt-0.5 text-caption-2 text-[var(--label-tertiary)]">
        {describeTyping(typing)}
      </p>
    </div>
  );
}

/** "tamsin is typing", "tamsin and jonquil are typing", "several people…". */
function describeTyping(nicks: readonly string[]): string {
  switch (nicks.length) {
    case 0:
      return '';
    case 1:
      return `${nicks[0]} is typing`;
    case 2:
      return `${nicks[0]} and ${nicks[1]} are typing`;
    default:
      return 'Several people are typing';
  }
}
