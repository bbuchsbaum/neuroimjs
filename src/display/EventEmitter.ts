/**
 * Type-safe event emitter
 * 
 * @example
 * interface MyEvents {
 *   'update': [data: UpdateData];
 *   'error': [error: Error, code: number];
 *   'ready': [];
 * }
 * 
 * const emitter = new EventEmitter<MyEvents>();
 * emitter.on('update', (data) => console.log(data));
 * emitter.emit('update', updateData);
 */
export class EventEmitter<TEvents extends Record<string, unknown[]> = Record<string, unknown[]>> {
  private _events: { [K in keyof TEvents]?: Array<(...args: TEvents[K]) => void> } = {};

  /**
   * Subscribe to an event
   * @param event Event name
   * @param listener Event handler
   * @returns Unsubscribe function
   */
  public on<K extends keyof TEvents>(
    event: K,
    listener: (...args: TEvents[K]) => void
  ): () => void {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event]!.push(listener);
    return () => this.removeListener(event, listener);
  }

  /**
   * Emit an event
   * @param event Event name
   * @param args Event arguments
   */
  public emit<K extends keyof TEvents>(event: K, ...args: TEvents[K]): void {
    if (this._events[event]) {
      // Create a copy of listeners array to handle modifications during emit
      const listeners = [...this._events[event]!];
      let firstError: Error | null = null;
      
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch (error) {
          // Capture first error but continue executing other listeners
          if (!firstError) {
            firstError = error as Error;
          }
        }
      }
      
      // Throw the first error after all listeners have been called
      if (firstError) {
        throw firstError;
      }
    }
  }

  /**
   * Subscribe to an event for a single firing only.
   * The listener is automatically removed after the first emit.
   * @param event Event name
   * @param listener Event handler
   * @returns Unsubscribe function
   */
  public once<K extends keyof TEvents>(
    event: K,
    listener: (...args: TEvents[K]) => void
  ): () => void {
    const wrapper = (...args: TEvents[K]) => {
      unsubscribe();
      listener(...args);
    };
    const unsubscribe = this.on(event, wrapper);
    return unsubscribe;
  }

  /**
   * Remove a specific listener
   * @param event Event name
   * @param listenerToRemove Listener to remove
   */
  public removeListener<K extends keyof TEvents>(
    event: K,
    listenerToRemove: (...args: TEvents[K]) => void
  ): void {
    if (this._events[event]) {
      this._events[event] = this._events[event]!.filter(
        (listener) => listener !== listenerToRemove
      );
      // Remove empty arrays to clean up memory
      if (this._events[event]!.length === 0) {
        delete this._events[event];
      }
    }
  }

  /**
   * Remove all listeners for an event
   * @param event Event name (optional, if not provided, removes all)
   */
  public removeAllListeners<K extends keyof TEvents>(event?: K): void {
    if (event) {
      delete this._events[event];
    } else {
      this._events = {};
    }
  }

  /**
   * Get the number of listeners for an event
   * @param event Event name
   * @returns Number of listeners
   */
  public listenerCount<K extends keyof TEvents>(event: K): number {
    return this._events[event]?.length || 0;
  }

  /**
   * Get all event names that have listeners
   * @returns Array of event names
   */
  public eventNames(): Array<keyof TEvents> {
    return Object.keys(this._events) as Array<keyof TEvents>;
  }
}

/**
 * For backward compatibility - non-generic version
 */
export class UntypedEventEmitter extends EventEmitter<Record<string, unknown[]>> {}