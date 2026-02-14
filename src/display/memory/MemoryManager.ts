/**
 * Global memory manager for display components
 * Tracks memory usage and provides cleanup when limits are exceeded
 */

import { getCategoryLogger, LogCategories, MemoryLogger } from '../logging/LoggerConfig';

export interface MemoryConsumer {
  /** Get current memory usage in bytes */
  getMemoryUsage(): number;
  /** Release memory to meet the specified target */
  releaseMemory(targetBytes: number): number;
  /** Get a descriptive name for this consumer */
  getName(): string;
}

export interface MemoryStats {
  totalUsage: number;
  limit: number;
  consumers: Array<{
    name: string;
    usage: number;
    percentage: number;
  }>;
}

export interface MemoryManagerOptions {
  /** Maximum memory limit in bytes (default: 512MB) */
  maxMemoryBytes?: number;
  /** Warning threshold as percentage of max (default: 0.8) */
  warningThreshold?: number;
  /** Critical threshold as percentage of max (default: 0.95) */
  criticalThreshold?: number;
  /** Enable automatic cleanup when threshold exceeded (default: true) */
  autoCleanup?: boolean;
  /** Check interval in milliseconds (default: 5000) */
  checkInterval?: number;
}

/**
 * Singleton memory manager for coordinating memory usage
 */
export class MemoryManager {
  private static instance: MemoryManager;
  private consumers: Map<string, MemoryConsumer> = new Map();
  private options: Required<MemoryManagerOptions>;
  private checkIntervalId?: ReturnType<typeof setInterval>;
  private memoryWarningCallback?: (stats: MemoryStats) => void;
  private memoryCriticalCallback?: (stats: MemoryStats) => void;
  private readonly logger = getCategoryLogger(LogCategories.MEMORY);
  
  private constructor(options: MemoryManagerOptions = {}) {
    this.options = {
      maxMemoryBytes: options.maxMemoryBytes || 512 * 1024 * 1024, // 512MB
      warningThreshold: options.warningThreshold || 0.8,
      criticalThreshold: options.criticalThreshold || 0.95,
      autoCleanup: options.autoCleanup !== false,
      checkInterval: options.checkInterval || 5000
    };
    
    if (this.options.autoCleanup) {
      this.startMonitoring();
    }
  }
  
