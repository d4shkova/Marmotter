/**
 * The plaintext log format, and where its files live.
 *
 * CLAUDE.md asks for a layout that mirrors HexChat's, and the reason is
 * practical rather than sentimental: somebody moving to Marmotter brings years
 * of logs, and the tools they already use to read them — grep, an editor, a
 * script they wrote once — should keep working. So this is HexChat's default
 * mask, `<network>/<conversation>.log`, with its default timestamp.
 *
 * Pure string work. Choosing a path does not create it and formatting a line
 * does not write it; the platform's store does both.
 */

import type { LogRecord } from '@marmotter/shared';

/** Two digits, for the timestamp. */
const pad = (value: number): string => String(value).padStart(2, '0');

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * HexChat's default stamp: `MMM DD HH:MM:SS`, in local time.
 *
 * Local rather than UTC because that is what HexChat writes and what somebody
 * reading their own log expects to see; the SQLite store keeps the exact
 * instant alongside, so nothing is lost by the plaintext copy being friendly.
 */
export function stampOf(at: Date): string {
  const month = MONTHS[at.getMonth()] ?? 'Jan';
  return `${month} ${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(
    at.getSeconds(),
  )}`;
}

/**
 * One line, as it appears in the file.
 *
 * The kinds that are not somebody speaking read as events rather than as
 * messages, which is the same distinction the message list draws — a join
 * written as `<tamsin> joined` would be indistinguishable from somebody typing
 * the word.
 */
export function formatLine(record: LogRecord): string {
  const stamp = stampOf(record.at);
  const body = ((): string => {
    switch (record.kind) {
      case 'privmsg':
        return `<${record.nick}>\t${record.text}`;
      case 'action':
        return `*\t${record.nick} ${record.text}`;
      case 'notice':
        return `-${record.nick}-\t${record.text}`;
      case 'join':
        return `*\t${record.nick} has joined`;
      case 'part':
        return `*\t${record.nick} has left${record.text === '' ? '' : ` (${record.text})`}`;
      case 'quit':
        return `*\t${record.nick} has quit${record.text === '' ? '' : ` (${record.text})`}`;
      case 'nick':
        return `*\t${record.nick} is now known as ${record.text}`;
      case 'kick':
        return `*\t${record.text}`;
      case 'mode':
      case 'topic':
      case 'invite':
      case 'server':
        return `*\t${record.text}`;
      default:
        return `*\t${record.text}`;
    }
  })();
  // Newlines inside a message would break one line into several and make the
  // file unparseable. IRC cannot carry one, but a relay or a paste service can
  // put one in a tag, so it is flattened rather than trusted.
  return `${stamp} ${body}`.replace(/\r?\n/g, ' ');
}

/**
 * Characters no platform will accept in a filename.
 *
 * Channel names may legitimately contain most of these — `#foo\bar` is a legal
 * channel — so they are replaced rather than rejected. Windows is the strictest
 * of the three targets, and using its rules everywhere means a log folder
 * copied from Linux to Windows still opens.
 */
// The control range is deliberate: a channel name may carry mIRC formatting
// codes, and a filename with a \x03 in it is one no file manager will show
// and some tools refuse outright. Written as escapes so the source stays text.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[<>:"/\\|?*\x00-\x1f]/g;

/** Windows refuses these as filenames whatever the extension. */
const RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/** A path segment safe on every platform, and still recognisable. */
export function safeSegment(name: string): string {
  const cleaned = name.replace(UNSAFE, '_').replace(/[. ]+$/, '');
  if (cleaned === '') {
    return '_';
  }
  return RESERVED.has(cleaned.toLowerCase()) ? `_${cleaned}` : cleaned;
}

/**
 * The file a record belongs in, relative to the log folder.
 *
 * `<network>/<conversation>.log`, HexChat's default. Server notices go to a
 * file named for the network itself, because they belong to the connection
 * rather than to any conversation.
 */
export function fileFor(record: LogRecord): string {
  const network = safeSegment(record.networkName === '' ? record.networkId : record.networkName);
  const conversation = record.target === '' ? network : safeSegment(record.target);
  return `${network}/${conversation}.log`;
}

/** Groups records by the file they are written to, preserving their order. */
export function groupByFile(
  records: readonly LogRecord[],
): ReadonlyMap<string, readonly LogRecord[]> {
  const grouped = new Map<string, LogRecord[]>();
  for (const record of records) {
    const file = fileFor(record);
    const existing = grouped.get(file);
    if (existing === undefined) {
      grouped.set(file, [record]);
    } else {
      existing.push(record);
    }
  }
  return grouped;
}
