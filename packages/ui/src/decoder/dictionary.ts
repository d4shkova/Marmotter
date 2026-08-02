/**
 * The decoder's explanation dictionary.
 *
 * This is the file that most directly serves the project's reason for
 * existing. Every entry is one plain-English sentence saying what a piece of
 * IRC arcana *does*, in the words the interface uses everywhere else — never
 * the protocol's own words, and never a definition that only makes sense to
 * somebody who already knew.
 *
 * Rules for adding an entry:
 *
 * - Describe the effect, not the mechanism. "Only ops can change the topic",
 *   not "sets the +t flag".
 * - Say who it affects. "Nobody outside the channel can send to it" beats
 *   "external messages are blocked".
 * - No numerics, no mode letters, no services command names in the sentence
 *   itself. Those are what the reader is looking *up*.
 * - Where an ircd disagrees with its neighbours, the entry says so rather than
 *   picking one and being wrong half the time.
 */

export interface Explanation {
  /** A two-or-three-word name, for the panel heading. */
  readonly title: string;
  /** One sentence. Two only when the second says what to do about it. */
  readonly detail: string;
  /** Set when the meaning genuinely differs between networks. */
  readonly caveat?: string;
}

/**
 * Channel modes that take no parameter.
 *
 * Letters are near-universal across ircds unless noted; a network's real
 * `CHANMODES` decides which exist, and the decoder only ever explains a letter
 * it was actually shown.
 */
export const CHANNEL_FLAG_MODES: ReadonlyMap<string, Explanation> = new Map([
  [
    'm',
    {
      title: 'Moderated',
      detail: 'Only people with voice or a higher role can send messages.',
    },
  ],
  [
    'n',
    {
      title: 'No outside messages',
      detail: 'Only people who have joined the channel can send to it.',
    },
  ],
  ['t', { title: 'Topic locked', detail: 'Only operators and above can change the topic.' }],
  [
    'i',
    {
      title: 'Invite only',
      detail: 'People can only join if somebody already inside invites them.',
    },
  ],
  [
    's',
    {
      title: 'Secret',
      detail: 'The channel is hidden from the channel list and from other people’s profiles.',
    },
  ],
  [
    'p',
    {
      title: 'Private',
      detail: 'The channel is hidden from the channel list.',
      caveat: 'On some networks this behaves the same as Secret.',
    },
  ],
  ['c', { title: 'No colours', detail: 'Formatting and colour codes are stripped from messages.' }],
  ['C', { title: 'No CTCP', detail: 'Automated requests such as version checks are blocked.' }],
  [
    'r',
    {
      title: 'Registered users only',
      detail: 'Only people logged in to a network account can join.',
    },
  ],
  ['S', { title: 'Secure only', detail: 'Only people connected over TLS can join.' }],
  ['z', { title: 'Secure only', detail: 'Only people connected over TLS can join.' }],
  [
    'D',
    {
      title: 'Delayed join',
      detail: 'People are hidden from the member list until they say something.',
    },
  ],
]);

/** Channel modes that take a value. */
export const CHANNEL_PARAMETER_MODES: ReadonlyMap<string, Explanation> = new Map([
  ['k', { title: 'Password', detail: 'A password is needed to join.' }],
  ['l', { title: 'Member limit', detail: 'The channel stops accepting new people at a set size.' }],
  [
    'f',
    {
      title: 'Flood protection',
      detail: 'People who send too much too quickly are automatically restricted.',
    },
  ],
  ['j', { title: 'Join throttle', detail: 'Limits how many people can join in a short window.' }],
]);

/** Channel modes that hold a list of masks. */
export const CHANNEL_LIST_MODES: ReadonlyMap<string, Explanation> = new Map([
  ['b', { title: 'Ban', detail: 'People matching this cannot join or send messages.' }],
  [
    'q',
    {
      title: 'Mute',
      detail: 'People matching this can stay in the channel but cannot send messages.',
      caveat: 'A few networks use this letter for channel ownership instead.',
    },
  ],
  ['e', { title: 'Ban exception', detail: 'People matching this are allowed in despite a ban.' }],
  [
    'I',
    {
      title: 'Invite exception',
      detail: 'People matching this can join an invite-only channel without an invitation.',
    },
  ],
]);

/** Modes that grant a role, keyed by mode letter. */
export const ROLE_MODES: ReadonlyMap<string, Explanation> = new Map([
  ['q', { title: 'Owner', detail: 'Full control of the channel, including who else can run it.' }],
  ['a', { title: 'Admin', detail: 'Can manage operators and everything below them.' }],
  [
    'o',
    {
      title: 'Operator',
      detail: 'Can change channel settings, remove people, and manage bans.',
    },
  ],
  [
    'h',
    {
      title: 'Half-op',
      detail: 'Can remove people and manage bans, but not change who is an operator.',
    },
  ],
  ['v', { title: 'Voice', detail: 'Can speak when the channel is moderated.' }],
]);

