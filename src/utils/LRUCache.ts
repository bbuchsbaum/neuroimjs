/**
 * Node for doubly linked list in LRU cache
 */
class LRUNode<K, V> {
  key: K;
  value: V;
  prev: LRUNode<K, V> | null = null;
  next: LRUNode<K, V> | null = null;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

/**
 * Least Recently Used (LRU) Cache implementation
 * 
 * Provides O(1) get and put operations with automatic eviction
 * of least recently used items when capacity is exceeded.
 */
export class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, LRUNode<K, V>> = new Map();
  private head: LRUNode<K, V> | null = null;
  private tail: LRUNode<K, V> | null = null;
  
  // Statistics
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;
  
  // Optional disposal function for evicted values
  private disposer?: (value: V) => void;

  /**
   * Creates a new LRU Cache
   * @param capacity Maximum number of items to store
   * @param disposer Optional function to call when values are evicted
   */
  constructor(capacity: number, disposer?: (value: V) => void) {
    if (capacity <= 0) {
      throw new Error('Capacity must be greater than 0');
    }
    this.capacity = capacity;
    this.disposer = disposer;
  }

  /**
   * Gets a value from the cache
   * @param key The key to look up
   * @returns The value if found, undefined otherwise
   */
  get(key: K): V | undefined {
    const node = this.cache.get(key);
    
    if (!node) {
      this.misses++;
      return undefined;
    }
    
    this.hits++;
    
    // Move to front (most recently used)
    this.moveToFront(node);
    
    return node.value;
  }

  /**
   * Adds or updates a value in the cache
   * @param key The key to store
   * @param value The value to store
   */
  put(key: K, value: V): void {
    const existingNode = this.cache.get(key);
    
    if (existingNode) {
      // Update existing node
      existingNode.value = value;
      this.moveToFront(existingNode);
      return;
    }
    
    // Create new node
    const newNode = new LRUNode(key, value);
    this.cache.set(key, newNode);
    
    // Add to front of list
    if (!this.head) {
      this.head = this.tail = newNode;
    } else {
      newNode.next = this.head;
      this.head.prev = newNode;
      this.head = newNode;
    }
    
    // Check capacity
    if (this.cache.size > this.capacity) {
      this.evictLRU();
    }
  }

  /**
   * Removes a key from the cache
   * @param key The key to remove
   * @returns true if the key was found and removed
   */
  delete(key: K): boolean {
    const node = this.cache.get(key);
    
    if (!node) {
      return false;
    }
    
    this.removeNode(node);
    this.cache.delete(key);
    
    if (this.disposer) {
      this.disposer(node.value);
    }
    
    return true;
  }

  /**
   * Clears all items from the cache
   */
  clear(): void {
    if (this.disposer) {
      this.cache.forEach(node => this.disposer!(node.value));
    }
    
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.resetStats();
  }

  /**
   * Gets the current size of the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Checks if a key exists in the cache
   * @param key The key to check
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Gets cache statistics
   */
  getStats(): {
    size: number;
    capacity: number;
    hits: number;
    misses: number;
    evictions: number;
    hitRatio: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRatio: total > 0 ? this.hits / total : 0
    };
  }

  /**
   * Resets statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Updates the capacity of the cache
   * @param newCapacity The new capacity
   */
  resize(newCapacity: number): void {
    if (newCapacity <= 0) {
      throw new Error('Capacity must be greater than 0');
    }
    
    this.capacity = newCapacity;
    
    // Evict items if necessary
    while (this.cache.size > this.capacity) {
      this.evictLRU();
    }
  }

  /**
   * Gets all keys in the cache (from most to least recently used)
   */
  keys(): K[] {
    const keys: K[] = [];
    let current = this.head;
    
    while (current) {
      keys.push(current.key);
      current = current.next;
    }
    
    return keys;
  }

  /**
   * Gets all values in the cache (from most to least recently used)
   */
  values(): V[] {
    const values: V[] = [];
    let current = this.head;
    
    while (current) {
      values.push(current.value);
      current = current.next;
    }
    
    return values;
  }

  /**
   * Iterates over entries in the cache (from most to least recently used)
   */
  *entries(): IterableIterator<[K, V]> {
    let current = this.head;
    
    while (current) {
      yield [current.key, current.value];
      current = current.next;
    }
  }

  /**
   * Moves a node to the front of the list (most recently used)
   */
  private moveToFront(node: LRUNode<K, V>): void {
    if (node === this.head) {
      return; // Already at front
    }
    
    // Remove from current position
    this.removeNode(node);
    
    // Add to front
    node.next = this.head;
    node.prev = null;
    
    if (this.head) {
      this.head.prev = node;
    }
    
    this.head = node;
    
    if (!this.tail) {
      this.tail = node;
    }
  }

  /**
   * Removes a node from the linked list
   */
  private removeNode(node: LRUNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }
    
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
    
    node.prev = null;
    node.next = null;
  }

  /**
   * Evicts the least recently used item
   */
  private evictLRU(): void {
    if (!this.tail) {
      return;
    }
    
    const lru = this.tail;
    this.removeNode(lru);
    this.cache.delete(lru.key);
    this.evictions++;
    
    if (this.disposer) {
      this.disposer(lru.value);
    }
  }
}