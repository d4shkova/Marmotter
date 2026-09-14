import {
  FOLDABLE_KINDS,
  type ChannelState,
  type Message,
  type NetworkState,
} from '@marmotter/client';
import { fold } from '@marmotter/protocol';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { Spinner } from '../primitives/Spinner.js';
import { MessageRow } from './MessageRow.js';
import { buildRows, estimateRowHeight } from './rows.js';

export interface MessageListProps {
  readonly network: NetworkState;
  readonly conversation: ChannelState;
  readonly nickWidth: number;
  readonly alignNicksRight: boolean;
  readonly showTimestamps: boolean;
  readonly foldEvents: boolean;
  /** Unread count, for the "new messages" line. */
  readonly unreadCount?: number;
  /** Asked for when the user scrolls to the top and more history exists. */
  readonly onLoadOlder?: () => void;
  readonly onReply?: (message: Message) => void;
  readonly onNickClick?: (nick: string) => void;
  /**
   * Opens the actions for a name, at the point it was asked for.
   *
   * Owned by the caller rather than by a row: the list is virtualized, and a
   * menu belonging to a row would be unmounted the moment scrolling took that
   * row out of the window.
   */
  readonly onNickMenu?: (nick: string, at: { readonly x: number; readonly y: number }) => void;
  /** Opens a link from a message, after the interface has confirmed it. */
  readonly onOpenLink?: (href: string) => void;
  /** Decides whether a message mentions the user, for the highlight. */
  readonly isHighlight?: (message: Message) => boolean;
  /** Message ids that match the current in-conversation search. */
  readonly searchMatchIds?: ReadonlySet<string>;
  /** The one match centred and emphasised as the user steps through them. */
  readonly searchActiveId?: string;
  readonly className?: string;
}

/**
 * The virtualized message list.
 *
 * Channels reach tens of thousands of lines, so only what is on screen is in
 * the DOM. Two things follow from that and are easy to get wrong: the list has
 * to stay pinned to the bottom while the user is at the bottom and *not* while
 * they have scrolled up to read, and loading older history has to preserve the
 * scroll position or the page yanks away from what they were reading.
 *
 * Not following the conversation is the right behaviour and it leaves a gap:
 * somebody who has scrolled up has no way back but to drag, and no way to know
 * anything has been said since. The jump button is that way back, and it is
 * also the notice — it counts what has arrived since they left the bottom, and
 * says when one of those was addressed to them, which is the one thing worth
 * interrupting a person for.
 *
 * The log is announced as a `log` region rather than a `feed`: a feed implies
 * articles a screen reader can page between, and these are lines of a
 * conversation.
 */
/**
 * What has been said since the reader left the bottom.
 *
 * Joins and parts are counted separately from what people actually said,
 * because "3 new messages" that turns out to be three people reconnecting is a
 * button that taught somebody not to trust it. A netsplit still brings the
 * button back — they are scrolled up, and there has to be a way down — it just
 * does not claim anybody spoke.
 */
interface Missed {
  readonly messages: number;
  /** Whether one of them was addressed to the reader. */
  readonly mention: boolean;
}

const NOTHING_MISSED: Missed = { messages: 0, mention: false };

/**
 * The messages that arrived after the one the reader had last seen.
 *
 * By identity, not by position, because a position does not survive the buffer
 * it indexes. History backfill splices older messages in by timestamp — ahead
 * of the mark, shifting everything after it — and the buffer is trimmed from
 * the front once a channel is busy enough. Counting from an index therefore
 * reported lines somebody had already read as new, and the case that triggers
 * it is the very one this exists for: the scroll handler that notices the
 * reader has left the bottom is the same one that asks for older history.
 *
 * Searched from the end, where the mark almost always is, since this runs on
 * every change to the buffer while the reader is away from the bottom.
 */