/** User modes people see on themselves. */
export const USER_MODES: ReadonlyMap<string, Explanation> = new Map([
  [
    'i',
    {
      title: 'Invisible',
      detail: 'You are hidden from searches by people not sharing a channel with you.',
    },
  ],
  ['w', { title: 'Server notices', detail: 'You receive operational notices from the server.' }],
  ['o', { title: 'Server operator', detail: 'You hold network-wide administrative privileges.' }],
  ['x', { title: 'Hidden host', detail: 'Your real address is replaced with a masked one.' }],
  ['Z', { title: 'Secure connection', detail: 'You are connected over TLS.' }],
  [
    'R',
    { title: 'Registered only', detail: 'Only people logged in to an account can message you.' },
  ],
  ['B', { title: 'Bot', detail: 'You are flagged as an automated client.' }],
]);

/**
 * Numerics that reach a person.
 *
 * These are the ones a user can act on. Everything else is consumed into state
 * and never surfaces, so it needs no entry here.
 */
export const NUMERIC_EXPLANATIONS: ReadonlyMap<string, Explanation> = new Map([
  ['401', { title: 'No such person', detail: 'Nobody by that name is connected right now.' }],
  ['403', { title: 'No such channel', detail: 'That channel does not exist on this network.' }],
  ['404', { title: 'Cannot send', detail: 'The channel’s settings stop you sending to it.' }],
  ['421', { title: 'Unknown command', detail: 'This network does not recognise that command.' }],
  [
    '432',
    { title: 'Name not allowed', detail: 'That name contains characters the network refuses.' },
  ],
  ['433', { title: 'Name taken', detail: 'Somebody else is already using that name.' }],
  [
    '437',
    { title: 'Name held', detail: 'That name was recently used and is briefly unavailable.' },
  ],
  ['441', { title: 'Not in channel', detail: 'That person is not in this channel.' }],
  ['442', { title: 'Not in channel', detail: 'You are not in that channel.' }],
  ['461', { title: 'Missing information', detail: 'The command needs more than it was given.' }],
  ['471', { title: 'Channel full', detail: 'The channel has reached its member limit.' }],
  ['473', { title: 'Invite only', detail: 'You need an invitation from somebody already inside.' }],
  ['474', { title: 'Banned', detail: 'A ban on this channel matches you.' }],
  ['475', { title: 'Password needed', detail: 'The channel requires a password to join.' }],
  [
    '477',
    { title: 'Account needed', detail: 'You must be logged in to a network account to join.' },
  ],
  [
    '482',
    {
      title: 'Not an operator',
      detail: 'You need operator privileges in this channel to do that.',
    },
  ],
  [
    '484',
    { title: 'Restricted', detail: 'The network is preventing this action on your connection.' },
  ],
]);

/** Services replies and concepts, which vary by services package. */
export const SERVICES_EXPLANATIONS: ReadonlyMap<string, Explanation> = new Map([
  [
    'nickserv',
    {
      title: 'Account service',
      detail: 'The service that owns account registration and login on this network.',
    },
  ],
  [
    'chanserv',
    {
      title: 'Channel service',
      detail: 'The service that remembers who may run a channel while nobody is in it.',
    },
  ],
  [
    'cloak',
    {
      title: 'Cloak',
      detail:
        'A masked address shown in place of your real one, so other people cannot see where you connect from.',
    },
  ],
  [
    'sasl',
    {
      title: 'Login during connection',
      detail: 'Logs you in as part of connecting, before anyone can see you join.',
    },
  ],
  [
    'certfp',
    {
      title: 'Certificate login',
      detail: 'Logs you in using a certificate on this device instead of a password.',
    },
  ],
  [
    'extban',
    {
      title: 'Extended ban',
      detail: 'A ban that matches something other than an address — an account, or a real name.',
      caveat:
        'The prefix character differs between networks, so the interface reads it from the server.',
    },
  ],
]);

/** CTCP requests, which arrive as ordinary messages but are not conversation. */
export const CTCP_EXPLANATIONS: ReadonlyMap<string, Explanation> = new Map([
  [
    'VERSION',
    { title: 'Version request', detail: 'An automated question asking what client you use.' },
  ],
  [
    'PING',
    { title: 'Round-trip check', detail: 'An automated question measuring the delay between you.' },
  ],
  ['TIME', { title: 'Time request', detail: 'An automated question asking your local time.' }],
  [
    'ACTION',
    { title: 'Action', detail: 'A message written about yourself rather than said aloud.' },
  ],
]);
