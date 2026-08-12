/**
 * The commands NickServ and ChanServ answer to, as a menu a person can pick
 * from rather than a syntax they have to know.
 *
 * These are the services' own commands — `/msg NickServ IDENTIFY …` and the
 * rest — which are exactly the kind of `/msg` incantation CLAUDE.md says the
 * client exists to stop teaching. Offered only in the NickServ and ChanServ
 * conversations, and only to somebody who has said they operate this network,
 * so the operator-level ones are not a menu of alarming verbs in front of
 * everybody else.
 *
 * Picking one drops its shape into the composer — `SET PASSWORD <new password>`
 * — for the person to fill in and send. It is not sent blind: half of these
 * take an argument only the user has, and a services command sent by accident
 * is not one that can always be taken back.
 *
 * The set is Anope's, which is the package `irc.dashkova.co.uk` runs; the same
 * command names carry across Atheme closely enough that the menu is still a head
 * start on a network running that instead, and the raw command bar is always
 * there for anything not listed.
 */

/** One of the two services a person drives from a conversation. */
export type ServiceName = 'nickserv' | 'chanserv';

/** One entry in a service's command menu. */
export interface ServiceCommand {
  /** The command word, e.g. `IDENTIFY`. */
  readonly name: string;
  /** The arguments it takes, as fill-in placeholders. */
  readonly args?: string;
  /** What it does, in the interface's voice. */
  readonly summary: string;
  /** Meaningful only to a network operator, so hidden unless one is asking. */
  readonly operator?: boolean;
}

/**
 * Which service, if either, a conversation is with.
 *
 * Matched case-insensitively on the well-known names, which are plain ASCII on
 * every network, so a folded comparison would only add a dependency without
 * changing the answer.
 */
export function serviceForTarget(target: string | undefined): ServiceName | undefined {
  switch (target?.toLowerCase()) {
    case 'nickserv':
      return 'nickserv';
    case 'chanserv':
      return 'chanserv';
    default:
      return undefined;
  }
}

/** The service's own name as it is addressed, e.g. `NickServ`. */
export function serviceDisplayName(service: ServiceName): string {
  return service === 'nickserv' ? 'NickServ' : 'ChanServ';
}

const NICKSERV_COMMANDS: readonly ServiceCommand[] = [
  { name: 'HELP', summary: 'Lists everything NickServ can do.' },
  {
    name: 'REGISTER',
    args: '<password> <email>',
    summary: 'Registers the name you are using now so it stays yours.',
  },
  {
    name: 'CONFIRM',
    args: '<code>',
    summary: 'Finishes a registration with the code you were emailed.',
  },
  { name: 'IDENTIFY', args: '<password>', summary: 'Signs in to your account for this name.' },
  { name: 'LOGOUT', summary: 'Signs out of your account.' },
  {
    name: 'GROUP',
    args: '<account> <password>',
    summary: 'Links this name to an account you already have.',
  },
  { name: 'UNGROUP', args: '[name]', summary: 'Separates a name from your account again.' },
  { name: 'GLIST', summary: 'Lists every name linked to your account.' },
  { name: 'ALIST', args: '[account]', summary: 'Lists the channels an account has access to.' },
  {
    name: 'ACCESS',
    args: 'ADD|DEL|LIST [mask]',
    summary: 'Addresses that may use your account without a password.',
  },
  {
    name: 'CERT',
    args: 'ADD|DEL|LIST [fingerprint]',
    summary: 'Certificates that sign you in without a password.',
  },
  {
    name: 'AJOIN',
    args: 'ADD|DEL|LIST [#channel]',
    summary: 'Channels joined for you whenever you sign in.',
  },
  { name: 'INFO', args: '<name>', summary: 'Shows what is registered about a name.' },
  {
    name: 'STATUS',
    args: '<name>',
    summary: 'Says whether somebody is signed in as who they say.',
  },
  { name: 'SET', args: '<option> <value>', summary: 'Changes a setting on your account.' },
  {
    name: 'RESETPASS',
    args: '<account> <email>',
    summary: 'Emails a way back in when the password is lost.',
  },
  {
    name: 'GHOST',
    args: '<name> <password>',
    summary: 'Disconnects an old session still holding your name.',
  },
  { name: 'RECOVER', args: '<name>', summary: 'Takes your name back from something using it.' },
  { name: 'UPDATE', summary: 'Refreshes what the service thinks your status is.' },
  { name: 'DROP', args: '<name>', summary: 'Deletes a registration you own.' },

  // Operator-level.
  {
    name: 'SUSPEND',
    args: '<name> <reason>',
    summary: 'Blocks an account from being used.',
    operator: true,
  },
  { name: 'UNSUSPEND', args: '<name>', summary: 'Lifts a suspension.', operator: true },
  {
    name: 'LIST',
    args: '<pattern>',
    summary: 'Lists registered names matching a pattern.',
    operator: true,
  },
  {
    name: 'GETEMAIL',
    args: '<email>',
    summary: 'Finds accounts registered to an email address.',
    operator: true,
  },
  {
    name: 'SASET',
    args: '<account> <option> <value>',
    summary: "Changes a setting on somebody else's account.",
    operator: true,
  },
  {
    name: 'SENDPASS',
    args: '<account>',
    summary: 'Emails an account holder a way back in.',
    operator: true,
  },
];

