/**
 * A tiny listener registry shared by the transport implementations.
 *
 * Not an EventEmitter: the `Transport` contract is two specific callbacks, and
 * a general event bus would invite the protocol layer to grow opinions about
 * events the transport should not have.
 */

import type { Unsubscribe } from '@marmotter/shared';

export class Listeners<T> {
  private readonly callbacks = new Set<(value: T) => void>();

  add(callback: (value: T) => void): Unsubscribe {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  get size(): number {
    return this.callbacks.size;
  }

  /**
   * Calls every listener.
   *
   * Iterates a copy so a listener that unsubscribes itself — which the
   * reconnecting wrapper does — cannot skip the next one. A listener that
   * throws must not stop the others, or one bad consumer silently deafens the
   * rest of the app.
   */
  emit(value: T): void {
    for (const callback of [...this.callbacks]) {
      try {
        callback(value);
      } catch (error) {
        console.error('a transport listener threw', error);
      }
    }
  }

  clear(): void {
    this.callbacks.clear();
  }
}