  /**
   * Get the singleton instance
   */
  static getInstance(options?: MemoryManagerOptions): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager(options);
    }
    return MemoryManager.instance;
  }
  
  /**
   * Register a memory consumer
   */
  registerConsumer(id: string, consumer: MemoryConsumer): void {
    this.consumers.set(id, consumer);
    this.logger.debug('Registered memory consumer', {
      id,
      name: consumer.getName(),
      initialUsage: consumer.getMemoryUsage()
    });
  }
  
  /**
   * Unregister a memory consumer
   */
  unregisterConsumer(id: string): void {
    this.consumers.delete(id);
  }
  
  /**
   * Get current memory statistics
   */
  getStats(): MemoryStats {
    let totalUsage = 0;
    const consumerStats: Array<{ name: string; usage: number; percentage: number }> = [];
    
    this.consumers.forEach((consumer, id) => {
      const usage = consumer.getMemoryUsage();
      totalUsage += usage;
      consumerStats.push({
        name: consumer.getName(),
        usage,
        percentage: 0 // Will calculate after total
      });
    });
    
    // Calculate percentages
    consumerStats.forEach(stat => {
      stat.percentage = totalUsage > 0 ? (stat.usage / totalUsage) * 100 : 0;
    });
    
    // Sort by usage descending
    consumerStats.sort((a, b) => b.usage - a.usage);
    
    return {
      totalUsage,
      limit: this.options.maxMemoryBytes,
      consumers: consumerStats
    };
  }
  
  /**
   * Check memory usage and trigger cleanup if needed
   */
  checkMemory(): void {
    const stats = this.getStats();
    const usageRatio = stats.totalUsage / this.options.maxMemoryBytes;
    
    if (usageRatio >= this.options.criticalThreshold) {
      this.logger.warn('Memory usage critical', {
        usage: MemoryManager.formatBytes(stats.totalUsage),
        limit: MemoryManager.formatBytes(this.options.maxMemoryBytes),
        ratio: `${(usageRatio * 100).toFixed(1)}%`
      });
      
      if (this.memoryCriticalCallback) {
        this.memoryCriticalCallback(stats);
      }
      
      if (this.options.autoCleanup) {
        this.performCleanup(stats.totalUsage * 0.7); // Try to free 30%
      }
    } else if (usageRatio >= this.options.warningThreshold) {
      this.logger.info('Memory usage warning', {
        usage: MemoryManager.formatBytes(stats.totalUsage),
        limit: MemoryManager.formatBytes(this.options.maxMemoryBytes),
        ratio: `${(usageRatio * 100).toFixed(1)}%`
      });
      
      if (this.memoryWarningCallback) {
        this.memoryWarningCallback(stats);
      }
    }
  }
  
  /**
   * Perform memory cleanup across all consumers
   */
  performCleanup(targetTotalBytes: number): number {
    const stats = this.getStats();
    const bytesToFree = stats.totalUsage - targetTotalBytes;
    
    if (bytesToFree <= 0) {
      return 0;
    }
    
    this.logger.info('Starting memory cleanup', {
      currentUsage: MemoryManager.formatBytes(stats.totalUsage),
      target: MemoryManager.formatBytes(targetTotalBytes),
      toFree: MemoryManager.formatBytes(bytesToFree)
    });
    
    let totalFreed = 0;
    const sortedConsumers = Array.from(this.consumers.entries())
      .sort((a, b) => b[1].getMemoryUsage() - a[1].getMemoryUsage());
    
    // Free memory from largest consumers first
    for (const [id, consumer] of sortedConsumers) {
      if (totalFreed >= bytesToFree) {
        break;
      }
      
      const currentUsage = consumer.getMemoryUsage();
      const targetUsage = Math.max(0, currentUsage - (bytesToFree - totalFreed));
      const freed = consumer.releaseMemory(targetUsage);
      
      if (freed > 0) {
        MemoryLogger.logCleanup(consumer.getName(), freed, targetUsage);
      }
      
      totalFreed += freed;
    }
    
    this.logger.info('Memory cleanup completed', {
      freed: MemoryManager.formatBytes(totalFreed),
      newUsage: MemoryManager.formatBytes(stats.totalUsage - totalFreed)
    });
    
    return totalFreed;
  }
  
  /**
   * Start automatic memory monitoring
   */
  startMonitoring(): void {
    if (this.checkIntervalId) {
      return;
    }

    const intervalFn = () => this.checkMemory();

    if (typeof window === 'undefined') {
      this.checkIntervalId = setInterval(intervalFn, this.options.checkInterval);
    } else {
      this.checkIntervalId = window.setInterval(intervalFn, this.options.checkInterval) as unknown as ReturnType<typeof setInterval>;
    }
  }
  
  /**
   * Stop automatic memory monitoring
   */
  stopMonitoring(): void {
    if (this.checkIntervalId) {
      if (typeof window === 'undefined') {
        clearInterval(this.checkIntervalId);
      } else {
        window.clearInterval(this.checkIntervalId as unknown as number);
      }
      this.checkIntervalId = undefined;
    }
  }
  
  /**
   * Set memory warning callback
   */
  onMemoryWarning(callback: (stats: MemoryStats) => void): void {
    this.memoryWarningCallback = callback;
  }
  
  /**
   * Set memory critical callback
   */
  onMemoryCritical(callback: (stats: MemoryStats) => void): void {
    this.memoryCriticalCallback = callback;
  }
  
  /**
   * Update memory options
   */
  updateOptions(options: Partial<MemoryManagerOptions>): void {
    Object.assign(this.options, options);
    
    if (this.options.autoCleanup && !this.checkIntervalId) {
      this.startMonitoring();
    } else if (!this.options.autoCleanup && this.checkIntervalId) {
      this.stopMonitoring();
    }
  }
  
  /**
   * Force garbage collection across all consumers
   */
  forceGarbageCollection(): number {
    let totalFreed = 0;
    
    this.consumers.forEach(consumer => {
      const before = consumer.getMemoryUsage();
      consumer.releaseMemory(0); // Request to free as much as possible
      const after = consumer.getMemoryUsage();
      totalFreed += (before - after);
    });
    
    return totalFreed;
  }
  
  /**
   * Estimate memory usage for common objects
   */
  static estimateMemoryUsage(object: unknown): number {
    if (object instanceof HTMLCanvasElement) {
      return object.width * object.height * 4; // 4 bytes per pixel
    }
    
    if (object instanceof ImageData) {
      return object.data.byteLength;
    }
    
    if (object instanceof ArrayBuffer || ArrayBuffer.isView(object)) {
      return object.byteLength;
    }
    
    // Type guard for objects with width and height
    if (object && typeof object === 'object' && 
        'width' in object && 'height' in object &&
        typeof object.width === 'number' && typeof object.height === 'number') {
      return object.width * object.height * 4;
    }
    
    return 0;
  }
  
  /**
   * Format bytes for human reading
   */
  static formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
  
  /**
   * Destroy the singleton instance
   */
  static destroy(): void {
    if (MemoryManager.instance) {
      MemoryManager.instance.stopMonitoring();
      MemoryManager.instance.consumers.clear();
      MemoryManager.instance = undefined as any;
    }
  }
}
