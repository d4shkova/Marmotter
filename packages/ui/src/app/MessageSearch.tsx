import { FOLDABLE_KINDS, type Message } from '@marmotter/client';
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '../lib/cn.js';
import { nickColorVar } from '../lib/nick-color.js';
import { IconButton } from '../primitives/IconButton.js';
import { SegmentedControl, type Segment } from '../primitives/SegmentedControl.js';
import { formatTime } from './format.js';

/** One message that matches the current search, in buffer order. */
export interface SearchMatch {
  readonly id: string;
  readonly message: Message;
}

/**
 * What the query is matched against.
 *
 * `text` is find-in-page: the words in the messages. `nick` searches by who
 * wrote them, which is the other question people actually ask of a channel —
 * "what has this person said here" — and which a text search cannot answer,
 * since a nick appears in the column beside a message rather than in it.
 */
export type SearchScope = 'text' | 'nick';

/** The scopes, in the order the switch offers them. */
export const SEARCH_SCOPES: readonly Segment<SearchScope>[] = [
  { value: 'text', label: 'Messages' },
  { value: 'nick', label: 'People' },
];

/**
 * Messages matching the query, case-insensitively, in buffer order.
 *
 * In `text` scope the query is looked for in what was said; in `nick` scope, in
 * who said it. A nick match is a prefix or a whole name rather than a substring
 * anywhere: `sam` should find Sam and Sam_ without also finding everyone whose
 * name happens to contain those letters, which is the difference between
 * pulling up one person's messages and pulling up several people's.
 *
 * Folded events — joins, parts, quits, nick changes — are left out: their text
 * is a mechanism ("joined"), not something a reader searches for, and they may
 * be collapsed inside a summary row the search could not scroll to anyway. Every
 * other message renders as its own row, so a match here always has somewhere to
 * jump to.
 */
export function findMatches(
  messages: readonly Message[],
  query: string,
  scope: SearchScope = 'text',
): readonly SearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  const matches: SearchMatch[] = [];
  for (const message of messages) {
    if (FOLDABLE_KINDS.has(message.kind)) {
      continue;
    }
    const hit =
      scope === 'nick'
        ? (message.source?.nick ?? '').toLowerCase().startsWith(needle)
        : message.text.toLowerCase().includes(needle);
    if (hit) {
      matches.push({ id: message.id, message });
    }
  }
  return matches;
}

export interface MessageSearchBarProps {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** Whether the query is matched against what was said or against who said it. */
  readonly scope: SearchScope;
  readonly onScopeChange: (scope: SearchScope) => void;
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
  scope,
  onScopeChange,
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
        aria-label={
          scope === 'nick' ? 'Search this conversation by person' : 'Search this conversation'
        }
        placeholder={scope === 'nick' ? 'Search by who wrote it' : 'Search messages'}
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

      {/* What the query is matched against. A segmented control rather than a
          checkbox because these are two ways of asking, not a modifier on one:
          the same words mean different things on either side of it. */}
      <SegmentedControl
        label="What to search"
        value={scope}
        onChange={onScopeChange}
        segments={SEARCH_SCOPES}
        className="shrink-0"
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
  /** Which question the results answer, which changes the empty state's words. */
  readonly scope?: SearchScope;
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
  scope = 'text',
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
          {query.trim() === ''
            ? scope === 'nick'
              ? 'Type a name to see everything they have said here.'
              : 'Type to search this conversation.'
            : scope === 'nick'
              ? 'Nobody here goes by that.'
              : 'Nothing here matches that.'}
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
