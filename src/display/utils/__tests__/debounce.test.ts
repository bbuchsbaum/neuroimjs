/**
 * Test suite for debounce utilities
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { debounce, throttle, rafThrottle, rafThrottleWithCancel } from '../debounce';

// Mock requestAnimationFrame for testing
let rafCallbacks: Array<() => void> = [];
let rafId = 0;

global.requestAnimationFrame = vi.fn((callback) => {
  rafCallbacks.push(callback);
  return ++rafId;
});

global.cancelAnimationFrame = vi.fn();

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delay function execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('arg1', 'arg2');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should reset timer on subsequent calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('first');
    vi.advanceTimersByTime(50);
    
    debounced('second');
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledWith('second');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should execute immediately when immediate is true', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, true);

    debounced('arg');
    expect(fn).toHaveBeenCalledWith('arg');
    expect(fn).toHaveBeenCalledTimes(1);

    // Subsequent calls within wait period should not execute
    debounced('arg2');
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    debounced('arg3');
    expect(fn).toHaveBeenCalledWith('arg3');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should preserve this context', () => {
    const originalMethod = vi.fn(function(this: any) {
      return this.value;
    });
    
    const obj = {
      value: 42,
      method: originalMethod as unknown as ReturnType<typeof debounce>
    };

    obj.method = debounce(obj.method as any, 100) as any;
    obj.method();

    vi.advanceTimersByTime(100);
    expect(originalMethod).toHaveBeenCalled();
    expect(originalMethod).toHaveReturnedWith(42);
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should limit function calls', () => {
    const fn = vi.fn((x: number) => x * 2);
    const throttled = throttle(fn, 100);

    expect(throttled(1)).toBe(2); // First call executes immediately
    expect(fn).toHaveBeenCalledTimes(1);

    expect(throttled(2)).toBe(2); // Returns last result
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(2);
  });

  it('should execute first and last calls', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled(1); // Executes immediately
    throttled(2); // Queued
    throttled(3); // Updates queued args
    throttled(4); // Updates queued args

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(4);
  });

  it('should return cached result', () => {
    const fn = vi.fn((x: number) => x * 2);
    const throttled = throttle(fn, 100);

    expect(throttled(5)).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);
    
    expect(throttled(6)).toBe(10); // Returns cached result
    expect(fn).toHaveBeenCalledTimes(1);
    
    vi.advanceTimersByTime(100);
    // The pending call with 6 should have executed
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(6);
    
    // The cached result is now 12 (from the pending call)
    expect(throttled(7)).toBe(12); // Returns cached result from previous execution
    
    // Advance time again to allow the next call
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).toHaveBeenLastCalledWith(7);
  });

  it('should preserve this context', () => {
    const originalMethod = vi.fn(function(this: any, x: number) {
      return x * this.multiplier;
    });
    
    const obj = {
      multiplier: 10,
      method: originalMethod as unknown as ReturnType<typeof throttle>
    };

    obj.method = throttle(obj.method as any, 100) as any;
    
    expect(obj.method(5)).toBe(50);
    vi.advanceTimersByTime(100);
    expect(originalMethod).toHaveBeenCalled();
  });
});

describe('rafThrottle', () => {
  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.clearAllMocks();
  });

  it('should throttle using requestAnimationFrame', () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);

    throttled('arg1');
    expect(fn).not.toHaveBeenCalled();
    expect(global.requestAnimationFrame).toHaveBeenCalledTimes(1);

    // Simulate RAF callback
    rafCallbacks[0]();
    expect(fn).toHaveBeenCalledWith('arg1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use latest arguments', () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);

    throttled('first');
    throttled('second');
    throttled('third');

    expect(global.requestAnimationFrame).toHaveBeenCalledTimes(1);

    rafCallbacks[0]();
    expect(fn).toHaveBeenCalledWith('third');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should allow new calls after frame', () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);

    throttled('call1');
    rafCallbacks[0]();
    expect(fn).toHaveBeenCalledWith('call1');

    throttled('call2');
    expect(global.requestAnimationFrame).toHaveBeenCalledTimes(2);
    rafCallbacks[1]();
    expect(fn).toHaveBeenCalledWith('call2');
  });

  it('should preserve this context', () => {
    const originalMethod = vi.fn(function(this: any) {
      return this.value;
    });
    
    const obj = {
      value: 'test',
      method: originalMethod as unknown as ReturnType<typeof rafThrottle>
    };

    obj.method = rafThrottle(obj.method as any) as any;
    obj.method();

    rafCallbacks[0]();
    expect(originalMethod).toHaveBeenCalled();
    expect(originalMethod).toHaveReturnedWith('test');
  });
});

describe('rafThrottleWithCancel', () => {
  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.clearAllMocks();
  });

  it('should provide cancel method', () => {
    const fn = vi.fn();
    const throttled = rafThrottleWithCancel(fn);

    throttled('arg');
    expect(global.requestAnimationFrame).toHaveBeenCalled();

    throttled.cancel!();
    expect(global.cancelAnimationFrame).toHaveBeenCalledWith(1);

    // Callback should not execute after cancel
    if (rafCallbacks[0]) rafCallbacks[0]();
    expect(fn).not.toHaveBeenCalled();
  });

  it('should work like regular rafThrottle', () => {
    const fn = vi.fn();
    const throttled = rafThrottleWithCancel(fn);

    throttled('test');
    rafCallbacks[0]();
    expect(fn).toHaveBeenCalledWith('test');
  });

  it('should handle multiple cancel calls', () => {
    const fn = vi.fn();
    const throttled = rafThrottleWithCancel(fn);

    throttled.cancel!(); // Should not throw
    throttled('arg');
    throttled.cancel!();
    throttled.cancel!(); // Should not throw
  });
});

describe('Integration Tests', () => {
  vi.useRealTimers();

  it('should handle rapid successive calls', async () => {
    const results: number[] = [];
    const fn = (x: number) => results.push(x);
    const debounced = debounce(fn, 10);

    for (let i = 0; i < 10; i++) {
      debounced(i);
    }

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(results).toEqual([9]); // Only last call executes
  });

  it('should handle mixed sync and async usage', async () => {
    const results: string[] = [];
    const fn = (x: string) => results.push(x);
    const throttled = throttle(fn, 10);

    throttled('sync1');
    
    setTimeout(() => throttled('async1'), 5);
    setTimeout(() => throttled('async2'), 15);
    
    await new Promise(resolve => setTimeout(resolve, 30));
    // 'sync1' executes immediately, 'async1' is queued and executes after 10ms
    // 'async2' may or may not execute depending on exact timing
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]).toBe('sync1');
    expect(results[1]).toBe('async1');
  });
});
