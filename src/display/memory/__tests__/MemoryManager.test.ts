/**
 * Test suite for MemoryManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager, MemoryConsumer } from '../MemoryManager';

// Mock memory consumer
class MockMemoryConsumer implements MemoryConsumer {
  constructor(
    private name: string,
    private usage: number
  ) {}
  
  getName(): string {
    return this.name;
  }
  
  getMemoryUsage(): number {
    return this.usage;
  }
  
  releaseMemory(targetBytes: number): number {
    const freed = Math.max(0, this.usage - targetBytes);
    this.usage = targetBytes;
    return freed;
  }
  
  setUsage(bytes: number): void {
    this.usage = bytes;
  }
}

describe('MemoryManager', () => {
  beforeEach(() => {
    // Destroy any existing instance
    MemoryManager.destroy();
  });
  
  afterEach(() => {
    MemoryManager.destroy();
  });
  
  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = MemoryManager.getInstance();
      const instance2 = MemoryManager.getInstance();
      expect(instance1).toBe(instance2);
    });
    
    it('should accept options on first creation', () => {
      const manager = MemoryManager.getInstance({
        maxMemoryBytes: 1024 * 1024, // 1MB
        warningThreshold: 0.7
      });
      
      const stats = manager.getStats();
      expect(stats.limit).toBe(1024 * 1024);
    });
  });
  
  describe('Consumer Management', () => {
    it('should register and track consumers', () => {
      const manager = MemoryManager.getInstance();
      const consumer1 = new MockMemoryConsumer('Consumer1', 1024);
      const consumer2 = new MockMemoryConsumer('Consumer2', 2048);
      
      manager.registerConsumer('c1', consumer1);
      manager.registerConsumer('c2', consumer2);
      
      const stats = manager.getStats();
      expect(stats.totalUsage).toBe(3072);
      expect(stats.consumers).toHaveLength(2);
      expect(stats.consumers[0].name).toBe('Consumer2'); // Sorted by usage
      expect(stats.consumers[0].usage).toBe(2048);
    });
    
    it('should unregister consumers', () => {
      const manager = MemoryManager.getInstance();
      const consumer = new MockMemoryConsumer('Consumer', 1024);
      
      manager.registerConsumer('c1', consumer);
      expect(manager.getStats().totalUsage).toBe(1024);
      
      manager.unregisterConsumer('c1');
      expect(manager.getStats().totalUsage).toBe(0);
    });
  });
  
  describe('Memory Cleanup', () => {
    it('should perform cleanup when requested', () => {
      const manager = MemoryManager.getInstance();
      const consumer1 = new MockMemoryConsumer('Consumer1', 5000);
      const consumer2 = new MockMemoryConsumer('Consumer2', 3000);
      
      manager.registerConsumer('c1', consumer1);
      manager.registerConsumer('c2', consumer2);
      
      // Request to reduce to 5000 total (need to free 3000)
      const freed = manager.performCleanup(5000);
      
      expect(freed).toBeGreaterThanOrEqual(3000);
      expect(manager.getStats().totalUsage).toBeLessThanOrEqual(5000);
    });
    
    it('should prioritize cleanup from largest consumers', () => {
      const manager = MemoryManager.getInstance();
      const large = new MockMemoryConsumer('Large', 10000);
      const small = new MockMemoryConsumer('Small', 1000);
      
      manager.registerConsumer('large', large);
      manager.registerConsumer('small', small);
      
      // Request to free some memory
      manager.performCleanup(8000);
      
      // Large consumer should have been reduced
      expect(large.getMemoryUsage()).toBeLessThan(10000);
      expect(small.getMemoryUsage()).toBe(1000); // Small unchanged
    });
  });
  
  describe('Automatic Monitoring', () => {
    it('should trigger callbacks at thresholds', async () => {
      let warningTriggered = false;
      let criticalTriggered = false;
      
      const manager = MemoryManager.getInstance({
        maxMemoryBytes: 10000,
        warningThreshold: 0.5,
        criticalThreshold: 0.8,
        autoCleanup: true, // Enable monitoring
        checkInterval: 10 // Short interval for testing
      });
      
      manager.onMemoryWarning(() => {
        warningTriggered = true;
      });
      
      manager.onMemoryCritical(() => {
        criticalTriggered = true;
      });
      
      const consumer = new MockMemoryConsumer('Consumer', 4000);
      manager.registerConsumer('c1', consumer);
      
      // Should not trigger yet
      expect(warningTriggered).toBe(false);
      
      // Increase to warning level
      consumer.setUsage(6000);
      
      // Wait for check
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(warningTriggered).toBe(true);
      expect(criticalTriggered).toBe(false);
      
      // Increase to critical level
      consumer.setUsage(9000);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(criticalTriggered).toBe(true);
    });
    
    it('should perform auto cleanup when critical', async () => {
      const manager = MemoryManager.getInstance({
        maxMemoryBytes: 10000,
        criticalThreshold: 0.8,
        autoCleanup: true,
        checkInterval: 10
      });
      
      const consumer = new MockMemoryConsumer('Consumer', 9000);
      manager.registerConsumer('c1', consumer);
      
      // Wait for auto cleanup
      await new Promise(resolve => setTimeout(resolve, 50));
      const stats = manager.getStats();
      expect(stats.totalUsage).toBeLessThan(9000);
    });
  });
  
  describe('Utility Functions', () => {
    it('should estimate memory usage correctly', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      
      const estimate = MemoryManager.estimateMemoryUsage(canvas);
      expect(estimate).toBe(100 * 100 * 4); // 4 bytes per pixel
    });
    
    it('should format bytes correctly', () => {
      expect(MemoryManager.formatBytes(100)).toBe('100.00 B');
      expect(MemoryManager.formatBytes(1024)).toBe('1.00 KB');
      expect(MemoryManager.formatBytes(1024 * 1024)).toBe('1.00 MB');
      expect(MemoryManager.formatBytes(1.5 * 1024 * 1024)).toBe('1.50 MB');
    });
  });
  
  describe('Force Garbage Collection', () => {
    it('should request all consumers to free memory', () => {
      const manager = MemoryManager.getInstance();
      const consumer1 = new MockMemoryConsumer('Consumer1', 5000);
      const consumer2 = new MockMemoryConsumer('Consumer2', 3000);
      
      manager.registerConsumer('c1', consumer1);
      manager.registerConsumer('c2', consumer2);
      
      const freed = manager.forceGarbageCollection();
      
      expect(freed).toBeGreaterThan(0);
      expect(consumer1.getMemoryUsage()).toBe(0);
      expect(consumer2.getMemoryUsage()).toBe(0);
    });
  });
  
  describe('Options Update', () => {
    it('should update options at runtime', () => {
      const manager = MemoryManager.getInstance({
        maxMemoryBytes: 10000,
        autoCleanup: false
      });
      
      manager.updateOptions({
        maxMemoryBytes: 20000,
        autoCleanup: true
      });
      
      const stats = manager.getStats();
      expect(stats.limit).toBe(20000);
    });
  });
});