/**
 * The command bar.
 *
 * CLAUDE.md requires both escape hatches from the first release: every standard
 * slash command, and `/quote` and `/raw` for arbitrary lines. Each carries its
 * own documentation, because a command bar that autocompletes without
 * explaining is only useful to somebody who already knew the command.
 *
 * The abstraction layer above this is the point of the product; these are for
 * the people who want the wire.
 */

export interface CommandSpec {
  readonly name: string;
  /** Parameter shape, shown as a hint: `<channel> [reason]`. */
  readonly params: string;
  /** What it does, in the interface's voice. */
  readonly summary: string;
  /** Where the same thing lives in the interface, when it does. */
  readonly alsoAt?: string;
  readonly aliases?: readonly string[];
  /** Builds the line to send. Undefined means the app handles it itself. */
  readonly build?: (args: string, context: CommandContext) => string | undefined;
}

export interface CommandContext {
  /** The conversation the command was typed in. */
  readonly target: string | undefined;
  readonly nick: string;
}

const rest = (args: string): string => args.trim();
const first = (args: string): string => args.trim().split(/\s+/)[0] ?? '';
const after = (args: string): string => args.trim().split(/\s+(.*)/)[1] ?? '';

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'join',
    params: '<channel> [password]',
    summary: 'Joins a channel, creating it if nobody is there.',
    alsoAt: 'Browse channels',
    aliases: ['j'],
    build: (args) => `JOIN ${rest(args)}`,
  },
  {
    name: 'part',
    params: '[channel] [reason]',
    summary: 'Leaves a channel.',
    aliases: ['leave'],
    build: (args, context) => {
      const target = first(args) === '' ? (context.target ?? '') : first(args);
      const reason = first(args) === '' ? rest(args) : after(args);
      return reason === '' ? `PART ${target}` : `PART ${target} :${reason}`;
    },
  },
  {
    name: 'msg',
    params: '<person> <message>',
    summary: 'Sends a private message.',
    build: (args) => `PRIVMSG ${first(args)} :${after(args)}`,
  },
  {
    name: 'me',
    params: '<action>',
    summary: 'Writes about yourself rather than saying something aloud.',
    build: (args, context) =>
      context.target === undefined ? undefined : `PRIVMSG ${context.target} :ACTION ${rest(args)}`,
  },
  {
    name: 'nick',
    params: '<name>',
    summary: 'Changes the name other people see.',
    alsoAt: 'Account menu',
    build: (args) => `NICK ${first(args)}`,
  },
  {
    name: 'topic',
    params: '[text]',
    summary: 'Reads or sets the channel topic.',
    alsoAt: 'Channel settings',
    build: (args, context) =>
      context.target === undefined
        ? undefined
        : rest(args) === ''
          ? `TOPIC ${context.target}`
          : `TOPIC ${context.target} :${rest(args)}`,
  },
  {
    name: 'kick',
    params: '<person> [reason]',
    summary: 'Removes somebody from the channel. They can rejoin.',
    alsoAt: 'Member menu → Remove',
    build: (args, context) => {
      if (context.target === undefined) {
        return undefined;
      }
      const reason = after(args);
      return reason === ''
        ? `KICK ${context.target} ${first(args)}`
        : `KICK ${context.target} ${first(args)} :${reason}`;
    },
  },
  {
    name: 'ban',
    params: '<mask>',
    summary: 'Stops anyone matching from joining or speaking.',
    alsoAt: 'Member menu → Ban',
    build: (args, context) =>
      context.target === undefined ? undefined : `MODE ${context.target} +b ${first(args)}`,
  },
  {
    name: 'invite',
    params: '<person> [channel]',
    summary: 'Invites somebody into a channel.',
    alsoAt: 'Channel menu → Invite',
    build: (args, context) => {
      const channel = first(after(args)) === '' ? (context.target ?? '') : first(after(args));
      return `INVITE ${first(args)} ${channel}`;
    },
  },
  {
    name: 'whois',
    params: '<person>',
    summary: 'Shows what the network knows about somebody.',
    alsoAt: 'Click a name',
    build: (args) => `WHOIS ${first(args)}`,
  },
  {
    name: 'away',
    params: '[message]',
    summary: 'Marks you away, or back when given nothing.',
    alsoAt: 'Account menu',
    build: (args) => (rest(args) === '' ? 'AWAY' : `AWAY :${rest(args)}`),
  },
  {
    name: 'list',
    params: '[pattern]',
    summary: 'Lists the channels on this network.',
    alsoAt: 'Browse channels',
    build: (args) => (rest(args) === '' ? 'LIST' : `LIST ${rest(args)}`),
  },
  {
    name: 'notice',
    params: '<target> <message>',
    summary: 'Sends a notice, which clients show differently from a message.',
    build: (args) => `NOTICE ${first(args)} :${after(args)}`,
  },
  {
    name: 'mode',
    params: '<target> <changes>',
    summary: 'Changes settings on a channel or on yourself.',
    alsoAt: 'Channel settings',
    build: (args) => `MODE ${rest(args)}`,
  },
  {
    name: 'quit',
    params: '[reason]',
    summary: 'Disconnects from this network.',
    build: (args) => (rest(args) === '' ? 'QUIT' : `QUIT :${rest(args)}`),
  },
  {
    name: 'quote',
    params: '<line>',
    summary: 'Sends a line to the server exactly as typed.',
    aliases: ['raw'],
    build: (args) => rest(args),
  },
];

const BY_NAME = new Map<string, CommandSpec>(
  COMMANDS.flatMap((command) => [
    [command.name, command] as const,
    ...(command.aliases ?? []).map((alias) => [alias, command] as const),
  ]),
);

/** Looks a command up by name or alias. */
export function findCommand(name: string): CommandSpec | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** Commands whose name or alias starts with a prefix, for autocomplete. */
export function suggestCommands(prefix: string): readonly CommandSpec[] {
  const needle = prefix.toLowerCase().replace(/^\//, '');
  if (needle === '') {
    return COMMANDS;
  }
  return COMMANDS.filter(
    (command) =>
      command.name.startsWith(needle) ||
      (command.aliases ?? []).some((alias) => alias.startsWith(needle)),
  );
}

export type ParsedInput =
  /** Ordinary text, to be sent to the current conversation. */
  | { readonly kind: 'message'; readonly text: string }
  /** A recognised command, already turned into a line. */
  | { readonly kind: 'line'; readonly line: string; readonly command: CommandSpec }
  /** A recognised command the app has to handle itself. */
  | { readonly kind: 'handled'; readonly command: CommandSpec; readonly args: string }
  | { readonly kind: 'unknown'; readonly name: string };

/**
 * Turns what the user typed into what to do with it.
 *
 * `//text` sends a literal line starting with a slash, which is the standard
 * escape and the only way to say something that begins with one.
 */
export function parseInput(input: string, context: CommandContext): ParsedInput {
  if (!input.startsWith('/')) {
    return { kind: 'message', text: input };
  }
  if (input.startsWith('//')) {
    return { kind: 'message', text: input.slice(1) };
  }

  const [, name = '', args = ''] = /^\/(\S*)\s*([\s\S]*)$/.exec(input) ?? [];
  const command = findCommand(name);
  if (command === undefined) {
    return { kind: 'unknown', name };
  }
  if (command.build === undefined) {
    return { kind: 'handled', command, args };
  }

  const line = command.build(args, context);
  return line === undefined || line === ''
    ? { kind: 'handled', command, args }
    : { kind: 'line', line, command };
}
