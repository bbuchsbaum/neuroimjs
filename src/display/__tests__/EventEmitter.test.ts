/**
 * Test suite for EventEmitter
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter, UntypedEventEmitter } from '../EventEmitter';

// Define test event types
interface TestEvents {
  [event: string]: unknown[];
  'update': [data: { value: number }];
  'error': [error: Error, code: number];
  'ready': [];
  'multi': [a: string, b: number, c: boolean];
}

describe('EventEmitter', () => {
  describe('Typed EventEmitter', () => {
    let emitter: EventEmitter<TestEvents>;

    beforeEach(() => {
      emitter = new EventEmitter<TestEvents>();
    });

    it('should add and trigger event listeners', () => {
      const handler = vi.fn();
      emitter.on('update', handler);

      const data = { value: 42 };
      emitter.emit('update', data);

      expect(handler).toHaveBeenCalledWith(data);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple listeners for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on('update', handler1);
      emitter.on('update', handler2);

      const data = { value: 10 };
      emitter.emit('update', data);

      expect(handler1).toHaveBeenCalledWith(data);
      expect(handler2).toHaveBeenCalledWith(data);
    });

    it('should handle events with no arguments', () => {
      const handler = vi.fn();
      emitter.on('ready', handler);

      emitter.emit('ready');

      expect(handler).toHaveBeenCalledWith();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle events with multiple arguments', () => {
      const handler = vi.fn();
      emitter.on('multi', handler);

      emitter.emit('multi', 'test', 123, true);

      expect(handler).toHaveBeenCalledWith('test', 123, true);
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();
      const unsubscribe = emitter.on('update', handler);

      emitter.emit('update', { value: 1 });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      emitter.emit('update', { value: 2 });
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should remove specific listener', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on('update', handler1);
      emitter.on('update', handler2);

      emitter.removeListener('update', handler1);

      emitter.emit('update', { value: 1 });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle removing non-existent listener', () => {
      const handler = vi.fn();
      
      // Should not throw
      expect(() => {
        emitter.removeListener('update', handler);
      }).not.toThrow();
    });

    it('should remove all listeners for an event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const errorHandler = vi.fn();

      emitter.on('update', handler1);
      emitter.on('update', handler2);
      emitter.on('error', errorHandler);

      emitter.removeAllListeners('update');

      emitter.emit('update', { value: 1 });
      emitter.emit('error', new Error('test'), 500);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should remove all listeners', () => {
      const updateHandler = vi.fn();
      const errorHandler = vi.fn();
      const readyHandler = vi.fn();

      emitter.on('update', updateHandler);
      emitter.on('error', errorHandler);
      emitter.on('ready', readyHandler);

      emitter.removeAllListeners();

      emitter.emit('update', { value: 1 });
      emitter.emit('error', new Error('test'), 500);
      emitter.emit('ready');

      expect(updateHandler).not.toHaveBeenCalled();
      expect(errorHandler).not.toHaveBeenCalled();
      expect(readyHandler).not.toHaveBeenCalled();
    });

    it('should count listeners', () => {
      expect(emitter.listenerCount('update')).toBe(0);

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on('update', handler1);
      expect(emitter.listenerCount('update')).toBe(1);

      emitter.on('update', handler2);
      expect(emitter.listenerCount('update')).toBe(2);

      emitter.removeListener('update', handler1);
      expect(emitter.listenerCount('update')).toBe(1);
    });

    it('should get event names', () => {
      expect(emitter.eventNames()).toEqual([]);

      emitter.on('update', vi.fn());
      emitter.on('error', vi.fn());

      const eventNames = emitter.eventNames();
      expect(eventNames).toContain('update');
      expect(eventNames).toContain('error');
      expect(eventNames).toHaveLength(2);
    });

    it('should not emit to removed listeners during emit', () => {
      const results: number[] = [];
      
      const handler1 = () => {
        results.push(1);
        emitter.removeListener('update', handler2);
      };
      
      const handler2 = () => {
        results.push(2);
      };
      
      const handler3 = () => {
        results.push(3);
      };

      emitter.on('update', handler1);
      emitter.on('update', handler2);
      emitter.on('update', handler3);

      emitter.emit('update', { value: 0 });

      expect(results).toEqual([1, 2, 3]); // All handlers called in first emit
      
      results.length = 0;
      emitter.emit('update', { value: 0 });
      
      expect(results).toEqual([1, 3]); // handler2 was removed
    });
  });

  describe('UntypedEventEmitter', () => {
    it('should work without type parameters', () => {
      const emitter = new UntypedEventEmitter();
      const handler = vi.fn();

      emitter.on('test', handler);
      emitter.emit('test', 'arg1', 'arg2', 123);

      expect(handler).toHaveBeenCalledWith('arg1', 'arg2', 123);
    });
  });

  describe('Type Safety', () => {
    it('should enforce correct argument types at compile time', () => {
      const emitter = new EventEmitter<TestEvents>();
      
      // These should compile without errors
      emitter.on('update', (data) => {
        // TypeScript knows data is { value: number }
        const value: number = data.value;
      });
      
      emitter.on('error', (error, code) => {
        // TypeScript knows error is Error and code is number
        const message: string = error.message;
        const errorCode: number = code;
      });
      
      emitter.on('ready', () => {
        // No arguments expected
      });
      
      // Emit with correct types
      emitter.emit('update', { value: 42 });
      emitter.emit('error', new Error('test'), 500);
      emitter.emit('ready');
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory when removing listeners', () => {
      const emitter = new EventEmitter<TestEvents>();
      const handlers: Array<() => void> = [];

      // Add many listeners
      for (let i = 0; i < 1000; i++) {
        const handler = vi.fn();
        handlers.push(handler);
        emitter.on('ready', handler);
      }

      expect(emitter.listenerCount('ready')).toBe(1000);

      // Remove all listeners
      handlers.forEach(handler => {
        emitter.removeListener('ready', handler);
      });

      expect(emitter.listenerCount('ready')).toBe(0);
      expect(emitter.eventNames()).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle circular event emission', () => {
      const emitter = new EventEmitter<TestEvents>();
      let counter = 0;

      emitter.on('update', (data) => {
        counter++;
        if (counter < 3) {
          emitter.emit('update', { value: data.value + 1 });
        }
      });

      emitter.emit('update', { value: 0 });
      expect(counter).toBe(3);
    });

    it('should handle errors in listeners', () => {
      const emitter = new EventEmitter<TestEvents>();
      const handler1 = vi.fn(() => {
        throw new Error('Handler error');
      });
      const handler2 = vi.fn();

      emitter.on('update', handler1);
      emitter.on('update', handler2);

      // Error in handler1 should not prevent handler2 from being called
      expect(() => {
        emitter.emit('update', { value: 1 });
      }).toThrow('Handler error');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should handle adding listener during emit', () => {
      const emitter = new EventEmitter<TestEvents>();
      const results: number[] = [];

      const handler1 = () => {
        results.push(1);
        emitter.on('update', handler2);
      };

      const handler2 = () => {
        results.push(2);
      };

      emitter.on('update', handler1);
      emitter.emit('update', { value: 0 });

      expect(results).toEqual([1]); // handler2 not called in first emit

      results.length = 0;
      emitter.emit('update', { value: 0 });

      expect(results).toEqual([1, 2]); // Both called in second emit
    });
  });
});
