/**
 * `draft/chathistory` request construction.
 *
 * https://ircv3.net/specs/extensions/chathistory
 *
 * The server holds scrollback; this is how the client asks for a page of it.
 * The web build has no local storage at all, so on a network offering history
 * this is the only scrollback that exists — which is why the request has to be
 * built against what the server actually advertises rather than a fixed shape.
 *
 * Two things vary per network and are read from ISUPPORT rather than assumed:
 * `CHATHISTORY=<max>` caps how many messages one request may ask for, and
 * `MSGREFTYPES` says whether a page boundary may be expressed as a `msgid` at
 * all. Sending a `msgid=` selector to a server that only accepts timestamps
 * does not error — it returns the wrong page.
 */

import type { ISupport } from './isupport.js';

/** Which direction a page is taken in, relative to its selector. */
export type ChatHistorySubcommand = 'BEFORE' | 'AFTER' | 'LATEST' | 'AROUND' | 'BETWEEN';

/**
 * A point in a conversation, used as a page boundary.
 *
 * `latest` is the `*` selector: "wherever the conversation currently ends".
 */
export type MessageRef =
  | { readonly kind: 'timestamp'; readonly at: Date }
  | { readonly kind: 'msgid'; readonly id: string }
  | { readonly kind: 'latest' };

export const LATEST: MessageRef = { kind: 'latest' };

/** How many messages to ask for when nothing else is specified. */
export const DEFAULT_HISTORY_PAGE = 100;

/** Whether the network offers server-side history. */
export function supportsChatHistory(support: ISupport): boolean {
  return support.chatHistory !== undefined;
}

/**
 * The largest page this server will serve.
 *
 * `CHATHISTORY=0` means the server states no ceiling, so our own default page
 * size is the only limit worth applying.
 */
export function maxHistoryPage(support: ISupport): number {
  const advertised = support.chatHistory;
  if (advertised === undefined || advertised === 0) {
    return DEFAULT_HISTORY_PAGE;
  }
  return advertised;
}

/** Clamps a requested page size to what the server will serve. */
export function clampHistoryPage(requested: number, support: ISupport): number {
  const ceiling = maxHistoryPage(support);
  if (!Number.isFinite(requested) || requested < 1) {
    return Math.min(DEFAULT_HISTORY_PAGE, ceiling);
  }
  return Math.min(Math.floor(requested), ceiling);
}

/** The ISO-8601 form the spec requires, in UTC with milliseconds. */
export function formatHistoryTimestamp(at: Date): string {
  return at.toISOString();
}

/**
 * Renders a reference as a selector.
 *
 * Returns undefined when the server does not accept this reference type, so a
 * caller cannot send a selector the server will silently misread.
 */
export function formatMessageRef(ref: MessageRef, support: ISupport): string | undefined {
  switch (ref.kind) {
    case 'latest':
      return '*';
    case 'timestamp':
      return support.msgRefTypes.includes('timestamp')
        ? `timestamp=${formatHistoryTimestamp(ref.at)}`
        : undefined;
    case 'msgid':
      return support.msgRefTypes.includes('msgid') ? `msgid=${ref.id}` : undefined;
  }
}

export interface ChatHistoryRequest {
  readonly subcommand: ChatHistorySubcommand;
  readonly target: string;
  readonly from: MessageRef;
  /** Only used by `BETWEEN`, which needs both ends of the range. */
  readonly to?: MessageRef;
  readonly limit?: number;
}

export type ChatHistoryLine =
  | { readonly ok: true; readonly line: string; readonly limit: number }
  /**
   * The request cannot be expressed against this server: it offers no history,
   * or does not accept the reference type the caller asked to page by.
   */
  | { readonly ok: false; readonly reason: 'unsupported' | 'unsupported-ref-type' };

/**
 * Builds one `CHATHISTORY` line.
 *
 * The returned limit is the clamped one, which the caller needs: a page that
 * comes back shorter than what was asked for is how the client learns it has
 * reached the start of the conversation.
 */
export function chatHistoryLine(request: ChatHistoryRequest, support: ISupport): ChatHistoryLine {
  if (!supportsChatHistory(support)) {
    return { ok: false, reason: 'unsupported' };
  }

  const from = formatMessageRef(request.from, support);
  if (from === undefined) {
    return { ok: false, reason: 'unsupported-ref-type' };
  }

  const limit = clampHistoryPage(request.limit ?? DEFAULT_HISTORY_PAGE, support);
  const parts = ['CHATHISTORY', request.subcommand, request.target, from];

  if (request.subcommand === 'BETWEEN') {
    const to = formatMessageRef(request.to ?? LATEST, support);
    if (to === undefined) {
      return { ok: false, reason: 'unsupported-ref-type' };
    }
    parts.push(to);
  }

  parts.push(String(limit));
  return { ok: true, line: parts.join(' '), limit };
}

/** The newest page of a conversation, which is what a fresh join wants. */
export function latestHistoryLine(
  target: string,
  support: ISupport,
  limit?: number,
): ChatHistoryLine {
  return chatHistoryLine(
    limit === undefined
      ? { subcommand: 'LATEST', target, from: LATEST }
      : { subcommand: 'LATEST', target, from: LATEST, limit },
    support,
  );
}

/** The page before a known point, which is what scrolling upward wants. */
export function olderHistoryLine(
  target: string,
  before: MessageRef,
  support: ISupport,
  limit?: number,
): ChatHistoryLine {
  return chatHistoryLine(
    limit === undefined
      ? { subcommand: 'BEFORE', target, from: before }
      : { subcommand: 'BEFORE', target, from: before, limit },
    support,
  );
}

/**
 * The page between a known point and now.
 *
 * This is the reconnect case: the client knows the last message it saw and
 * needs whatever happened while it was gone, rather than a fixed-size page
 * that may not reach back far enough.
 */
export function missedHistoryLine(
  target: string,
  since: MessageRef,
  support: ISupport,
  limit?: number,
): ChatHistoryLine {
  return chatHistoryLine(
    limit === undefined
      ? { subcommand: 'AFTER', target, from: since }
      : { subcommand: 'AFTER', target, from: since, limit },
    support,
  );
}

/**
 * Conversations with activity in a window, for deciding which query tabs to
 * reopen after a reconnect.
 *
 * `TARGETS` takes two timestamps and no target, so it does not go through
 * `chatHistoryLine`.
 */
export function historyTargetsLine(
  after: Date,
  before: Date,
  support: ISupport,
  limit?: number,
): ChatHistoryLine {
  if (!supportsChatHistory(support)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (!support.msgRefTypes.includes('timestamp')) {
    return { ok: false, reason: 'unsupported-ref-type' };
  }

  const clamped = clampHistoryPage(limit ?? DEFAULT_HISTORY_PAGE, support);
  const line = [
    'CHATHISTORY',
    'TARGETS',
    `timestamp=${formatHistoryTimestamp(after)}`,
    `timestamp=${formatHistoryTimestamp(before)}`,
    String(clamped),
  ].join(' ');

  return { ok: true, line, limit: clamped };
}
