import { createConnection, type Socket } from 'node:net';

/**
 * The CTCP delimiter.
 *
 * Built rather than written: an invisible control character in a source file
 * survives some toolchains and not others, and this one did not survive the
 * test transform — the request went out as plain text and the service
 * reasonably ignored it.
 */
const DELIM = String.fromCharCode(1);

/**
 * A second client, for the tests that need two people.
 *
 * Deliberately not Marmotter: a bug that affects both ends equally would hide
 * from a test where Marmotter talks to itself. This is a socket that knows only
 * enough IRC to register, join, and say things.
 */
export class TestClient {
  private socket: Socket | undefined;
  private buffer = '';
  private readonly lines: string[] = [];

  constructor(readonly nick: string) {}

  async connect(port = 6667): Promise<void> {
    this.socket = createConnection({ host: '127.0.0.1', port });
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      const parts = this.buffer.split('\r\n');
      this.buffer = parts.pop() ?? '';
      for (const line of parts) {
        this.lines.push(line);
        // Answering PING is the one thing that cannot wait for a test to ask.
        if (line.startsWith('PING ')) {
          this.send(`PONG ${line.slice(5)}`);
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.socket?.once('connect', resolve);
      this.socket?.once('error', reject);
    });

    this.send(`NICK ${this.nick}`);
    this.send(`USER ${this.nick} 0 * :${this.nick}`);
    await this.waitFor(/ 001 /);
  }

  send(line: string): void {
    this.socket?.write(`${line}\r\n`);
  }

  say(target: string, text: string): void {
    this.send(`PRIVMSG ${target} :${text}`);
  }

  /** Sends a CTCP request, wrapping it in the delimiters that make it one. */
  ctcp(target: string, request: string): void {
    this.send(`PRIVMSG ${target} :${DELIM}${request}${DELIM}`);
  }

  /** Everything received so far, for assertions about what was never said. */
  linesSoFar(): readonly string[] {
    return [...this.lines];
  }

  /** Forgets what has been received, so a wait cannot match an older reply. */
  clear(): void {
    this.lines.length = 0;
  }

  /**
   * Waits until a nick exists on the network.
   *
   * Services link a moment after the ircd starts listening, so a test that
   * talks to NickServ has to wait for it rather than race it.
   */
  async waitForNick(nick: string, timeoutMs = 30_000): Promise<void> {
    const present = new RegExp(`311 \\S+ ${nick}`, 'i');
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      this.clear();
      this.send(`WHOIS ${nick}`);
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (this.lines.some((line) => present.test(line))) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`${nick} never appeared on the network`);
      }
    }
  }

  /** Waits for a line matching a pattern, or throws after a few seconds. */
  async waitFor(pattern: RegExp, timeoutMs = 10_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.lines.find((line) => pattern.test(line));
      if (found !== undefined) {
        return found;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `no line matched ${pattern.source} within ${timeoutMs}ms. Saw:\n${this.lines.slice(-10).join('\n')}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  close(): void {
    this.send('QUIT');
    this.socket?.destroy();
    this.socket = undefined;
  }
}
