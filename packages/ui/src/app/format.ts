/**
 * Turning message text into the pieces the message list renders.
 *
 * Two jobs, both of which have to be done before anything reaches the DOM:
 * finding links so they can be made clickable, and stripping the mIRC
 * formatting codes that would otherwise show up as control characters in the
 * middle of a sentence.
 */

export type TextSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string }
  /** A nick that is in the channel, so it can be coloured and clickable. */
  | { readonly kind: 'nick'; readonly text: string };

/**
 * mIRC formatting control codes.
 *
 * Bold, italic, underline, strikethrough, monospace, reverse, reset, and the
 * two colour forms. Colour takes an optional `fg[,bg]` numeric argument, and
 * the hex form takes six hex digits — both have to be consumed with the code
 * itself, or the digits are left stranded in the middle of the sentence.
 */
const CONTROL =
  // eslint-disable-next-line no-control-regex
  /\x03(\d{1,2}(,\d{1,2})?)?|\x04([0-9A-Fa-f]{6}(,[0-9A-Fa-f]{6})?)?|[\x02\x0F\x11\x16\x1D\x1E\x1F]/g;

/** Removes formatting codes, leaving the words. */
export function stripFormatting(text: string): string {
  return text.replace(CONTROL, '');
}

/**
 * A conservative URL matcher.
 *
 * Deliberately narrow: it takes explicit schemes only, so `example.com` in the
 * middle of a sentence is not turned into a link somebody might click by
 * accident. Trailing punctuation is left out of the link, because a URL at the
 * end of a sentence is followed by a full stop far more often than it contains
 * one.
 */
const URL_PATTERN = /\b(https?|ircs?):\/\/[^\s<>"']+/gi;

const TRAILING = /[.,;:!?)\]}'"]+$/;

/** Splits text into links and the words around them. */
export function linkify(text: string): readonly TextSegment[] {
  const segments: TextSegment[] = [];
  let index = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    if (start === undefined) {
      continue;
    }
    let href = match[0];
    // A closing bracket only belongs to the URL if it opened inside it.
    const trailing = TRAILING.exec(href);
    let tail = '';
    if (trailing !== null) {
      const candidate = href.slice(0, trailing.index);
      if (balanced(candidate)) {
        tail = href.slice(trailing.index);
        href = candidate;
      }
    }

    if (start > index) {
      segments.push({ kind: 'text', text: text.slice(index, start) });
    }
    segments.push({ kind: 'link', text: href, href });
    if (tail !== '') {
      segments.push({ kind: 'text', text: tail });
    }
    index = start + match[0].length;
  }

  if (index < text.length) {
    segments.push({ kind: 'text', text: text.slice(index) });
  }
  return segments;
}

const balanced = (text: string): boolean => {
  const opens = (text.match(/\(/g) ?? []).length;
  const closes = (text.match(/\)/g) ?? []).length;
  return opens === closes;
};

/**
 * Splits text into links, nicks present in the channel, and everything else.
 *
 * Nicks are matched only against people actually in the channel, so an ordinary
 * word never becomes a false mention — and the matching is casemapped by the
 * caller, which knows the network's rules.
 */
export function segment(
  text: string,
  isMember: (word: string) => boolean = () => false,
): readonly TextSegment[] {
  return linkify(stripFormatting(text)).flatMap((part) =>
    part.kind === 'text' ? splitNicks(part.text, isMember) : [part],
  );
}

/** Characters IRC allows in a nick beyond the usual word characters. */
const NICK_WORD = /([\w[\]\\`^{|}-]+)/g;

function splitNicks(text: string, isMember: (word: string) => boolean): readonly TextSegment[] {
  const segments: TextSegment[] = [];
  let index = 0;

  for (const match of text.matchAll(NICK_WORD)) {
    const start = match.index;
    const word = match[0];
    if (start === undefined || !isMember(word)) {
      continue;
    }
    if (start > index) {
      segments.push({ kind: 'text', text: text.slice(index, start) });
    }
    segments.push({ kind: 'nick', text: word });
    index = start + word.length;
  }

  if (index < text.length) {
    segments.push({ kind: 'text', text: text.slice(index) });
  }
  return segments.length === 0 ? [{ kind: 'text', text }] : segments;
}

/** A timestamp in the fixed-width form the message list's first column uses. */
export function formatTime(at: Date, withSeconds = false): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const base = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return withSeconds ? `${base}:${pad(at.getSeconds())}` : base;
}

/** A date heading, for the separator between days. */
export function formatDay(at: Date, today: Date = new Date()): string {
  const sameDay = (left: Date, right: Date): boolean =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

  if (sameDay(at, today)) {
    return 'Today';
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(at, yesterday)) {
    return 'Yesterday';
  }
  return at.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * A span of idle time as words, for the profile card.
 *
 * WHOIS gives idle as a raw second count; "idle 8124 seconds" is exactly the
 * kind of protocol residue the interface is meant to spare people, so it becomes
 * "2 hours, 15 minutes". Only the two largest units are shown — past a couple of
 * hours nobody cares about the seconds.
 */
export function formatIdle(seconds: number): string {
  if (seconds < 60) {
    return seconds === 1 ? '1 second' : `${seconds} seconds`;
  }

  const units: readonly [label: string, size: number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  const parts: string[] = [];
  let remaining = Math.floor(seconds);
  for (const [label, size] of units) {
    const value = Math.floor(remaining / size);
    if (value > 0) {
      parts.push(value === 1 ? `1 ${label}` : `${value} ${label}s`);
      remaining -= value * size;
    }
    if (parts.length === 2) {
      break;
    }
  }
  return parts.join(', ');
}

/** Truncates a nick to the column width, so the message edge stays straight. */
export function fitNick(nick: string, width: number): string {
  return nick.length <= width ? nick : `${nick.slice(0, Math.max(1, width - 1))}…`;
}
