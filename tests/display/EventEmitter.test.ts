import { describe, test, expect, vi } from 'vitest';
import { EventEmitter, UntypedEventEmitter } from '../../src/display/EventEmitter';

interface TestEvents {
  'update': [data: string];
  'error': [error: Error, code: number];
  'ready': [];
}

describe('EventEmitter', () => {
  test('on() subscribes and emit() fires listener', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on('update', handler);
    emitter.emit('update', 'hello');
    expect(handler).toHaveBeenCalledWith('hello');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('on() returns an unsubscribe function', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    const unsub = emitter.on('update', handler);
    emitter.emit('update', 'a');
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    emitter.emit('update', 'b');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('multiple listeners on same event', () => {
    const emitter = new EventEmitter<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on('update', h1);
    emitter.on('update', h2);
    emitter.emit('update', 'data');
    expect(h1).toHaveBeenCalledWith('data');
    expect(h2).toHaveBeenCalledWith('data');
  });

  test('emit with multiple arguments', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on('error', handler);
    const err = new Error('test');
    emitter.emit('error', err, 42);
    expect(handler).toHaveBeenCalledWith(err, 42);
  });

  test('emit with no arguments (ready event)', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on('ready', handler);
    emitter.emit('ready');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith();
  });

  test('once() fires only once then auto-removes', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.once('update', handler);
    emitter.emit('update', 'first');
    emitter.emit('update', 'second');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('first');
  });

  test('once() returns an unsubscribe function that works before emit', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    const unsub = emitter.once('update', handler);
    unsub();
    emitter.emit('update', 'data');
    expect(handler).not.toHaveBeenCalled();
  });

  test('removeListener removes specific listener', () => {
    const emitter = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on('update', handler);
    emitter.removeListener('update', handler);
    emitter.emit('update', 'data');
    expect(handler).not.toHaveBeenCalled();
  });

  test('removeAllListeners(event) removes all for that event', () => {
    const emitter = new EventEmitter<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on('update', h1);
    emitter.on('update', h2);
    emitter.removeAllListeners('update');
    emitter.emit('update', 'data');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  test('removeAllListeners() removes all events', () => {
    const emitter = new EventEmitter<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on('update', h1);
    emitter.on('ready', h2);
    emitter.removeAllListeners();
    emitter.emit('update', 'data');
    emitter.emit('ready');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  test('listenerCount returns correct count', () => {
    const emitter = new EventEmitter<TestEvents>();
    expect(emitter.listenerCount('update')).toBe(0);
    emitter.on('update', () => {});
    expect(emitter.listenerCount('update')).toBe(1);
    emitter.on('update', () => {});
    expect(emitter.listenerCount('update')).toBe(2);
  });

  test('eventNames returns events with listeners', () => {
    const emitter = new EventEmitter<TestEvents>();
    expect(emitter.eventNames()).toEqual([]);
    emitter.on('update', () => {});
    emitter.on('ready', () => {});
    expect(emitter.eventNames()).toContain('update');
    expect(emitter.eventNames()).toContain('ready');
  });

  test('error in listener propagates after all listeners run', () => {
    const emitter = new EventEmitter<TestEvents>();
    const h1 = vi.fn(() => { throw new Error('boom'); });
    const h2 = vi.fn();
    emitter.on('update', h1);
    emitter.on('update', h2);

    expect(() => emitter.emit('update', 'data')).toThrow('boom');
    // h2 should still have been called
    expect(h2).toHaveBeenCalledWith('data');
  });

  test('emit on non-subscribed event does nothing', () => {
    const emitter = new EventEmitter<TestEvents>();
    // Should not throw
    expect(() => emitter.emit('update', 'data')).not.toThrow();
  });

  test('UntypedEventEmitter works as generic version', () => {
    const emitter = new UntypedEventEmitter();
    const handler = vi.fn();
    emitter.on('anything', handler);
    emitter.emit('anything', 1, 'two', true);
    expect(handler).toHaveBeenCalledWith(1, 'two', true);
  });
});
