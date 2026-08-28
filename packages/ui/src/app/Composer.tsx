import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';
import { IconButton } from '../primitives/IconButton.js';
import { type CompletionState, complete } from './completion.js';
import { EMOJI_GROUPS, replaceShortcodes } from './emoji.js';
import { type SuggestionItem, applySuggestion, computeSuggestions } from './suggest.js';

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
  /**
   * Whether this network's operator commands are offered in the list.
   *
   * Set from the network profile. Typing one in full still works either way —
   * this decides what is suggested, not what is permitted.
   */
  readonly operatorCommands?: boolean;
  /**
   * Opens a services command menu at a point, instead of the command list.
   *
   * Set only in a NickServ or ChanServ conversation. What somebody wants from
   * a blank message box in front of a service is that service's own commands —
   * `ACCESS`, `AJOIN`, `GETKEY` — not the client's slash commands, which do
   * almost nothing useful there.
   */
  readonly onServiceMenu?: (at: { readonly x: number; readonly y: number }) => void;
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
  operatorCommands = false,
  onServiceMenu,
  className,
}: ComposerProps): ReactNode {
  const field = useRef<HTMLTextAreaElement>(null);
  const popup = useRef<HTMLUListElement>(null);
  const completion = useRef<CompletionState | undefined>(undefined);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [history, setHistory] = useState<readonly string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  /** Where the caret was at the last keystroke, for the suggestion popup. */
  const [caret, setCaret] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Whether the whole command list was asked for outright, on an empty line. */
  const [browsing, setBrowsing] = useState(false);

  const suggestions = useMemo(
    () =>
      dismissed
        ? undefined
        : computeSuggestions(value, caret, {
            offerCommands: browsing,
            operator: operatorCommands,
          }),
    [value, caret, dismissed, browsing, operatorCommands],
  );
  const active = suggestions?.items[Math.min(highlighted, suggestions.items.length - 1)];

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

  // The popup scrolls once the list is longer than it is — which the browse
  // list is — so walking it with the arrow keys has to bring the highlighted
  // row along rather than leaving it above the fold.
  useEffect(() => {
    if (active === undefined) {
      return;
    }
    popup.current?.querySelector(`#suggestion-${CSS.escape(active.id)}`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [active]);

  // The typing timer outlives the field it belongs to otherwise: it fires
  // `onTyping(false)` for a conversation that is no longer on screen, against a
  // component that is no longer mounted. Cleared on the way out, and on a move
  // to another conversation, which is a different composer as far as the
  // network is concerned.
  useEffect(() => {
    return () => clearTimeout(typingTimer.current);
  }, []);

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
    // History keeps what was typed; the wire gets the shortcodes resolved. A
    // recalled line is therefore still editable as `:tada:` rather than as a
    // character somebody now has to delete blind.
    setHistory((current) => [text, ...current].slice(0, 100));
    setHistoryIndex(-1);
    onChange('');
    setDismissed(false);
    setBrowsing(false);
    clearTimeout(typingTimer.current);
    onTyping?.(false);
    onSend(replaceShortcodes(text));
  };

  /** Writes text into the field and puts the caret where it belongs. */
  const replace = (text: string, nextCaret: number): void => {
    onChange(text);
    setCaret(nextCaret);
    queueMicrotask(() => {
      const element = field.current;
      element?.focus();
      element?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const accept = (item: SuggestionItem): void => {
    if (suggestions === undefined) {
      return;
    }
    const result = applySuggestion(value, suggestions, item);
    setHighlighted(0);
    setBrowsing(false);
    replace(result.text, result.caret);
  };

  const insertEmoji = (char: string): void => {
    setPickerOpen(false);
    const at = field.current?.selectionStart ?? value.length;
    replace(`${value.slice(0, at)}${char}${value.slice(at)}`, at + char.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const element = event.currentTarget;

    // The suggestion popup owns the arrow keys and Enter while it is open, so
    // picking a command never sends a half-typed line by accident.
    if (suggestions !== undefined) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const count = suggestions.items.length;
        const step = event.key === 'ArrowDown' ? 1 : count - 1;
        setHighlighted((current) => (Math.min(current, count - 1) + step) % count);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && active !== undefined) {
        event.preventDefault();
        accept(active);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissed(true);
        setBrowsing(false);
        return;
      }
    }

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
        setCaret(result.caret);
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
        'relative border-t border-[var(--separator)] px-4 py-2',
        'bg-[var(--bg-elevated)]/80 [backdrop-filter:var(--blur-vibrancy)]',
        className,
      )}
    >
      {suggestions === undefined || active === undefined ? null : (
        <ul
          ref={popup}
          id="composer-suggestions"
          role="listbox"
          aria-label={suggestions.kind === 'command' ? 'Commands' : 'Emoji'}
          className={cn(
            'absolute bottom-full left-4 z-30 mb-1 max-h-72 w-[min(32rem,calc(100%-2rem))]',
            'overflow-y-auto rounded-card border border-[var(--separator)]',
            'bg-[var(--bg-elevated-2)]/95 py-1 shadow-lg [backdrop-filter:var(--blur-vibrancy)]',
          )}
        >
          {suggestions.items.map((item, index) => (
            <li
              key={item.id}
              id={`suggestion-${item.id}`}
              role="option"
              aria-selected={item.id === active.id}
              className={cn(
                'flex cursor-pointer items-baseline gap-2 px-3 py-1.5',
                item.id === active.id && 'bg-[var(--fill-tertiary)]',
              )}
              onMouseDown={(event) => {
                // Mouse down rather than click: a click would blur the field
                // first and the caret would be gone by the time we splice.
                event.preventDefault();
                accept(item);
              }}
              onMouseEnter={() => setHighlighted(index)}
            >
              <span className="font-mono text-footnote text-[var(--label-primary)]">
                {item.label}
              </span>
              <span className="font-mono text-caption-2 text-[var(--label-tertiary)]">
                {item.hint}
              </span>
              {item.detail === '' ? null : (
                <span className="min-w-0 flex-1 truncate text-caption-1 text-[var(--label-secondary)]">
                  {item.detail}
                </span>
              )}
              {item.alsoAt === undefined ? null : (
                <span className="shrink-0 text-caption-2 text-[var(--label-tertiary)]">
                  Also at {item.alsoAt}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!pickerOpen ? null : (
        <div
          role="dialog"
          aria-label="Emoji"
          className={cn(
            'absolute right-4 bottom-full z-30 mb-1 max-h-72 w-72 overflow-y-auto',
            'rounded-card border border-[var(--separator)] bg-[var(--bg-elevated-2)]/95 p-2',
            'shadow-lg [backdrop-filter:var(--blur-vibrancy)]',
          )}
        >
          {EMOJI_GROUPS.map((group) => (
            <section key={group.name} className="mb-2">
              <h2 className="px-1 pb-1 text-caption-2 text-[var(--label-tertiary)]">
                {group.name}
              </h2>
              <div className="flex flex-wrap gap-0.5">
                {group.emoji.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    title={`:${entry.name}:`}
                    aria-label={entry.name.replace(/_/g, ' ')}
                    className="rounded-control px-1.5 py-1 text-body hover:bg-[var(--fill-tertiary)]"
                    onClick={() => insertEmoji(entry.char)}
                  >
                    {entry.char}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

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
            setCaret(event.target.selectionStart);
            setHighlighted(0);
            setDismissed(false);
            onChange(event.target.value);
            noteTyping();
          }}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
          onClick={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => setBrowsing(false)}
          // An empty composer has nothing to cut or copy, so the platform menu
          // there offers almost nothing. What somebody is looking for when they
          // right-click a blank message box is what they can do — the same list
          // typing `/` produces, without having to know that `/` produces it.
          // With text in it the platform menu is the useful one and is left
          // alone.
          //
          // In front of NickServ or ChanServ the answer to "what can I do here"
          // is a different list: the service's own commands, not the client's.
          onContextMenu={(event) => {
            if (value !== '') {
              return;
            }
            event.preventDefault();
            if (onServiceMenu !== undefined) {
              onServiceMenu({ x: event.clientX, y: event.clientY });
              return;
            }
            setDismissed(false);
            setHighlighted(0);
            setBrowsing(true);
          }}
          // Not a `combobox`: that role is not allowed on a textarea, and the
          // field has to stay multi-line. A textbox supports the list
          // relationship on its own, which is all the popup needs to be
          // announced and navigated.
          aria-controls={suggestions === undefined ? undefined : 'composer-suggestions'}
          aria-activedescendant={active === undefined ? undefined : `suggestion-${active.id}`}
          aria-autocomplete="list"
          className={cn(
            'flex-1 resize-none rounded-control bg-[var(--fill-tertiary)] px-3 py-2',
            'font-mono text-footnote text-[var(--label-primary)]',
            'placeholder:text-[var(--label-quaternary)]',
            'border border-transparent focus:border-[var(--separator)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
        <IconButton
          label={pickerOpen ? 'Close the emoji picker' : 'Insert an emoji'}
          icon={<span aria-hidden="true">☺</span>}
          pressed={pickerOpen}
          disabled={disabled}
          onClick={() => setPickerOpen(!pickerOpen)}
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
