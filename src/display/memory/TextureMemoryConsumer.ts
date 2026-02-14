/**
 * Memory consumer for managing PIXI texture memory
 */

import * as PIXI from 'pixi.js';
import { MemoryConsumer, MemoryManager } from './MemoryManager';

export interface TextureCacheEntry {
  texture: PIXI.Texture;
  canvas?: HTMLCanvasElement;
  lastAccessed: number;
  size: number;
}

/**
 * Manages texture memory with LRU eviction
 */
export class TextureMemoryConsumer implements MemoryConsumer {
  private cache: Map<string, TextureCacheEntry> = new Map();
  private maxSize: number;
  private currentSize: number = 0;
  
  constructor(
    private name: string,
    maxSizeBytes: number = 256 * 1024 * 1024 // 256MB default
  ) {
    this.maxSize = maxSizeBytes;
  }
  
  getName(): string {
    return this.name;
  }
  
  getMemoryUsage(): number {
    return this.currentSize;
  }
  
  /**
   * Add a texture to the cache
   */
  addTexture(key: string, texture: PIXI.Texture, canvas?: HTMLCanvasElement): void {
    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.removeTexture(key);
    }
    
    const size = this.estimateTextureSize(texture, canvas);
    
    // Check if we need to evict entries
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      this.evictOldest();
    }
    
    this.cache.set(key, {
      texture,
      canvas,
      lastAccessed: Date.now(),
      size
    });
    
    this.currentSize += size;
  }
  
  /**
   * Get a texture from the cache
   */
  getTexture(key: string): PIXI.Texture | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.texture;
    }
    return undefined;
  }
  
  /**
   * Remove a texture from the cache
   */
  removeTexture(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      // CRITICAL FIX: Don't destroy texture source - pooled sprites may still reference it
      // Only destroy the texture wrapper, not the underlying source
      entry.texture.destroy(false);
      this.currentSize -= entry.size;
      this.cache.delete(key);
    }
  }
  
  /**
   * Release memory to meet target
   */
  releaseMemory(targetBytes: number): number {
    const startSize = this.currentSize;
    const bytesToFree = Math.max(0, this.currentSize - targetBytes);
    let freedBytes = 0;
    
    // Sort by last accessed time (oldest first)
    const sortedEntries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    
    for (const [key, entry] of sortedEntries) {
      if (freedBytes >= bytesToFree) {
        break;
      }
      
      this.removeTexture(key);
      freedBytes += entry.size;
    }
    
    return startSize - this.currentSize;
  }
  
  /**
   * Clear all cached textures
   */
  clear(): void {
    this.cache.forEach(entry => {
      entry.texture.destroy(true);
    });
    this.cache.clear();
    this.currentSize = 0;
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    count: number;
    size: number;
    maxSize: number;
    usage: number;
  } {
    return {
      count: this.cache.size,
      size: this.currentSize,
      maxSize: this.maxSize,
      usage: this.maxSize > 0 ? (this.currentSize / this.maxSize) * 100 : 0
    };
  }
  
  /**
   * Set maximum cache size
   */
  setMaxSize(bytes: number): void {
    this.maxSize = bytes;
    
    // Evict if over new limit
    while (this.currentSize > this.maxSize && this.cache.size > 0) {
      this.evictOldest();
    }
  }
  
  /**
   * Check if cache has a texture
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }
  
  /**
   * Get all cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
  
  /**
   * Evict the oldest entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    this.cache.forEach((entry, key) => {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    });
    
    if (oldestKey) {
      this.removeTexture(oldestKey);
    }
  }
  
  /**
   * Estimate texture memory size
   */
  private estimateTextureSize(texture: PIXI.Texture, canvas?: HTMLCanvasElement): number {
    let size = 0;

    // Texture memory (4 bytes per pixel for RGBA)
    // PIXI.js v7+ uses texture.width and texture.height directly
    if (texture.width && texture.height) {
      size += texture.width * texture.height * 4;
    }

    // Canvas memory if provided
    if (canvas) {
      size += MemoryManager.estimateMemoryUsage(canvas);
    }

    return size;
  }
  
  /**
   * Register with global memory manager
   */
  registerWithMemoryManager(id: string): void {
    const manager = MemoryManager.getInstance();
    manager.registerConsumer(id, this);
  }
  
  /**
   * Unregister from global memory manager
   */
  unregisterFromMemoryManager(id: string): void {
    const manager = MemoryManager.getInstance();
    manager.unregisterConsumer(id);
  }
}