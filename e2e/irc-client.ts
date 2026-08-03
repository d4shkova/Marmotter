import { createConnection, type Socket } from 'node:net';

/**
 * A second client, for the tests that need two people.
 *
 * Deliberately not Marmotter: a bug that affects both ends equally would hide
 * from a test where Marmotter talks to itself. This is thirty lines of socket
 * that knows only enough IRC to register, join, and say things.
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

  /** Sends a CTCP request, delimiters and all. */
  ctcp(target: string, request: string): void {
    this.send(`PRIVMSG ${target} :${request}`);
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
