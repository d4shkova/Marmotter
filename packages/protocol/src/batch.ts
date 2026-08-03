/**
 * IRCv3 `batch` and `labeled-response` correlation.
 *
 * https://ircv3.net/specs/extensions/batch
 * https://ircv3.net/specs/extensions/labeled-response
 *
 * A batch groups related messages: chat history, a netsplit's worth of quits,
 * the reply to one command. Without it the interface cannot tell a netsplit from
 * forty people leaving at once, and cannot tell which reply belongs to which
 * request when two are in flight.
 *
 * Batches nest. A `chathistory` batch can contain a `labeled-response` batch, so
 * the tracker keeps a stack rather than a single current batch.
 */

import type { IrcMessage } from './message.js';

export interface Batch {
  /** The reference tag, without the leading `+`. */
  readonly reference: string;
  /** The batch type, e.g. `chathistory`, `netsplit`, `labeled-response`. */
  readonly type: string;
  /** Type-specific parameters, following the type. */
  readonly params: readonly string[];
  /** The enclosing batch's reference, when this batch is nested. */
  readonly parent: string | undefined;
  /** The `label` tag, when this batch answers a labelled command. */
  readonly label: string | undefined;
  readonly messages: readonly IrcMessage[];
}

export type BatchEvent =
  /** A batch opened. Its messages are not available yet. */
  | { readonly kind: 'opened'; readonly batch: Batch }
  /** A batch closed. `batch.messages` holds everything it contained. */
  | { readonly kind: 'closed'; readonly batch: Batch }
  /** A message that belongs to an open batch. Also buffered into the batch. */
  | { readonly kind: 'batched'; readonly reference: string; readonly message: IrcMessage }
  /** An ordinary message, outside any batch. Handle it immediately. */
  | { readonly kind: 'message'; readonly message: IrcMessage };

interface MutableBatch {
  reference: string;
  type: string;
  params: string[];
  parent: string | undefined;
  label: string | undefined;
  messages: IrcMessage[];
}

const freeze = (batch: MutableBatch): Batch => ({
  reference: batch.reference,
  type: batch.type,
  params: [...batch.params],
  parent: batch.parent,
  label: batch.label,
  messages: [...batch.messages],
});

/**
 * Accumulates batched messages and reports each batch once it is complete.
 *
 * Pure and synchronous: feed it every parsed message and act on what it returns.
 */
export class BatchTracker {
  private readonly open = new Map<string, MutableBatch>();

  /** References of every batch currently open, outermost first. */
  get openReferences(): readonly string[] {
    return [...this.open.keys()];
  }

  /** Whether any batch is currently open. */
  get hasOpenBatches(): boolean {
    return this.open.size > 0;
  }

  /** Looks up an open batch. */
  get(reference: string): Batch | undefined {
    const batch = this.open.get(reference);
    return batch === undefined ? undefined : freeze(batch);
  }

  /**
   * Feeds one message.
   *
   * A `BATCH` command opens or closes; anything carrying a `batch` tag is
   * buffered; everything else passes through untouched.
   */
  handle(message: IrcMessage): BatchEvent {
    // Resolved before the command runs, because closing a nested batch removes
    // it from the map while its enclosing batch still needs the message.
    const reference = message.tags.get('batch');
    const enclosing = reference === undefined ? undefined : this.open.get(reference);

    if (message.command === 'BATCH') {
      const event = this.handleBatchCommand(message);
      if (event !== undefined) {
        // A nested batch's open and close are part of the enclosing batch, so
        // the outer batch still reports everything that happened inside it.
        enclosing?.messages.push(message);
        return event;
      }
    }

    if (reference !== undefined && enclosing !== undefined) {
      enclosing.messages.push(message);
      return { kind: 'batched', reference, message };
    }

    // A batch tag naming a batch we never saw open falls through: losing the
    // grouping is better than losing the message.
    return { kind: 'message', message };
  }

  private handleBatchCommand(message: IrcMessage): BatchEvent | undefined {
    const target = message.params[0] ?? '';
    const sign = target[0];
    const reference = target.slice(1);

    if (reference === '') {
      return undefined; // Malformed; fall through to ordinary handling.
    }

    if (sign === '+') {
      const batch: MutableBatch = {
        reference,
        type: message.params[1] ?? '',
        params: message.params.slice(2),
        parent: message.tags.get('batch'),
        label: message.tags.get('label'),
        messages: [],
      };
      this.open.set(reference, batch);
      return { kind: 'opened', batch: freeze(batch) };
    }

    if (sign === '-') {
      const batch = this.open.get(reference);
      if (batch === undefined) {
        return undefined; // Closing a batch we never opened.
      }
      this.open.delete(reference);
      return { kind: 'closed', batch: freeze(batch) };
    }

    return undefined;
  }

  /** Drops every open batch. Call on disconnect so a reconnect starts clean. */
  reset(): void {
    this.open.clear();
  }
}

/** Generates the `label` tag values for labeled-response. */
export class LabelGenerator {
  private counter = 0;

  constructor(private readonly prefix = 'mm') {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}${this.counter.toString(36)}`;
  }
}

export type LabeledResponse =
  /** The command produced messages. */
  | { readonly label: string; readonly kind: 'messages'; readonly messages: readonly IrcMessage[] }
  /** The server acknowledged with no output at all. */
  | { readonly label: string; readonly kind: 'ack' };

/**
 * Correlates replies with the commands that caused them.
 *
 * A labelled command gets back one of three shapes: a single tagged message, a
 * `labeled-response` batch, or a bare `ACK` meaning "done, nothing to say".
 * This flattens all three into one result per label.
 */
export class LabelTracker {
  private readonly pending = new Set<string>();

  /** Records that a label is in flight. */
  expect(label: string): void {
    this.pending.add(label);
  }

  get outstanding(): readonly string[] {
    return [...this.pending];
  }

  /**
   * Feeds a batch event.
   *
   * Returns a completed response when this event finished one, and undefined
   * otherwise.
   */
  handle(event: BatchEvent): LabeledResponse | undefined {
    if (event.kind === 'closed') {
      const label = event.batch.label;
      if (label !== undefined && this.pending.delete(label)) {
        return { label, kind: 'messages', messages: event.batch.messages };
      }
      return undefined;
    }

    if (event.kind !== 'message') {
      return undefined;
    }

    const label = event.message.tags.get('label');
    if (label === undefined || !this.pending.has(label)) {
      return undefined;
    }

    this.pending.delete(label);
    return event.message.command === 'ACK'
      ? { label, kind: 'ack' }
      : { label, kind: 'messages', messages: [event.message] };
  }

  /** Drops every outstanding label. Call on disconnect. */
  reset(): void {
    this.pending.clear();
  }
}
