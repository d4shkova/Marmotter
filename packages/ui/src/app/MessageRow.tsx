import type { Message } from '@marmotter/client';
import { type ReactNode, useState } from 'react';
import { Decoder } from '../decoder/Decoder.js';
import { cn } from '../lib/cn.js';
import { useLongPress } from '../lib/long-press.js';
import { nickColorVar } from '../lib/nick-color.js';
import { IconButton } from '../primitives/IconButton.js';
import type { Row } from './rows.js';
import { type TextSegment, fitNick, formatDay, formatTime, segment } from './format.js';

export interface MessageRowProps {
  readonly row: Row;
  readonly nickWidth: number;
  readonly alignNicksRight: boolean;
  readonly showTimestamps: boolean;
  /** Casemapped membership test, so only real nicks are highlighted in text. */
  readonly isMember?: (word: string) => boolean;
  /** Casemapped fold, so one person is one colour whatever case they use. */
  readonly fold?: (nick: string) => string;
  readonly onReply?: (message: Message) => void;
  readonly onReact?: (message: Message) => void;
  readonly onCopy?: (message: Message) => void;
  readonly onNickClick?: (nick: string) => void;
  /** Opens the actions for the name, on right-click or long-press. */
  readonly onNickMenu?: (nick: string, at: { readonly x: number; readonly y: number }) => void;
  /** Opens a link from a message, after the interface has confirmed it. */
  readonly onOpenLink?: (href: string) => void;
  /** Highlights the row, for a message that mentions the user. */
  readonly highlighted?: boolean;
  /**
   * Whether this row matches the active in-conversation search: `match` for one
   * of the set, `active` for the one currently centred and stepped to.
   */
  readonly searchMatch?: 'none' | 'match' | 'active';
}

/**
 * One line of the message list.
 *
 * Compact and IRC-native rather than a chat bubble, with fixed-width timestamp
 * and nick columns so message text is left-aligned into one readable edge.
 *
 * Hover actions are always in the DOM and only change opacity. Mounting them on
 * hover would reflow the row under the pointer, which is the layout shift
 * CLAUDE.md rules out absolutely.
 */
export function MessageRow(props: MessageRowProps): ReactNode {
  switch (props.row.kind) {
    case 'day':
      return <DayRow at={props.row.at} />;
    case 'unread-marker':
      return <UnreadRow />;
    case 'events':
      return <EventsRow row={props.row} showTimestamps={props.showTimestamps} />;
    case 'message':
      return <TextRow {...props} row={props.row} />;
  }
}

function DayRow({ at }: { at: Date }): ReactNode {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--separator)]" />
      <span className="text-caption-1 text-[var(--label-tertiary)]">{formatDay(at)}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--separator)]" />
    </div>
  );
}

function UnreadRow(): ReactNode {
  return (
    <div className="flex items-center gap-3 px-4 py-1">
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--accent)]" />
      <span className="text-caption-2 font-medium text-[var(--accent)]">New messages</span>
    </div>
  );
}

