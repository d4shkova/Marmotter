/**
 * What the notices at the bottom of the screen do when they pile up.
 *
 * Pure, and kept out of the shell, because the rules are the whole of the
 * behaviour: which notices are the same notice, what happens to one already on
 * screen when it is said again, and how many may be there at once. None of that
 * needs a rendered client to reason about or to test.
 *
 * Nothing here holds message content. A notice is the interface talking about
 * itself — what it did, what failed — never what anybody said.
 */

import type { ToastMessage, ToastTone } from '../primitives/Toast.js';
import type { Pane } from './view-store.js';

/**
 * How many notices may sit on screen at once, oldest dropped first.
 *
 * Four is about the tallest stack that still leaves the client visible on a
 * phone. With repeats folding together, reaching it means four genuinely
 * different things happened at once, which is already unusual.
 */
export const MAX_NOTICES = 4;

/**
 * Whether a download getting on with itself is worth saying out loud.
 *
 * Requesting a pack, a file arriving, a transfer stopped: the row in the file
 * list shows every one of those, in the same words the button used. Saying it
 * again over the top of the very list that is showing it is noise, and a queue
 * of files turned that into a wall of it. Anywhere else in the client there is
 * nothing else showing it, so there it is said.
 *
 * Only for the ones that report progress. A failure wants a decision, and the
 * row's one truncated line is not where that gets made, so those are always
 * raised.
 */
export function shouldAnnounceDownload(pane: Pane): boolean {
  return pane !== 'dcc';
}

/** Something the interface wants to say, and what it counts as a repeat of. */
export interface Notice {
  /**
   * What happened. A function is given how many notices have folded into this
   * one, for a group whose wording depends on it — one file or several.
   */
  readonly text: string | ((repeats: number) => string);
  readonly tone?: ToastTone;
  readonly action?: ToastMessage['action'];
  /** Stays until dismissed. For a notice that asks rather than reports. */
  readonly persistent?: boolean;
  /**
   * What counts as the same notice. Defaults to the message itself, so
   * identical notices coalesce without anybody having to arrange it.
   */
  readonly key?: string;
}

/** A notice on screen, with the bookkeeping that folds repeats into it. */
export interface ShellNotice extends ToastMessage {
  readonly key: string;
  /** How many notices have folded into this one, this one included. */
  readonly repeats: number;
}

/** The text a notice resolves to at a given number of repeats. */
export function noticeText(text: Notice['text'], repeats: number): string {
  return typeof text === 'function' ? text(repeats) : text;
}

/** What a notice is grouped under when it does not say. */
export function noticeKey(notice: Notice): string {
  return notice.key ?? `${notice.tone ?? 'info'}:${noticeText(notice.text, 1)}`;
}

/**
 * Adds a notice to those on screen, folding it into one saying the same thing.
 *
 * Notices arrive in storms, and a stack of identical ones is worse than
 * useless: a serving bot re-offers a pack every few seconds, so one file that
 * will not transfer used to produce a fresh "Couldn't download" on every retry,
 * and a network that is down reports every attempt. A repeat replaces the
 * notice it repeats, in place — moving it would shuffle the stack under
 * somebody reading the one above — and takes a new id, so the countdown starts
 * again and the newest word on a situation is the one being timed.
 *
 * `id` is supplied rather than generated so this stays a pure function.
 */
export function foldNotice(
  current: readonly ShellNotice[],
  notice: Notice,
  id: string,
  max: number = MAX_NOTICES,
): readonly ShellNotice[] {
  const key = noticeKey(notice);
  const at = current.findIndex((entry) => entry.key === key);
  const existing = at === -1 ? undefined : current[at];
  const repeats = (existing?.repeats ?? 0) + 1;

  const raised: ShellNotice = {
    id,
    key,
    repeats,
    text: noticeText(notice.text, repeats),
    tone: notice.tone ?? 'info',
    ...(notice.action === undefined ? {} : { action: notice.action }),
    ...(notice.persistent === true ? { persistent: true } : {}),
  };

  if (existing !== undefined) {
    return current.map((entry, index) => (index === at ? raised : entry));
  }
  // Oldest first out. Without a ceiling a burst of unrelated notices — a network
  // dropping while a queue of downloads lands — walks up the screen and covers
  // the client it is meant to be commenting on.
  return [...current, raised].slice(-max);
}