function messagesAfter(
  messages: readonly Message[],
  lastSeen: string | undefined,
): readonly Message[] | undefined {
  if (lastSeen === undefined) {
    return messages;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.id === lastSeen) {
      return messages.slice(index + 1);
    }
  }
  // Trimmed out from under us. Said so rather than assumed, because the two
  // callers want different things of it: the mark being gone means everything
  // still held is newer, while the running tally being gone means the tally
  // has to be rebuilt rather than added to.
  return undefined;
}

/** How close to the end still counts as being at the end, in pixels. */
const BOTTOM_SLACK = 40;

export function MessageList({
  network,
  conversation,
  nickWidth,
  alignNicksRight,
  showTimestamps,
  foldEvents,
  unreadCount,
  onLoadOlder,
  onReply,
  onNickClick,
  onNickMenu,
  onOpenLink,
  isHighlight,
  searchMatchIds,
  searchActiveId,
  className,
}: MessageListProps): ReactNode {
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const previousHeight = useRef(0);

  /**
   * The last message the reader had seen when they were last at the bottom.
   *
   * An id rather than a count: the buffer is spliced into by history backfill
   * and trimmed from the front, so a position stops meaning what it meant. An
   * id that has been trimmed away is handled where it is read, and reads as
   * "everything here is newer", which is true.
   */
  const seen = useRef<string | undefined>(conversation.messages.at(-1)?.id);
  /**
   * How far the count below has already got, and what it has counted.
   *
   * Separate from the mark because the mark stays put while the reader is away
   * and this moves with the buffer: it is what makes the count incremental. A
   * reader parked a few hundred lines up would otherwise have every message
   * they have missed re-counted — and re-tested against their highlight words,
   * which compiles a pattern per message — on each new line that arrives.
   */
  const counted = useRef<string | undefined>(conversation.messages.at(-1)?.id);
  const tally = useRef<Missed>(NOTHING_MISSED);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [missed, setMissed] = useState<Missed>(NOTHING_MISSED);

  /**
   * Held in a ref so counting does not depend on its identity.
   *
   * The caller builds this inline — it closes over the user's nick and their
   * highlight words — so it is a new function on every render. As a dependency
   * it would re-run the count on every render of the window rather than when
   * the buffer changes, which on a busy channel is most of them.
   */
  const highlights = useRef(isHighlight);
  highlights.current = isHighlight;

  const rows = useMemo(
    () =>
      buildRows(conversation.messages, {
        foldEvents,
        ...(unreadCount === undefined ? {} : { unreadCount }),
      }),
    [conversation.messages, foldEvents, unreadCount],
  );

  const mapping = network.support.caseMapping;
  const isMember = useCallback(
    (word: string) => conversation.members.has(fold(word, mapping)),
    [conversation.members, mapping],
  );
  const foldNick = useCallback((nick: string) => fold(nick, mapping), [mapping]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row === undefined ? 24 : estimateRowHeight(row);
    },
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 12,
  });

  /**
   * Everything up to here has been seen, and nothing is outstanding.
   *
   * One place, because the mark, the running tally and the pill's count are
   * three things that have to be reset together and were being reset apart in
   * four.
   */
  const markSeen = useCallback((): void => {
    const last = conversation.messages.at(-1)?.id;
    seen.current = last;
    counted.current = last;
    tally.current = NOTHING_MISSED;
    // Only when there is something to clear: this runs on every buffer change
    // and an unconditional set would re-render the list on each one.
    setMissed((current) => (current.messages === 0 && !current.mention ? current : NOTHING_MISSED));
  }, [conversation.messages]);

  /** Back to the live end of the conversation, and following it again. */
  const jumpToBottom = useCallback((): void => {
    pinnedToBottom.current = true;
    markSeen();
    setAwayFromBottom(false);
    if (rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
  }, [markSeen, rows.length, virtualizer]);

  // Follow the conversation only while the reader is already at the bottom.
  // Scrolling them away from what they are reading is the single most
  // annoying thing a chat client can do.
  useEffect(() => {
    if (pinnedToBottom.current && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
  }, [rows.length, virtualizer]);

  const messages = conversation.messages;

  /**
   * What has arrived since the reader stopped following.
   *
   * Driven by the buffer rather than by the row list because a row list folds:
   * eight people joining is one row and eight messages, and the reader is owed
   * the honest count of what was said, which here is none of them.
   */
  useEffect(() => {
    if (pinnedToBottom.current) {
      markSeen();
      return;
    }

    // The part of the buffer nothing has counted yet, falling back to a full
    // rebuild from the mark when the buffer has moved out from under the
    // running tally.
    const fresh = messagesAfter(messages, counted.current);
    const since = fresh ?? messagesAfter(messages, seen.current) ?? messages;
    const previous = fresh === undefined ? NOTHING_MISSED : tally.current;

    const mentions = highlights.current;
    let said = previous.messages;
    let mention = previous.mention;
    for (const message of since) {
      if (FOLDABLE_KINDS.has(message.kind)) {
        continue;
      }
      said += 1;
      // Once it is true it cannot become false without a reset, and the test
      // is the expensive part of this loop.
      if (!mention && mentions !== undefined && mentions(message)) {
        mention = true;
      }
    }

    counted.current = messages.at(-1)?.id;
    tally.current = { messages: said, mention };
    setMissed((current) =>
      current.messages === said && current.mention === mention ? current : tally.current,
    );
  }, [messages, markSeen]);

  /**
   * A different conversation is a different place in a different list.
   *
   * Without this, opening a channel inherits the last one's position: the
   * button arrives already counting messages nobody missed, on a list that was
   * just rendered at its bottom.
   */
  useEffect(() => {
    // The same thing pressing the pill does — including actually scrolling.
    // Saying the list is at the bottom does not put it there: the scroll
    // container is reused across conversations, and the effect that follows the
    // tail only fires when the row count changes, so opening a channel with as
    // many rows as the last one showed it at the previous channel's offset,
    // claiming to be at the bottom, with no pill to get back.
    jumpToBottom();
    // Deliberately keyed on which conversation this is rather than on its
    // contents; the buffer changing is the case above, not this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network.id, conversation.name]);

  const onScroll = (): void => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distance < BOTTOM_SLACK;
    pinnedToBottom.current = atBottom;

    // Set only on the edge. This fires on every frame of a scroll, and a state
    // write per frame would re-render a virtualized list mid-drag.
    setAwayFromBottom((away) => (away === !atBottom ? away : !atBottom));
    if (atBottom) {
      markSeen();
    }

    // Reaching the top asks for the page before, once.
    if (element.scrollTop < 200 && onLoadOlder !== undefined) {
      previousHeight.current = element.scrollHeight;
      onLoadOlder();
    }
  };

  // Stepping through search matches centres the active one. This deliberately
  // stops following the bottom: a reader jumping to a hit three thousand lines
  // up has left the live tail, and snapping them back to it would undo the jump.
  useEffect(() => {
    if (searchActiveId === undefined) {
      return;
    }
    const index = rows.findIndex(
      (row) => row.kind === 'message' && row.message.id === searchActiveId,
    );
    if (index >= 0) {
      pinnedToBottom.current = false;
      // A jump to a hit three thousand lines up leaves the live tail, which is
      // exactly the state the button exists for.
      setAwayFromBottom(true);
      virtualizer.scrollToIndex(index, { align: 'center' });
    }
  }, [searchActiveId, rows, virtualizer]);

  // Loading older messages grows the list upward; without this the viewport
  // jumps by exactly the height that was inserted above it.
  useEffect(() => {
    const element = scroller.current;
    if (element === null || previousHeight.current === 0) {
      return;
    }
    const growth = element.scrollHeight - previousHeight.current;
    if (growth > 0) {
      element.scrollTop += growth;
    }
    previousHeight.current = 0;
  }, [rows.length]);

  if (conversation.messages.length === 0) {
    return (
      <div className={cn('flex flex-1 items-center justify-center', className)}>
        <EmptyState
          title="No messages yet"
          description={
            conversation.historyComplete
              ? 'This is the start of the conversation.'
              : "This network doesn't keep history, so the conversation starts here."
          }
        />
      </div>
    );
  }

  return (
    // The scroller is wrapped rather than being the root, so the button can be
    // positioned against the list's bottom edge. Inside the scroller it would
    // be positioned against the content and would scroll away with it, which is
    // the one thing it must not do.
    <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div
          role="log"
          aria-label={`Messages in ${conversation.name}`}
          aria-live="polite"
          aria-relevant="additions"
          style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
        >
          {conversation.historyPending !== undefined ? (
            <div className="absolute inset-x-0 top-0 flex justify-center py-2">
              <Spinner size="small" label="Loading earlier messages" />
            </div>
          ) : null}

          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (row === undefined) {
              return null;
            }
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <MessageRow
                  row={row}
                  nickWidth={nickWidth}
                  alignNicksRight={alignNicksRight}
                  showTimestamps={showTimestamps}
                  isMember={isMember}
                  fold={foldNick}
                  {...(onReply === undefined ? {} : { onReply })}
                  {...(onNickClick === undefined ? {} : { onNickClick })}
                  {...(onNickMenu === undefined ? {} : { onNickMenu })}
                  {...(onOpenLink === undefined ? {} : { onOpenLink })}
                  highlighted={
                    row.kind === 'message' && isHighlight !== undefined
                      ? isHighlight(row.message)
                      : false
                  }
                  searchMatch={
                    row.kind !== 'message'
                      ? 'none'
                      : row.message.id === searchActiveId
                        ? 'active'
                        : searchMatchIds?.has(row.message.id) === true
                          ? 'match'
                          : 'none'
                  }
                />
              </div>
            );
          })}
        </div>

        {conversation.historyGap ? (
          <div className="flex justify-center py-3">
            <Button variant="plain" size="small" onClick={onLoadOlder}>
              Load the messages in between
            </Button>
          </div>
        ) : null}
      </div>

      {awayFromBottom ? <JumpToLatest missed={missed} onJump={jumpToBottom} /> : null}
    </div>
  );
}

