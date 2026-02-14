/**
 * LazyList implementation for deferred computation.
 * 
 * This class provides a list-like interface where elements are computed
 * on-demand using a generator function. This is useful for large datasets
 * where computing all elements upfront would be expensive.
 * 
 * Direct translation of Python's LazyList functionality.
 */

export class LazyList<T> implements Iterable<T> {
  private cache: Map<number, T> = new Map();

  /**
   * Create a new LazyList.
   * 
   * @param generator - Function that generates element at given index
   * @param length - Total number of elements
   */
  constructor(
    private generator: (index: number) => T,
    public readonly length: number
  ) {}

  /**
   * Get element at index, computing if necessary.
   * 
   * @param index - Zero-based index
   * @returns Element at index
   */
  get(index: number): T {
    if (index < 0 || index >= this.length) {
      throw new RangeError(`Index ${index} out of bounds [0, ${this.length})`);
    }

    if (!this.cache.has(index)) {
      this.cache.set(index, this.generator(index));
    }

    return this.cache.get(index)!;
  }

  /**
   * Convert to array, computing all elements.
   * 
   * @returns Array of all elements
   */
  toArray(): T[] {
    const result: T[] = new Array(this.length);
    for (let i = 0; i < this.length; i++) {
      result[i] = this.get(i);
    }
    return result;
  }

  /**
   * Map over elements lazily.
   * 
   * @param fn - Mapping function
   * @returns New LazyList with mapped elements
   */
  map<U>(fn: (value: T, index: number) => U): LazyList<U> {
    return new LazyList(
      (index: number) => fn(this.get(index), index),
      this.length
    );
  }

  /**
   * Filter elements lazily.
   * Note: This requires computing all elements to determine the final length.
   * 
   * @param fn - Filter predicate
   * @returns Array of filtered elements
   */
  filter(fn: (value: T, index: number) => boolean): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.length; i++) {
      const value = this.get(i);
      if (fn(value, i)) {
        result.push(value);
      }
    }
    return result;
  }

  /**
   * Take first n elements.
   * 
   * @param n - Number of elements to take
   * @returns New LazyList with first n elements
   */
  take(n: number): LazyList<T> {
    const takeCount = Math.min(n, this.length);
    return new LazyList(
      (index: number) => this.get(index),
      takeCount
    );
  }

  /**
   * Skip first n elements.
   * 
   * @param n - Number of elements to skip
   * @returns New LazyList with remaining elements
   */
  skip(n: number): LazyList<T> {
    if (n >= this.length) {
      return new LazyList(() => { throw new Error('No elements'); }, 0);
    }
    
    return new LazyList(
      (index: number) => this.get(index + n),
      this.length - n
    );
  }

  /**
   * Slice the list.
   * 
   * @param start - Start index (inclusive)
   * @param end - End index (exclusive)
   * @returns New LazyList with sliced elements
   */
  slice(start: number = 0, end: number = this.length): LazyList<T> {
    const actualStart = Math.max(0, start);
    const actualEnd = Math.min(this.length, end);
    const sliceLength = Math.max(0, actualEnd - actualStart);
    
    return new LazyList(
      (index: number) => this.get(index + actualStart),
      sliceLength
    );
  }

  /**
   * Iterate over elements.
   */
  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.length; i++) {
      yield this.get(i);
    }
  }

  /**
   * For each element, execute a function.
   * 
   * @param fn - Function to execute for each element
   */
  forEach(fn: (value: T, index: number) => void): void {
    for (let i = 0; i < this.length; i++) {
      fn(this.get(i), i);
    }
  }

  /**
   * Check if any element satisfies the predicate.
   * 
   * @param fn - Predicate function
   * @returns True if any element satisfies the predicate
   */
  some(fn: (value: T, index: number) => boolean): boolean {
    for (let i = 0; i < this.length; i++) {
      if (fn(this.get(i), i)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if all elements satisfy the predicate.
   * 
   * @param fn - Predicate function
   * @returns True if all elements satisfy the predicate
   */
  every(fn: (value: T, index: number) => boolean): boolean {
    for (let i = 0; i < this.length; i++) {
      if (!fn(this.get(i), i)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Find first element that satisfies the predicate.
   * 
   * @param fn - Predicate function
   * @returns First matching element or undefined
   */
  find(fn: (value: T, index: number) => boolean): T | undefined {
    for (let i = 0; i < this.length; i++) {
      const value = this.get(i);
      if (fn(value, i)) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Find index of first element that satisfies the predicate.
   * 
   * @param fn - Predicate function
   * @returns Index of first matching element or -1
   */
  findIndex(fn: (value: T, index: number) => boolean): number {
    for (let i = 0; i < this.length; i++) {
      if (fn(this.get(i), i)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Reduce the list to a single value.
   * 
   * @param fn - Reducer function
   * @param initialValue - Initial value
   * @returns Reduced value
   */
  reduce<U>(
    fn: (accumulator: U, currentValue: T, currentIndex: number) => U,
    initialValue: U
  ): U {
    let accumulator = initialValue;
    for (let i = 0; i < this.length; i++) {
      accumulator = fn(accumulator, this.get(i), i);
    }
    return accumulator;
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Create a LazyList from an array.
 * 
 * @param array - Source array
 * @returns LazyList that references the array
 */
export function fromArray<T>(array: T[]): LazyList<T> {
  return new LazyList((i) => array[i], array.length);
}

/**
 * Create a LazyList of numbers in a range.
 * 
 * @param start - Start value (inclusive)
 * @param end - End value (exclusive)
 * @param step - Step size (default: 1)
 * @returns LazyList of numbers
 */
export function range(start: number, end: number, step: number = 1): LazyList<number> {
  const length = Math.ceil((end - start) / step);
  return new LazyList(
    (i) => start + i * step,
    length
  );
}