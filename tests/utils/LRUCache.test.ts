import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LRUCache } from '../../src/utils/LRUCache';

describe('LRUCache', () => {
  let cache: LRUCache<string, number>;

  beforeEach(() => {
    cache = new LRUCache(3);
  });

  describe('constructor', () => {
    it('should create cache with specified capacity', () => {
      const stats = cache.getStats();
      expect(stats.capacity).toBe(3);
      expect(stats.size).toBe(0);
    });

    it('should throw error for invalid capacity', () => {
      expect(() => new LRUCache(0)).toThrow('Capacity must be greater than 0');
      expect(() => new LRUCache(-1)).toThrow('Capacity must be greater than 0');
    });

    it('should accept optional disposer function', () => {
      const disposer = vi.fn();
      const cacheWithDisposer = new LRUCache(2, disposer);
      
      cacheWithDisposer.put('a', 1);
      cacheWithDisposer.put('b', 2);
      cacheWithDisposer.put('c', 3); // Should evict 'a'
      
      expect(disposer).toHaveBeenCalledWith(1);
    });
  });

  describe('put and get', () => {
    it('should store and retrieve values', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBeUndefined();
    });

    it('should update existing values', () => {
      cache.put('a', 1);
      cache.put('a', 2);
      
      expect(cache.get('a')).toBe(2);
      expect(cache.size).toBe(1);
    });

    it('should evict LRU item when capacity exceeded', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      cache.put('d', 4); // Should evict 'a'
      
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('should move accessed items to front', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      
      // Access 'a' to move it to front
      cache.get('a');
      
      // Add new item, should evict 'b' (now LRU)
      cache.put('d', 4);
      
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });
  });

  describe('delete', () => {
    it('should remove items from cache', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      
      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.size).toBe(1);
    });

    it('should return false for non-existent keys', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should call disposer when deleting', () => {
      const disposer = vi.fn();
      const cacheWithDisposer = new LRUCache<string, number>(3, disposer);
      
      cacheWithDisposer.put('a', 1);
      cacheWithDisposer.delete('a');
      
      expect(disposer).toHaveBeenCalledWith(1);
    });
  });

  describe('clear', () => {
    it('should remove all items', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      
      cache.clear();
      
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBeUndefined();
    });

    it('should call disposer for all items', () => {
      const disposer = vi.fn();
      const cacheWithDisposer = new LRUCache<string, number>(3, disposer);
      
      cacheWithDisposer.put('a', 1);
      cacheWithDisposer.put('b', 2);
      cacheWithDisposer.clear();
      
      expect(disposer).toHaveBeenCalledTimes(2);
      expect(disposer).toHaveBeenCalledWith(1);
      expect(disposer).toHaveBeenCalledWith(2);
    });

    it('should reset statistics', () => {
      cache.put('a', 1);
      cache.get('a'); // hit
      cache.get('b'); // miss
      
      cache.clear();
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('has', () => {
    it('should check if key exists', () => {
      cache.put('a', 1);
      
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      
      cache.get('a'); // hit
      cache.get('a'); // hit
      cache.get('c'); // miss
      cache.get('d'); // miss
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRatio).toBe(0.5);
    });

    it('should track evictions', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      cache.put('d', 4); // evicts 'a'
      cache.put('e', 5); // evicts 'b'
      
      const stats = cache.getStats();
      expect(stats.evictions).toBe(2);
    });

    it('should handle zero total requests', () => {
      const stats = cache.getStats();
      expect(stats.hitRatio).toBe(0);
    });

    it('should reset statistics', () => {
      cache.put('a', 1);
      cache.get('a');
      cache.get('b');
      
      cache.resetStats();
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
    });
  });

  describe('resize', () => {
    it('should increase capacity', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      
      cache.resize(5);
      
      cache.put('d', 4);
      cache.put('e', 5);
      
      // All items should still be present
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
      expect(cache.get('e')).toBe(5);
    });

    it('should decrease capacity and evict items', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      
      cache.resize(1);
      
      // Only most recent item should remain
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
      expect(cache.size).toBe(1);
    });

    it('should throw error for invalid capacity', () => {
      expect(() => cache.resize(0)).toThrow('Capacity must be greater than 0');
      expect(() => cache.resize(-1)).toThrow('Capacity must be greater than 0');
    });
  });

  describe('keys', () => {
    it('should return keys in MRU order', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      cache.get('a'); // Move 'a' to front
      
      const keys = cache.keys();
      expect(keys).toEqual(['a', 'c', 'b']);
    });

    it('should return empty array for empty cache', () => {
      expect(cache.keys()).toEqual([]);
    });
  });

  describe('values', () => {
    it('should return values in MRU order', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      cache.get('a'); // Move 'a' to front
      
      const values = cache.values();
      expect(values).toEqual([1, 3, 2]);
    });

    it('should return empty array for empty cache', () => {
      expect(cache.values()).toEqual([]);
    });
  });

  describe('entries', () => {
    it('should iterate entries in MRU order', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      cache.get('a'); // Move 'a' to front
      
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([
        ['a', 1],
        ['c', 3],
        ['b', 2]
      ]);
    });

    it('should handle empty cache', () => {
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle single capacity cache', () => {
      const singleCache = new LRUCache<string, number>(1);
      
      singleCache.put('a', 1);
      singleCache.put('b', 2);
      
      expect(singleCache.get('a')).toBeUndefined();
      expect(singleCache.get('b')).toBe(2);
    });

    it('should handle updating value of MRU item', () => {
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      cache.put('c', 30); // Update MRU
      
      const values = cache.values();
      expect(values).toEqual([30, 2, 1]);
    });

    it('should handle complex types as values', () => {
      const objCache = new LRUCache<string, { data: number }>(2);
      
      const obj1 = { data: 1 };
      const obj2 = { data: 2 };
      
      objCache.put('a', obj1);
      objCache.put('b', obj2);
      
      expect(objCache.get('a')).toBe(obj1);
      expect(objCache.get('b')).toBe(obj2);
    });
  });
});