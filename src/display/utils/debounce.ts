/**
 * Debounce utility for performance optimization
 */

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked.
 * 
 * @param func The function to debounce
 * @param wait The number of milliseconds to delay
 * @param immediate If true, trigger the function on the leading edge instead of trailing
 * @returns The debounced function
 */
export function debounce<T extends (...args: any[]) => unknown>(
  func: T,
  wait: number,
  immediate: boolean = false
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastCallTime = 0;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    const context = this;
    const now = Date.now();
    
    const later = () => {
      timeout = null;
      if (!immediate) {
        func.apply(context, args);
      }
    };

    const callNow = immediate && !timeout;
    
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    
    timeout = setTimeout(later, wait);
    
    if (callNow) {
      func.apply(context, args);
    }
    
    lastCallTime = now;
  };
}

/**
 * Creates a throttled function that only invokes func at most once per every wait milliseconds.
 * 
 * @param func The function to throttle
 * @param wait The number of milliseconds to throttle invocations to
 * @returns The throttled function
 */
export function throttle<T extends (...args: any[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => ReturnType<T> | undefined {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastCallTime = 0;
  let lastResult: ReturnType<T> | undefined;
  let pendingArgs: Parameters<T> | null = null;
  let pendingContext: ThisParameterType<T> | null = null;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> | undefined {
    const context = this;
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    if (timeSinceLastCall >= wait) {
      lastCallTime = now;
      lastResult = func.apply(context, args) as ReturnType<T>;
      timeout = null;
    } else {
      // Store the latest args for the pending call
      pendingArgs = args;
      pendingContext = context;
      
      if (!timeout) {
        timeout = setTimeout(() => {
          timeout = null;
          if (pendingArgs !== null && pendingContext !== null) {
            lastCallTime = Date.now();
            lastResult = func.apply(pendingContext, pendingArgs) as ReturnType<T>;
            pendingArgs = null;
            pendingContext = null;
          }
        }, wait - timeSinceLastCall);
      }
    }

    return lastResult;
  };
}

/**
 * Request animation frame based throttle for smooth animations
 * 
 * @param func The function to throttle
 * @returns The throttled function
 */
export function rafThrottle<T extends (...args: any[]) => unknown>(
  func: T
): (...args: Parameters<T>) => void {
  let rafId: number | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastContext: ThisParameterType<T> | null = null;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    lastArgs = args;
    lastContext = this;

    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        if (lastContext !== null && lastArgs !== null) {
          func.apply(lastContext, lastArgs);
        }
        rafId = null;
      });
    }
  };
}

/**
 * Interface for RAF throttled function with cancel support
 */
interface RafThrottledFunction<T extends (...args: any[]) => unknown> {
  (...args: Parameters<T>): void;
  cancel?: () => void;
  _rafId?: number;
}

/**
 * Enhanced RAF throttle with cancel support
 */
export function rafThrottleWithCancel<T extends (...args: any[]) => unknown>(
  func: T
): RafThrottledFunction<T> {
  let rafId: number | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastContext: ThisParameterType<T> | null = null;

  const throttled = function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    lastArgs = args;
    lastContext = this;

    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        if (lastContext !== null && lastArgs !== null) {
          func.apply(lastContext, lastArgs);
        }
        rafId = null;
      });
    }
  } as RafThrottledFunction<T>;

  throttled.cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      lastArgs = null;
      lastContext = null;
    }
  };

  return throttled;
}