function EventsRow({
  row,
  showTimestamps,
}: {
  row: Extract<Row, { kind: 'events' }>;
  showTimestamps: boolean;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-4 py-0.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-baseline gap-2 text-left text-footnote text-[var(--label-tertiary)] hover:text-[var(--label-secondary)]"
      >
        {showTimestamps ? (
          <span className="shrink-0 font-mono tabular-nums opacity-60">{formatTime(row.at)}</span>
        ) : null}
        <span aria-hidden="true">·</span>
        <span>{row.summary}</span>
        <span aria-hidden="true" className="opacity-60">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded ? (
        <ul className="mt-1 ml-6 flex flex-col gap-0.5">
          {row.messages.map((message) => (
            <li key={message.id} className="text-footnote text-[var(--label-tertiary)]">
              <span className="font-mono tabular-nums opacity-60">{formatTime(message.at)}</span>{' '}
              {message.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TextRow({
  row,
  nickWidth,
  alignNicksRight,
  showTimestamps,
  isMember,
  fold,
  onReply,
  onReact,
  onCopy,
  onNickClick,
  onNickMenu,
  onOpenLink,
  highlighted = false,
  searchMatch = 'none',
}: MessageRowProps & { row: Extract<Row, { kind: 'message' }> }): ReactNode {
  const { message, grouped } = row;
  const nick = message.source?.nick ?? '';
  const isAction = message.kind === 'action';

  // The actions for whoever wrote the line, reached the way every other IRC
  // client offers them: right-click the name, or hold the line on a touch
  // screen. The hold is on the whole row rather than on the name alone — a
  // nick column is a few characters wide and asking somebody to land a finger
  // inside it is asking them to miss.
  const openMenu = (event: {
    clientX: number;
    clientY: number;
    preventDefault: () => void;
  }): void => {
    if (onNickMenu === undefined || nick === '') {
      return;
    }
    event.preventDefault();
    onNickMenu(nick, { x: event.clientX, y: event.clientY });
  };
  const longPress = useLongPress(
    onNickMenu === undefined || nick === '' ? undefined : (at) => onNickMenu(nick, at),
  );
  const isNotice = message.kind === 'notice';
  const isError = message.kind === 'error';

  return (
    <div
      {...longPress}
      className={cn(
        'group relative flex items-baseline gap-2 px-4 py-px',
        'hover:bg-[var(--fill-quaternary)]',
        // A held line opens the menu, so it must not also start a text
        // selection or the WebView's own copy bubble on the way there.
        onNickMenu === undefined || nick === ''
          ? undefined
          : 'pointer-coarse:touch-manipulation pointer-coarse:select-none',
        highlighted && 'bg-[var(--accent-muted)]',
        // Search sits on top of the mention highlight: every hit gets a quiet
        // fill, and the one being stepped to gets a ring so it reads as "here"
        // among the rest, without spending a second colour on it.
        searchMatch === 'match' && 'bg-[var(--fill-tertiary)]',
        searchMatch === 'active' &&
          'bg-[var(--accent-muted)] ring-1 ring-inset ring-[var(--accent)]',
      )}
    >
      {showTimestamps ? (
        <time
          dateTime={message.at.toISOString()}
          // The distinction is on hover, per CLAUDE.md: a local clock can
          // disagree with the server by minutes and the reader should be able
          // to find out which they are looking at.
          title={
            message.fromServerTime
              ? `${message.at.toLocaleString()} — the server's clock`
              : `${message.at.toLocaleString()} — this device's clock`
          }
          className={cn(
            'shrink-0 font-mono text-caption-1 tabular-nums text-[var(--label-quaternary)]',
            !message.fromServerTime && 'italic',
          )}
        >
          {formatTime(message.at)}
        </time>
      ) : null}

      <span
        className={cn(
          'shrink-0 overflow-hidden font-mono text-footnote whitespace-nowrap',
          alignNicksRight ? 'text-right' : 'text-left',
        )}
        style={{ width: `${nickWidth}ch` }}
      >
        {grouped || nick === '' ? null : (
          <button
            type="button"
            onClick={onNickClick === undefined ? undefined : () => onNickClick(nick)}
            onContextMenu={onNickMenu === undefined ? undefined : openMenu}
            style={{ color: `var(${nickColorVar(nick, fold?.(nick))})` }}
            className="max-w-full truncate hover:underline"
          >
            {isAction ? null : fitNick(nick, nickWidth)}
          </button>
        )}
      </span>

      <span
        className={cn(
          'min-w-0 flex-1 font-mono text-footnote break-words',
          isAction && 'italic',
          isNotice && 'text-[var(--accent)]',
          isError && 'text-[var(--danger)]',
          message.pending && 'opacity-60',
          !isNotice && !isError && 'text-[var(--label-primary)]',
        )}
      >
        {message.replyTo === undefined ? null : <ReplyChip id={message.replyTo} />}
        {/* An action carries its author inside the sentence — "marmot waves" —
            rather than in the nick column, so that is the name to right-click
            on one of these rows. */}
        {isAction ? (
          <span style={{ color: `var(${nickColorVar(nick, fold?.(nick))})` }}>
            <button
              type="button"
              onClick={onNickClick === undefined ? undefined : () => onNickClick(nick)}
              onContextMenu={onNickMenu === undefined ? undefined : openMenu}
              className="hover:underline"
            >
              {nick}
            </button>{' '}
          </span>
        ) : null}
        <Body
          text={message.text}
          kind={message.kind}
          isMember={isMember}
          fold={fold}
          {...(onOpenLink === undefined ? {} : { onOpenLink })}
        />
        {message.pending ? (
          <span
            title="Not yet confirmed by the server"
            className="ml-1.5 align-middle text-[var(--label-quaternary)]"
          >
            <span aria-hidden="true">◌</span>
            <span className="sr-only">Not yet confirmed by the server</span>
          </span>
        ) : null}
      </span>

      {/* Always mounted, opacity-only: mounting on hover would reflow the row
          under the pointer. Hover is what reveals it under a pointer, and a
          coarse pointer never hovers — so where there is one, the row simply
          carries its actions. */}
      <span className="pointer-events-none absolute top-0 right-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
        {onReply === undefined ? null : (
          <IconButton
            label="Reply"
            size="small"
            icon={<Glyph>↩</Glyph>}
            onClick={() => onReply(message)}
          />
        )}
        {onReact === undefined ? null : (
          <IconButton
            label="React"
            size="small"
            icon={<Glyph>☺</Glyph>}
            onClick={() => onReact(message)}
          />
        )}
        {onCopy === undefined ? null : (
          <IconButton
            label="Copy message"
            size="small"
            icon={<Glyph>⧉</Glyph>}
            onClick={() => onCopy(message)}
          />
        )}
      </span>
    </div>
  );
}

const Glyph = ({ children }: { children: string }) => (
  <span className="text-caption-1">{children}</span>
);

function ReplyChip({ id }: { id: string }): ReactNode {
  return (
    <span className="mr-1.5 inline-flex max-w-48 items-center gap-1 rounded-[6px] bg-[var(--fill-tertiary)] px-1.5 text-caption-2 text-[var(--label-tertiary)]">
      <span aria-hidden="true">↩</span>
      <span className="truncate">in reply to {id}</span>
    </span>
  );
}

/**
 * Message text, with links and nicks picked out.
 *
 * A server line that contains a mode string or a numeric gets a decoder around
 * it — that is where the arcana actually appears in the flow of the interface,
 * and where somebody who does not recognise it will be looking.
 */
function Body({
  text,
  kind,
  isMember,
  fold,
  onOpenLink,
}: {
  text: string;
  kind: Message['kind'];
  isMember: ((word: string) => boolean) | undefined;
  fold: ((nick: string) => string) | undefined;
  onOpenLink?: (href: string) => void;
}): ReactNode {
  if (kind === 'mode' || kind === 'server' || kind === 'error') {
    return <WithDecoder text={text} />;
  }

  return (
    <>
      {segment(text, isMember).map((part, index) => (
        // Segments have no identity of their own; their position in the line is
        // what they are.
        <Piece
          key={index}
          part={part}
          fold={fold}
          {...(onOpenLink === undefined ? {} : { onOpenLink })}
        />
      ))}
    </>
  );
}

function Piece({
  part,
  fold,
  onOpenLink,
}: {
  part: TextSegment;
  fold: ((nick: string) => string) | undefined;
  onOpenLink?: (href: string) => void;
}): ReactNode {
  switch (part.kind) {
    case 'link':
      return (
        <a
          href={part.href}
          target="_blank"
          rel="noreferrer noopener"
          // The interface confirms the link before anything opens: a click is
          // intercepted so the warning can be shown, rather than the webview
          // trying to navigate to it itself — which it cannot. The href stays so
          // the link reads as one and can be copied from the context menu.
          onClick={
            onOpenLink === undefined
              ? undefined
              : (event) => {
                  event.preventDefault();
                  onOpenLink(part.href);
                }
          }
          className="text-[var(--accent)] underline underline-offset-2"
        >
          {part.text}
        </a>
      );
    case 'nick':
      return (
        <span style={{ color: `var(${nickColorVar(part.text, fold?.(part.text))})` }}>
          {part.text}
        </span>
      );
    case 'text':
      return part.text;
  }
}

/** A mode string inside a sentence, e.g. "jonquil set +mnt". */
const MODE_IN_TEXT = /(^|\s)([+-][A-Za-z]+)(?=$|\s)/;

function WithDecoder({ text }: { text: string }): ReactNode {
  const match = MODE_IN_TEXT.exec(text);
  if (match === null || match[2] === undefined) {
    return text;
  }
  const start = match.index + (match[1]?.length ?? 0);
  const token = match[2];

  return (
    <>
      {text.slice(0, start)}
      <Decoder token={token} />
      {text.slice(start + token.length)}
    </>
  );
}
