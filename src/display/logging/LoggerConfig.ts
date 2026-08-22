/**
 * Logger configuration and initialization for display components
 */

import { Logger, LogLevel, CategoryLogger } from './Logger';

/**
 * Logger categories for display components
 */
export const LogCategories = {
  // Core components
  VIEWER: 'viewer',
  VIEW: 'view',
  MODEL: 'model',
  LAYER: 'layer',
  
  // Subsystems
  ALIGNMENT: 'alignment',
  MEMORY: 'memory',
  WORKER: 'worker',
  COORDINATE: 'coordinate',
  
  // Specific components
  IMAGE_LAYER: 'layer.image',
  CLUSTER_LAYER: 'layer.cluster',
  SLICE_VIEW: 'view.slice',
  ORTHOGONAL_VIEWER: 'viewer.orthogonal',
  
  // Performance
  PERFORMANCE: 'performance',
  RENDER: 'performance.render',
  TEXTURE: 'performance.texture',
  
  // Events
  EVENT: 'event',
  INTERACTION: 'event.interaction',
  
  // Utilities
  POOL: 'util.pool',
  CACHE: 'util.cache'
} as const;

export type LogCategory = typeof LogCategories[keyof typeof LogCategories];

function environmentVariable(name: string): string | undefined {
  return typeof process === 'undefined' ? undefined : process.env[name];
}

/**
 * Initialize logger with environment-specific settings
 */
export function initializeLogger(): void {
  const isDevelopment = environmentVariable('NODE_ENV') === 'development';
  const logLevel = environmentVariable('LOG_LEVEL') as keyof typeof LogLevel | undefined;
  
  Logger.getInstance({
    level: logLevel ? LogLevel[logLevel] : (isDevelopment ? LogLevel.DEBUG : LogLevel.INFO),
    console: true,
    store: isDevelopment,
    maxEntries: 5000,
    excludeCategories: isDevelopment ? [] : [LogCategories.PERFORMANCE, LogCategories.RENDER]
  });
}

/**
 * Get typed logger for a category
 */
export function getCategoryLogger(category: LogCategory): CategoryLogger {
  return Logger.getInstance().getCategory(category);
}

/**
 * Performance logging helper
 */
export class PerformanceLogger {
  private static timers: Map<string, number> = new Map();
  private static logger = getCategoryLogger(LogCategories.PERFORMANCE);
  
  static start(label: string): void {
    this.timers.set(label, performance.now());
    this.logger.debug(`Started: ${label}`);
  }
  
  static end(label: string, metadata?: Record<string, unknown>): void {
    const start = this.timers.get(label);
    if (start) {
      const duration = performance.now() - start;
      this.timers.delete(label);
      this.logger.info(`Completed: ${label}`, {
        duration: `${duration.toFixed(2)}ms`,
        ...metadata
      });
    }
  }
  
  static measure<T>(label: string, fn: () => T): T {
    this.start(label);
    try {
      const result = fn();
      this.end(label);
      return result;
    } catch (error) {
      this.end(label, { error: true });
      throw error;
    }
  }
  
  static async measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.start(label);
    try {
      const result = await fn();
      this.end(label);
      return result;
    } catch (error) {
      this.end(label, { error: true });
      throw error;
    }
  }
}

/**
 * Memory logging helper
 */
export class MemoryLogger {
  private static logger = getCategoryLogger(LogCategories.MEMORY);
  
  static logUsage(consumer: string, usage: number, limit: number): void {
    const percentage = (usage / limit) * 100;
    const level = percentage > 90 ? 'warn' : percentage > 70 ? 'info' : 'debug';
    
    this.logger[level](`Memory usage: ${consumer}`, {
      usage: formatBytes(usage),
      limit: formatBytes(limit),
      percentage: `${percentage.toFixed(1)}%`
    });
  }
  
  static logCleanup(consumer: string, freed: number, remaining: number): void {
    this.logger.info(`Memory cleanup: ${consumer}`, {
      freed: formatBytes(freed),
      remaining: formatBytes(remaining)
    });
  }
}

/**
 * Format bytes for logging
 */
function formatBytes(bytes: number): string {
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
 * Create a debug logger that only logs in development
 */
export function createDebugLogger(category: LogCategory): {
  debug: (message: string, data?: unknown) => void;
  time: <T>(label: string, fn: () => T | Promise<T>) => Promise<T>;
} {
  const logger = getCategoryLogger(category);
  const isDevelopment = environmentVariable('NODE_ENV') === 'development';
  
  return {
    debug: isDevelopment ? logger.debug.bind(logger) : () => {},
    time: logger.time.bind(logger)
  };
}

/**
 * Structured logging for errors
 */
export function logError(
  category: LogCategory,
  message: string,
  error: Error,
  context?: Record<string, unknown>
): void {
  const logger = getCategoryLogger(category);
  logger.error(message, {
    error: error.message,
    stack: error.stack,
    ...context
  });
}

/**
 * Log viewer state changes
 */
export function logViewerState(
  action: string,
  state: Record<string, unknown>
): void {
  const logger = getCategoryLogger(LogCategories.VIEWER);
  logger.debug(`State ${action}`, state);
}

/**
 * Log layer operations
 */
export function logLayerOperation(
  layerId: string,
  operation: string,
  details?: Record<string, unknown>
): void {
  const logger = getCategoryLogger(LogCategories.LAYER);
  logger.info(`Layer ${operation}: ${layerId}`, details);
}