/**
 * The way back to the live end of the conversation.
 *
 * Shown whenever the reader has scrolled off the bottom, not only when
 * something has arrived: having scrolled up is itself the state with no way
 * back, and a button that appears only once somebody speaks leaves a person who
 * scrolled up into a quiet channel dragging their way down.
 *
 * What it says changes with what it is reporting, which is the whole of the
 * feature. With nothing new it is a way back and says so. With messages behind
 * it, it is also the notice that they exist. And a mention takes the accent —
 * the one interruption CLAUDE.md says is worth making — rather than red, which
 * in this interface always means something went wrong.
 *
 * Not `aria-live`: the log above it already announces additions, and a region
 * that re-read the running total on every message would talk over it.
 */
function JumpToLatest({ missed, onJump }: { missed: Missed; onJump: () => void }): ReactNode {
  const { messages, mention } = missed;
  const label =
    messages === 0
      ? 'Jump to latest'
      : messages === 1
        ? '1 new message'
        : `${messages} new messages`;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <button
        type="button"
        onClick={onJump}
        // Named in full for a screen reader, which has no arrow to look at and
        // no position on the screen to read the word "latest" against.
        aria-label={
          messages === 0
            ? 'Jump to the latest messages'
            : `Jump to the latest messages. ${label}${mention ? ', one mentions you' : ''}.`
        }
        className={cn(
          'pointer-events-auto flex items-center gap-1.5 rounded-full py-1.5 pr-3.5 pl-3',
          'text-footnote font-medium shadow-lg',
          'border border-[var(--separator)] [backdrop-filter:var(--blur-vibrancy)]',
          'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
          mention
            ? 'border-transparent bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)]'
            : 'bg-[var(--bg-elevated-2)] text-[var(--label-primary)] hover:bg-[var(--bg-elevated-3)]',
        )}
      >
        <span aria-hidden="true">
          <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current stroke-[1.75]">
            <path d="M8 3v10M4 9l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span aria-hidden="true">{label}</span>
      </button>
    </div>
  );
}
