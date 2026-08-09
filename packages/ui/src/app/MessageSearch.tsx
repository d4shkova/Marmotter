import { FOLDABLE_KINDS, type Message } from '@marmotter/client';
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '../lib/cn.js';
import { nickColorVar } from '../lib/nick-color.js';
import { IconButton } from '../primitives/IconButton.js';
import { formatTime } from './format.js';

/** One message that matches the current search, in buffer order. */
export interface SearchMatch {
  readonly id: string;
  readonly message: Message;
}

/**
 * Messages whose text contains the query, case-insensitively.
 *
 * Folded events — joins, parts, quits, nick changes — are left out: their text
 * is a mechanism ("joined"), not something a reader searches for, and they may
 * be collapsed inside a summary row the search could not scroll to anyway. Every
 * other message renders as its own row, so a match here always has somewhere to
 * jump to.
 */
export function findMatches(messages: readonly Message[], query: string): readonly SearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  const matches: SearchMatch[] = [];
  for (const message of messages) {
    if (FOLDABLE_KINDS.has(message.kind)) {
      continue;
    }
    if (message.text.toLowerCase().includes(needle)) {
      matches.push({ id: message.id, message });
    }
  }
  return matches;
}

export interface MessageSearchBarProps {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly matchCount: number;
  /** 1-based position of the active match, or 0 when there are none. */
  readonly activeOrdinal: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onClose: () => void;
}

/**
 * The search bar that drops in under the nav bar while searching a conversation.
 *
 * Enter and Shift+Enter walk the matches, which is the convention every
 * find-in-page shares, and Escape closes — so the whole thing is reachable
 * without leaving the field.
 */
export function MessageSearchBar({
  query,
  onQueryChange,
  matchCount,
  activeOrdinal,
  onPrev,
  onNext,
  onClose,
}: MessageSearchBarProps): ReactNode {
  const field = useRef<HTMLInputElement>(null);

  // Focus the field the moment the bar appears, so somebody can start typing
  // straight after pressing the search button.
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <div className="flex items-center gap-2 border-b border-[var(--separator)] bg-[var(--bg-elevated)]/80 px-4 py-2 [backdrop-filter:var(--blur-vibrancy)]">
      <span aria-hidden="true" className="text-[var(--label-tertiary)]">
        ⌕
      </span>
      <input
        ref={field}
        type="search"
        aria-label="Search this conversation"
        placeholder="Search messages"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) {
              onPrev();
            } else {
              onNext();
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        className={cn(
          'min-w-0 flex-1 bg-transparent font-mono text-footnote text-[var(--label-primary)]',
          'placeholder:text-[var(--label-quaternary)] focus:outline-none',
        )}
      />

      <span
        aria-live="polite"
        className="shrink-0 tabular-nums text-caption-1 text-[var(--label-tertiary)]"
      >
        {query.trim() === ''
          ? ''
          : matchCount === 0
            ? 'No matches'
            : `${activeOrdinal} of ${matchCount}`}
      </span>

      <IconButton
        label="Previous match"
        size="small"
        disabled={matchCount === 0}
        icon={<span aria-hidden="true">↑</span>}
        onClick={onPrev}
      />
      <IconButton
        label="Next match"
        size="small"
        disabled={matchCount === 0}
        icon={<span aria-hidden="true">↓</span>}
        onClick={onNext}
      />
      <IconButton
        label="Close search"
        size="small"
        icon={<span aria-hidden="true">✕</span>}
        onClick={onClose}
      />
    </div>
  );
}

export interface MessageSearchResultsProps {
  readonly query: string;
  readonly matches: readonly SearchMatch[];
  /** The id of the match currently centred in the message list. */
  readonly activeId: string | undefined;
  readonly onPick: (index: number) => void;
  readonly onClose: () => void;
  /** Casemapped fold, so a nick keeps one colour whatever case it is typed in. */
  readonly fold?: (nick: string) => string;
  readonly className?: string;
}

/**
 * The right-hand list of everywhere the search term appears.
 *
 * A companion to the highlighting in the message list itself: the list shows
 * the whole set at once, and picking one jumps the conversation to it. It closes
 * from its own corner as well as from the search bar, since a panel a person
 * opened should be one they can shut from where they are looking.
 */
export function MessageSearchResults({
  query,
  matches,
  activeId,
  onPick,
  onClose,
  fold,
  className,
}: MessageSearchResultsProps): ReactNode {
  return (
    <section
      aria-label="Search results"
      className={cn(
        'flex h-full w-full flex-col border-l border-[var(--separator)] bg-[var(--bg-elevated)]',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--separator)] px-3 py-2">
        <h2 className="min-w-0 truncate text-footnote font-medium tracking-wide text-[var(--label-tertiary)] uppercase">
          {matches.length === 0
            ? 'Results'
            : `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`}
        </h2>
        <IconButton
          label="Close search"
          size="small"
          icon={<span aria-hidden="true">✕</span>}
          onClick={onClose}
        />
      </header>

      {matches.length === 0 ? (
        <p className="px-3 py-3 text-footnote text-[var(--label-secondary)]">
          {query.trim() === '' ? 'Type to search this conversation.' : 'Nothing here matches that.'}
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto py-1">
          {matches.map((match, index) => {
            const nick = match.message.source?.nick ?? '';
            return (
              <li key={match.id}>
                <button
                  type="button"
                  aria-current={match.id === activeId ? 'true' : undefined}
                  onClick={() => onPick(index)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-[var(--fill-quaternary)]',
                    match.id === activeId && 'bg-[var(--fill-tertiary)]',
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    {nick === '' ? null : (
                      <span
                        className="shrink-0 font-mono text-caption-1"
                        style={{ color: `var(${nickColorVar(nick, fold?.(nick))})` }}
                      >
                        {nick}
                      </span>
                    )}
                    <span className="shrink-0 font-mono text-caption-2 tabular-nums text-[var(--label-quaternary)]">
                      {formatTime(match.message.at)}
                    </span>
                  </span>
                  <span className="line-clamp-2 font-mono text-caption-1 text-[var(--label-secondary)]">
                    {match.message.text}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
