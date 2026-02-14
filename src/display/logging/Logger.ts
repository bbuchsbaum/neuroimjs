/**
 * Logging system for neuroimjs display components
 * Provides structured logging with levels, categories, and formatting
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
  stack?: string;
}

export interface LoggerOptions {
  /** Minimum log level to output */
  level?: LogLevel;
  /** Whether to output to console */
  console?: boolean;
  /** Whether to store log entries */
  store?: boolean;
  /** Maximum number of stored entries */
  maxEntries?: number;
  /** Custom log handler */
  handler?: (entry: LogEntry) => void;
  /** Categories to include (if specified, only these are logged) */
  includeCategories?: string[];
  /** Categories to exclude */
  excludeCategories?: string[];
}

/**
 * Logger instance for a specific category
 */
export class CategoryLogger {
  constructor(
    private category: string,
    private logger: Logger
  ) {}

  debug(message: string, data?: unknown): void {
    this.logger.log(LogLevel.DEBUG, this.category, message, data);
  }

  info(message: string, data?: unknown): void {
    this.logger.log(LogLevel.INFO, this.category, message, data);
  }

  warn(message: string, data?: unknown): void {
    this.logger.log(LogLevel.WARN, this.category, message, data);
  }

  error(message: string, error?: Error | unknown): void {
    if (error instanceof Error) {
      this.logger.log(LogLevel.ERROR, this.category, message, {
        error: error.message,
        stack: error.stack
      });
    } else {
      this.logger.log(LogLevel.ERROR, this.category, message, error);
    }
  }

  /**
   * Create a child logger with subcategory
   */
  child(subcategory: string): CategoryLogger {
    return new CategoryLogger(`${this.category}.${subcategory}`, this.logger);
  }

  /**
   * Time a function execution
   */
  async time<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.debug(`${label} completed`, { duration: `${duration.toFixed(2)}ms` });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.logger.log(LogLevel.ERROR, this.category, `${label} failed`, { 
        duration: `${duration.toFixed(2)}ms`, 
        error 
      });
      throw error;
    }
  }
}

/**
 * Main logger class
 */
export class Logger {
  private static instance: Logger;
  private options: Required<LoggerOptions>;
  private entries: LogEntry[] = [];
  private categoryLoggers: Map<string, CategoryLogger> = new Map();

  private constructor(options: LoggerOptions = {}) {
    this.options = {
      level: options.level ?? LogLevel.DEBUG,
      console: options.console ?? true,
      store: options.store ?? false,
      maxEntries: options.maxEntries ?? 1000,
      handler: options.handler ?? undefined,
      includeCategories: options.includeCategories ?? undefined,
      excludeCategories: options.excludeCategories ?? []
    } as Required<LoggerOptions>;
  }

  /**
   * Get singleton instance
   */
  static getInstance(options?: LoggerOptions): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(options);
    } else if (options) {
      // Update options if provided
      Logger.instance.configure(options);
    }
    return Logger.instance;
  }

  /**
   * Destroy singleton instance
   */
  static destroy(): void {
    Logger.instance = null as any;
  }

  /**
   * Configure logger options
   */
  configure(options: Partial<LoggerOptions>): void {
    Object.assign(this.options, options);
  }

  /**
   * Get logger for a specific category
   */
  getCategory(category: string): CategoryLogger {
    if (!this.categoryLoggers.has(category)) {
      this.categoryLoggers.set(category, new CategoryLogger(category, this));
    }
    return this.categoryLoggers.get(category)!;
  }

  /**
   * Log a message
   */
  log(level: LogLevel, category: string, message: string, data?: unknown): void {
    // Check level
    if (level < this.options.level) {
      return;
    }

    // Check category filters
    if (!this.shouldLogCategory(category)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      category,
      message,
      data
    };

    // Extract stack trace for errors
    if (level === LogLevel.ERROR && data && typeof data === 'object' && 'stack' in data) {
      entry.stack = (data as any).stack;
    }

    // Store entry
    if (this.options.store) {
      this.storeEntry(entry);
    }

    // Console output
    if (this.options.console) {
      this.consoleOutput(entry);
    }

    // Custom handler
    if (this.options.handler) {
      this.options.handler(entry);
    }
  }

  /**
   * Check if category should be logged
   */
  private shouldLogCategory(category: string): boolean {
    // Check exclude list
    if (this.options.excludeCategories.some(cat => 
      category === cat || category.startsWith(cat + '.')
    )) {
      return false;
    }

    // Check include list
    if (this.options.includeCategories) {
      return this.options.includeCategories.some(cat => 
        category === cat || category.startsWith(cat + '.')
      );
    }

    return true;
  }

  /**
   * Store log entry
   */
  private storeEntry(entry: LogEntry): void {
    this.entries.push(entry);
    
    // Trim if needed
    if (this.entries.length > this.options.maxEntries) {
      this.entries = this.entries.slice(-this.options.maxEntries);
    }
  }

  /**
   * Output to console
   */
  private consoleOutput(entry: LogEntry): void {
    const level = LogLevel[entry.level];
    const message = `[${level}] [${entry.category}] ${entry.message}`;
    
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(message, entry.data);
        break;
      case LogLevel.INFO:
        console.info(message, entry.data);
        break;
      case LogLevel.WARN:
        console.warn(message, entry.data);
        break;
      case LogLevel.ERROR:
        console.error(message, entry.data);
        if (entry.stack) {
          console.error(entry.stack);
        }
        break;
    }
  }

  /**
   * Get stored log entries
   */
  getEntries(filter?: {
    level?: LogLevel;
    category?: string;
    since?: Date;
    limit?: number;
  }): LogEntry[] {
    let entries = [...this.entries];

    if (filter) {
      if (filter.level !== undefined) {
        entries = entries.filter(e => e.level >= filter.level!);
      }
      
      if (filter.category) {
        entries = entries.filter(e => 
          e.category === filter.category || 
          e.category.startsWith(filter.category + '.')
        );
      }
      
      if (filter.since) {
        entries = entries.filter(e => e.timestamp >= filter.since!);
      }
      
      if (filter.limit) {
        entries = entries.slice(-filter.limit);
      }
    }

    return entries;
  }

  /**
   * Clear stored entries
   */
  clearEntries(): void {
    this.entries = [];
  }

  /**
   * Export entries as JSON
   */
  exportJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Export entries as CSV
   */
  exportCSV(): string {
    const headers = ['timestamp', 'level', 'category', 'message', 'data'];
    const rows = this.entries.map(entry => [
      entry.timestamp.toISOString(),
      LogLevel[entry.level],
      entry.category,
      entry.message,
      JSON.stringify(entry.data || '')
    ]);
    
    return [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
  }

  /**
   * Create development logger with debug level
   */
  static development(): Logger {
    return Logger.getInstance({
      level: LogLevel.DEBUG,
      console: true,
      store: true
    });
  }

  /**
   * Create production logger with info level
   */
  static production(): Logger {
    return Logger.getInstance({
      level: LogLevel.INFO,
      console: true,
      store: false
    });
  }
}

/**
 * Convenience function to get a category logger
 */
export function getLogger(category: string): CategoryLogger {
  return Logger.getInstance().getCategory(category);
}

/**
 * Log level helpers
 */
export const setLogLevel = (level: LogLevel): void => {
  Logger.getInstance().configure({ level });
};

export const enableConsoleLogging = (enabled: boolean): void => {
  Logger.getInstance().configure({ console: enabled });
};

export const enableLogStorage = (enabled: boolean): void => {
  Logger.getInstance().configure({ store: enabled });
};