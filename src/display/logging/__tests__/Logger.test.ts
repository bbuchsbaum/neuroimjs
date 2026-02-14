/**
 * Test suite for Logger
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel, CategoryLogger, getLogger } from '../Logger';

describe('Logger', () => {
  let consoleSpy: {
    debug: any;
    info: any;
    warn: any;
    error: any;
  };

  beforeEach(() => {
    // Destroy any existing instance
    Logger.destroy();

    // Spy on console methods
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {})
    };
  });

  afterEach(() => {
    // Restore console methods
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    
    // Clean up logger
    Logger.destroy();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = Logger.getInstance();
      const instance2 = Logger.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should accept options on first creation', () => {
      const logger = Logger.getInstance({
        level: LogLevel.WARN,
        console: false
      });
      
      logger.log(LogLevel.INFO, 'test', 'message');
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });
  });

  describe('Log Levels', () => {
    it('should respect log level filtering', () => {
      const logger = Logger.getInstance({ level: LogLevel.WARN });
      
      logger.log(LogLevel.DEBUG, 'test', 'debug message');
      logger.log(LogLevel.INFO, 'test', 'info message');
      logger.log(LogLevel.WARN, 'test', 'warn message');
      logger.log(LogLevel.ERROR, 'test', 'error message');
      
      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] [test] warn message'),
        undefined
      );
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] [test] error message'),
        undefined
      );
    });
  });

  describe('Category Filtering', () => {
    it('should include only specified categories', () => {
      const logger = Logger.getInstance({
        includeCategories: ['app', 'app.component']
      });
      
      logger.log(LogLevel.INFO, 'app', 'included 1');
      logger.log(LogLevel.INFO, 'app.component', 'included 2');
      logger.log(LogLevel.INFO, 'app.component.child', 'included 3');
      logger.log(LogLevel.INFO, 'other', 'excluded');
      
      expect(consoleSpy.info).toHaveBeenCalledTimes(3);
    });

    it('should exclude specified categories', () => {
      const logger = Logger.getInstance({
        excludeCategories: ['debug', 'performance']
      });
      
      logger.log(LogLevel.INFO, 'app', 'included');
      logger.log(LogLevel.INFO, 'debug', 'excluded 1');
      logger.log(LogLevel.INFO, 'debug.verbose', 'excluded 2');
      logger.log(LogLevel.INFO, 'performance', 'excluded 3');
      
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('CategoryLogger', () => {
    it('should log with correct category', () => {
      const logger = Logger.getInstance();
      const categoryLogger = logger.getCategory('test.category');
      
      categoryLogger.debug('debug message');
      categoryLogger.info('info message');
      categoryLogger.warn('warn message');
      categoryLogger.error('error message', new Error('test error'));
      
      expect(consoleSpy.debug).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] [test.category]'),
        undefined
      );
    });

    it('should create child loggers', () => {
      const logger = Logger.getInstance();
      const parent = logger.getCategory('parent');
      const child = parent.child('child');
      
      child.info('message from child');
      
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('[parent.child]'),
        undefined
      );
    });

    it('should time function execution', async () => {
      const logger = Logger.getInstance();
      const categoryLogger = logger.getCategory('perf');
      
      const result = await categoryLogger.time('operation', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'result';
      });
      
      expect(result).toBe('result');
      expect(consoleSpy.debug).toHaveBeenCalledWith(
        expect.stringContaining('operation completed'),
        expect.objectContaining({
          duration: expect.stringMatching(/\d+\.\d+ms/)
        })
      );
    });

    it('should handle timing errors', async () => {
      const logger = Logger.getInstance();
      const categoryLogger = logger.getCategory('perf');
      
      await expect(
        categoryLogger.time('failing', async () => {
          throw new Error('operation failed');
        })
      ).rejects.toThrow('operation failed');
      
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('failing failed'),
        expect.objectContaining({
          duration: expect.any(String),
          error: expect.any(Error)
        })
      );
    });
  });

  describe('Log Storage', () => {
    it('should store logs when enabled', () => {
      const logger = Logger.getInstance({ store: true });
      
      logger.log(LogLevel.INFO, 'test', 'message 1');
      logger.log(LogLevel.INFO, 'test', 'message 2');
      
      const entries = logger.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe('message 1');
      expect(entries[1].message).toBe('message 2');
    });

    it('should respect max entries limit', () => {
      const logger = Logger.getInstance({ store: true, maxEntries: 3 });
      
      for (let i = 0; i < 5; i++) {
        logger.log(LogLevel.INFO, 'test', `message ${i}`);
      }
      
      const entries = logger.getEntries();
      expect(entries).toHaveLength(3);
      expect(entries[0].message).toBe('message 2');
      expect(entries[2].message).toBe('message 4');
    });

    it('should filter stored entries', () => {
      const logger = Logger.getInstance({ store: true });
      
      logger.log(LogLevel.DEBUG, 'cat1', 'debug 1');
      logger.log(LogLevel.INFO, 'cat1', 'info 1');
      logger.log(LogLevel.INFO, 'cat2', 'info 2');
      logger.log(LogLevel.ERROR, 'cat2', 'error 1');
      
      const filtered = logger.getEntries({
        level: LogLevel.INFO,
        category: 'cat1'
      });
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].message).toBe('info 1');
    });
  });

  describe('Custom Handler', () => {
    it('should call custom handler', () => {
      const handler = vi.fn();
      const logger = Logger.getInstance({ handler });
      
      logger.log(LogLevel.INFO, 'test', 'message', { data: 'value' });
      
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          level: LogLevel.INFO,
          category: 'test',
          message: 'message',
          data: { data: 'value' }
        })
      );
    });
  });

  describe('Export Functions', () => {
    it('should export logs as JSON', () => {
      const logger = Logger.getInstance({ store: true });
      
      logger.log(LogLevel.INFO, 'test', 'message 1');
      logger.log(LogLevel.ERROR, 'test', 'message 2');
      
      const json = logger.exportJSON();
      const parsed = JSON.parse(json);
      
      expect(parsed).toHaveLength(2);
      expect(parsed[0].message).toBe('message 1');
      expect(parsed[1].message).toBe('message 2');
    });

    it('should export logs as CSV', () => {
      const logger = Logger.getInstance({ store: true });
      
      logger.log(LogLevel.INFO, 'test', 'message', { value: 123 });
      
      const csv = logger.exportCSV();
      const lines = csv.split('\n');
      
      expect(lines[0]).toBe('timestamp,level,category,message,data');
      expect(lines[1]).toContain('INFO');
      expect(lines[1]).toContain('test');
      expect(lines[1]).toContain('message');
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      const logger = Logger.getInstance({ level: LogLevel.INFO });
      
      logger.log(LogLevel.DEBUG, 'test', 'should not appear');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
      
      logger.configure({ level: LogLevel.DEBUG });
      
      logger.log(LogLevel.DEBUG, 'test', 'should appear');
      expect(consoleSpy.debug).toHaveBeenCalled();
    });

    it('should clear entries', () => {
      const logger = Logger.getInstance({ store: true });
      
      logger.log(LogLevel.INFO, 'test', 'message');
      expect(logger.getEntries()).toHaveLength(1);
      
      logger.clearEntries();
      expect(logger.getEntries()).toHaveLength(0);
    });
  });

  describe('Convenience Methods', () => {
    it('should use getLogger function', () => {
      const categoryLogger = getLogger('convenience');
      
      categoryLogger.info('test message');
      
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('[convenience]'),
        undefined
      );
    });
  });

  describe('Factory Methods', () => {
    it('should create development logger', () => {
      const logger = Logger.development();
      
      logger.log(LogLevel.DEBUG, 'test', 'debug message');
      expect(consoleSpy.debug).toHaveBeenCalled();
      expect(logger.getEntries()).toHaveLength(1);
    });

    it('should create production logger', () => {
      const logger = Logger.production();
      
      logger.log(LogLevel.DEBUG, 'test', 'debug message');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(logger.getEntries()).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should extract stack traces from errors', () => {
      const logger = Logger.getInstance({ store: true });
      const error = new Error('test error');
      
      logger.log(LogLevel.ERROR, 'test', 'error occurred', {
        stack: error.stack
      });
      
      const entries = logger.getEntries();
      expect(entries[0].stack).toBe(error.stack);
    });
  });
});