const CHANSERV_COMMANDS: readonly ServiceCommand[] = [
  { name: 'HELP', summary: 'Lists everything ChanServ can do.' },
  { name: 'REGISTER', args: '<#channel>', summary: 'Registers a channel so it stays yours.' },
  { name: 'INFO', args: '<#channel>', summary: 'Shows what is registered about a channel.' },
  { name: 'SET', args: '<#channel> <option> <value>', summary: 'Changes a channel setting.' },
  { name: 'ACCESS', args: '<#channel> LIST', summary: 'Shows who has access to a channel.' },
  { name: 'FLAGS', args: '<#channel>', summary: 'Shows or changes who may do what.' },
  { name: 'LEVELS', args: '<#channel> LIST', summary: 'Shows what each level of access may do.' },
  {
    name: 'AKICK',
    args: '<#channel> ADD|DEL|LIST <mask>',
    summary: 'Keeps somebody out for good, however they come back.',
  },
  { name: 'OP', args: '<#channel> [name]', summary: 'Gives operator in a channel you control.' },
  { name: 'DEOP', args: '<#channel> [name]', summary: 'Takes operator back.' },
  { name: 'VOICE', args: '<#channel> [name]', summary: 'Gives voice in a channel you control.' },
  { name: 'DEVOICE', args: '<#channel> [name]', summary: 'Takes voice back.' },
  { name: 'UP', args: '<#channel>', summary: 'Takes the roles your access entitles you to.' },
  { name: 'DOWN', args: '<#channel>', summary: 'Drops those roles again for now.' },
  { name: 'INVITE', args: '<#channel>', summary: 'Invites you into a channel you control.' },
  {
    name: 'KICK',
    args: '<#channel> <name> [reason]',
    summary: 'Removes somebody through the service.',
  },
  {
    name: 'BAN',
    args: '<#channel> <name> [reason]',
    summary: 'Bans somebody through the service.',
  },
  { name: 'UNBAN', args: '<#channel> [name]', summary: 'Lifts a ban so somebody can come back.' },
  {
    name: 'CLEAR',
    args: '<#channel> BANS|OPS|VOICES|USERS',
    summary: 'Clears bans, or roles, or everybody, in one go.',
  },
  { name: 'TOPIC', args: '<#channel> <topic>', summary: 'Sets the topic through the service.' },
  {
    name: 'MODE',
    args: '<#channel> LOCK|SET <modes>',
    summary: 'Sets channel settings, or holds them where they are.',
  },
  { name: 'SYNC', args: '<#channel>', summary: "Reapplies everybody's access as it is recorded." },
  { name: 'STATUS', args: '<#channel> <name>', summary: 'Says what access somebody has here.' },
  { name: 'DROP', args: '<#channel>', summary: 'Deletes a channel registration you own.' },

  // Operator-level.
  {
    name: 'SUSPEND',
    args: '<#channel> <reason>',
    summary: 'Blocks a channel from being used.',
    operator: true,
  },
  { name: 'UNSUSPEND', args: '<#channel>', summary: 'Lifts a channel suspension.', operator: true },
  {
    name: 'LIST',
    args: '<pattern>',
    summary: 'Lists registered channels matching a pattern.',
    operator: true,
  },
  {
    name: 'GETKEY',
    args: '<#channel>',
    summary: 'Shows a channel key so you can enter it.',
    operator: true,
  },
  {
    name: 'SASET',
    args: '<#channel> <option> <value>',
    summary: "Changes a setting on somebody else's channel.",
    operator: true,
  },
];

/**
 * The commands for a service.
 *
 * The operator-level ones are dropped unless the caller says an operator is
 * asking — discovery, not permission, the same rule the command bar follows.
 */
export function serviceCommands(
  service: ServiceName,
  options: { readonly operator?: boolean } = {},
): readonly ServiceCommand[] {
  const all = service === 'nickserv' ? NICKSERV_COMMANDS : CHANSERV_COMMANDS;
  return options.operator === true ? all : all.filter((command) => command.operator !== true);
}

/** The line that goes into the composer for a command: its word and its shape. */
export function serviceCommandBody(command: ServiceCommand): string {
  return command.args === undefined ? command.name : `${command.name} ${command.args}`;
}

/** The label a command shows in the menu — the command word and its arguments. */
export function serviceCommandLabel(command: ServiceCommand): string {
  return serviceCommandBody(command);
}
