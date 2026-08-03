/**
 * Emoji entry.
 *
 * IRC carries UTF-8, so an emoji is just text — nothing here touches the
 * protocol. What it buys is the entry method every other chat client has and
 * IRC clients historically have not: type `:smi` and pick, or open the picker.
 *
 * The set is deliberately small and hand-picked. A full Unicode table would be
 * several hundred kilobytes in the bundle to serve a long tail nobody reaches
 * for, and the picker's job is to be quick rather than exhaustive. The system
 * emoji keyboard remains available for everything else.
 */

export interface Emoji {
  readonly char: string;
  /** The `:shortcode:` name, without colons. */
  readonly name: string;
  /** Extra words the search matches on. */
  readonly keywords?: readonly string[];
}

export interface EmojiGroup {
  readonly name: string;
  readonly emoji: readonly Emoji[];
}

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    name: 'Smileys',
    emoji: [
      { char: '😀', name: 'grinning', keywords: ['smile', 'happy'] },
      { char: '😄', name: 'smile', keywords: ['happy'] },
      { char: '😅', name: 'sweat_smile', keywords: ['relief'] },
      { char: '🤣', name: 'rofl', keywords: ['laugh'] },
      { char: '😂', name: 'joy', keywords: ['laugh', 'cry'] },
      { char: '🙂', name: 'slightly_smiling_face' },
      { char: '😉', name: 'wink' },
      { char: '😊', name: 'blush' },
      { char: '😍', name: 'heart_eyes', keywords: ['love'] },
      { char: '😘', name: 'kissing_heart' },
      { char: '😜', name: 'stuck_out_tongue_winking_eye' },
      { char: '🤔', name: 'thinking', keywords: ['hmm'] },
      { char: '🤨', name: 'raised_eyebrow', keywords: ['sceptical'] },
      { char: '😐', name: 'neutral_face' },
      { char: '🙄', name: 'roll_eyes' },
      { char: '😴', name: 'sleeping' },
      { char: '😭', name: 'sob', keywords: ['cry'] },
      { char: '😱', name: 'scream' },
      { char: '😰', name: 'anxious', keywords: ['nervous'] },
      { char: '😬', name: 'grimacing' },
      { char: '😳', name: 'flushed' },
      { char: '🥳', name: 'partying_face', keywords: ['celebrate'] },
      { char: '😎', name: 'sunglasses', keywords: ['cool'] },
      { char: '🤷', name: 'shrug' },
      { char: '🤦', name: 'facepalm' },
      { char: '😇', name: 'innocent' },
      { char: '🥺', name: 'pleading_face' },
      { char: '😤', name: 'triumph', keywords: ['huff'] },
      { char: '🤯', name: 'exploding_head', keywords: ['mind blown'] },
      { char: '🫠', name: 'melting_face' },
    ],
  },
  {
    name: 'People',
    emoji: [
      { char: '👋', name: 'wave', keywords: ['hello', 'hi', 'bye'] },
      { char: '👍', name: 'thumbsup', keywords: ['+1', 'yes', 'ok'] },
      { char: '👎', name: 'thumbsdown', keywords: ['-1', 'no'] },
      { char: '👏', name: 'clap', keywords: ['applause'] },
      { char: '🙏', name: 'pray', keywords: ['thanks', 'please'] },
      { char: '🤝', name: 'handshake', keywords: ['deal'] },
      { char: '💪', name: 'muscle' },
      { char: '🫡', name: 'salute' },
      { char: '👀', name: 'eyes', keywords: ['look', 'watching'] },
      { char: '🧠', name: 'brain' },
      { char: '🖖', name: 'vulcan_salute' },
      { char: '✌️', name: 'v', keywords: ['peace'] },
      { char: '🤞', name: 'crossed_fingers', keywords: ['hope'] },
      { char: '👌', name: 'ok_hand' },
      { char: '🫶', name: 'heart_hands' },
    ],
  },
  {
    name: 'Symbols',
    emoji: [
      { char: '❤️', name: 'heart', keywords: ['love'] },
      { char: '💙', name: 'blue_heart' },
      { char: '💔', name: 'broken_heart' },
      { char: '✅', name: 'white_check_mark', keywords: ['done', 'yes'] },
      { char: '❌', name: 'x', keywords: ['no', 'wrong'] },
      { char: '⚠️', name: 'warning' },
      { char: '❓', name: 'question' },
      { char: '❗', name: 'exclamation' },
      { char: '💯', name: '100' },
      { char: '🔥', name: 'fire' },
      { char: '✨', name: 'sparkles' },
      { char: '⭐', name: 'star' },
      { char: '🎉', name: 'tada', keywords: ['party', 'celebrate'] },
      { char: '🚀', name: 'rocket', keywords: ['ship', 'launch'] },
      { char: '🐛', name: 'bug' },
      { char: '💡', name: 'bulb', keywords: ['idea'] },
      { char: '🔒', name: 'lock', keywords: ['secure'] },
      { char: '🔑', name: 'key' },
      { char: '⏰', name: 'alarm_clock' },
      { char: '📎', name: 'paperclip' },
      { char: '🍕', name: 'pizza' },
      { char: '☕', name: 'coffee' },
      { char: '🍺', name: 'beer' },
      { char: '🎂', name: 'cake' },
      { char: '🐧', name: 'penguin', keywords: ['linux'] },
      { char: '🪟', name: 'window', keywords: ['windows'] },
      { char: '🦫', name: 'beaver', keywords: ['marmot', 'marmotter'] },
      { char: '💻', name: 'computer' },
      { char: '📡', name: 'satellite', keywords: ['relay', 'connect'] },
      { char: '🌧️', name: 'rain' },
    ],
  },
];

export const ALL_EMOJI: readonly Emoji[] = EMOJI_GROUPS.flatMap((group) => group.emoji);

const BY_NAME = new Map(ALL_EMOJI.map((entry) => [entry.name, entry] as const));

/** Resolves a `:shortcode:` to its character. */
export function emojiFor(name: string): string | undefined {
  return BY_NAME.get(name.toLowerCase().replace(/^:|:$/g, ''))?.char;
}

/**
 * Emoji whose name or keywords match a prefix.
 *
 * Names that start with the needle rank above ones that merely contain it, so
 * typing `:sm` offers `smile` before `nervous_smile`.
 */
export function suggestEmoji(prefix: string, limit = 8): readonly Emoji[] {
  const needle = prefix.toLowerCase().replace(/^:/, '');
  if (needle === '') {
    return ALL_EMOJI.slice(0, limit);
  }

  const starts: Emoji[] = [];
  const contains: Emoji[] = [];
  for (const entry of ALL_EMOJI) {
    if (entry.name.startsWith(needle)) {
      starts.push(entry);
    } else if (
      entry.name.includes(needle) ||
      (entry.keywords ?? []).some((word) => word.includes(needle))
    ) {
      contains.push(entry);
    }
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Replaces every complete `:shortcode:` in a line with its character.
 *
 * Applied on send, so somebody who types the whole thing without touching the
 * suggestion list gets the same result as somebody who picked from it. An
 * unrecognised shortcode is left exactly as typed — `:%s:` in a snippet of
 * code has to survive being sent.
 */
export function replaceShortcodes(text: string): string {
  return text.replace(/:([a-z0-9_+-]+):/gi, (whole, name: string) => emojiFor(name) ?? whole);
}
