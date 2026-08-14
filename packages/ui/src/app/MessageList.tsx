import type { ChannelState, Message, NetworkState } from '@marmotter/client';
import { fold } from '@marmotter/protocol';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
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
 * The log is announced as a `log` region rather than a `feed`: a feed implies
 * articles a screen reader can page between, and these are lines of a
 * conversation.
 */
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

  // Follow the conversation only while the reader is already at the bottom.
  // Scrolling them away from what they are reading is the single most
  // annoying thing a chat client can do.
  useEffect(() => {
    if (pinnedToBottom.current && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
  }, [rows.length, virtualizer]);

  const onScroll = (): void => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinnedToBottom.current = distance < 40;

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
    <div
      ref={scroller}
      onScroll={onScroll}
      className={cn('flex-1 overflow-y-auto overscroll-contain', className)}
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
  );
}
