# Logging System Guide

The neuroimjs display system includes a comprehensive logging framework for debugging, performance monitoring, and system health tracking.

## Overview

The logging system provides:
- **Structured logging** with categories and levels
- **Performance tracking** with automatic timing
- **Memory usage monitoring**
- **Error tracking** with stack traces
- **Configurable output** (console, storage, custom handlers)

## Basic Usage

### Getting a Logger

```typescript
import { getCategoryLogger, LogCategories } from './logging/LoggerConfig';

// Get a logger for a specific category
const logger = getCategoryLogger(LogCategories.IMAGE_LAYER);

// Log messages at different levels
logger.debug('Debug information', { data: 'value' });
logger.info('General information');
logger.warn('Warning message');
logger.error('Error occurred', new Error('Something went wrong'));
```

### Available Categories

```typescript
LogCategories = {
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
}
```

## Configuration

### Initialize Logger

```typescript
import { initializeLogger, Logger, LogLevel } from './logging/Logger';

// Initialize with default settings
initializeLogger();

// Or configure manually
Logger.getInstance({
  level: LogLevel.DEBUG,
  console: true,
  store: true,
  maxEntries: 5000,
  excludeCategories: ['performance.render']
});
```

### Log Levels

```typescript
enum LogLevel {
  DEBUG = 0,   // Detailed information for debugging
  INFO = 1,    // General information
  WARN = 2,    // Warning conditions
  ERROR = 3,   // Error conditions
  NONE = 4     // Disable logging
}
```

### Environment-Based Configuration

```typescript
// Set via environment variables
process.env.NODE_ENV = 'development';  // Enables debug logging
process.env.LOG_LEVEL = 'WARN';        // Override default level
```

## Performance Logging

### Using PerformanceLogger

```typescript
import { PerformanceLogger } from './logging/LoggerConfig';

// Simple timing
PerformanceLogger.start('operation');
// ... do work ...
PerformanceLogger.end('operation');

// Measure synchronous function
const result = PerformanceLogger.measure('calculation', () => {
  return expensiveCalculation();
});

// Measure async function
const data = await PerformanceLogger.measureAsync('fetch', async () => {
  return await fetchData();
});
```

### Timing in Components

```typescript
class MyComponent {
  private logger = getCategoryLogger(LogCategories.MY_CATEGORY);
  
  async processData(): Promise<void> {
    await this.logger.time('processData', async () => {
      // Your code here
    });
  }
}
```

## Memory Logging

### Using MemoryLogger

```typescript
import { MemoryLogger } from './logging/LoggerConfig';

// Log memory usage
MemoryLogger.logUsage('TextureCache', currentBytes, limitBytes);

// Log cleanup operations
MemoryLogger.logCleanup('TextureCache', freedBytes, remainingBytes);
```

### Integration with MemoryManager

The MemoryManager automatically logs:
- Consumer registration
- Memory warnings and critical states
- Cleanup operations
- Memory statistics

## Error Handling

### Structured Error Logging

```typescript
import { logError, LogCategories } from './logging/LoggerConfig';

try {
  // risky operation
} catch (error) {
  logError(
    LogCategories.IMAGE_LAYER,
    'Failed to load texture',
    error as Error,
    {
      textureId: id,
      size: textureSize
    }
  );
}
```

### Error Context

Always include relevant context when logging errors:

```typescript
logger.error('Operation failed', {
  error: error.message,
  stack: error.stack,
  context: {
    userId: currentUser,
    action: 'loadTexture',
    params: { id, size }
  }
});
```

## Viewing Logs

### Console Output

Logs are formatted with timestamp, level, and category:
```
[2023-12-07T10:30:45.123Z] [INFO] [layer.image] Layer initialized
```

### Retrieving Stored Logs

```typescript
const logger = Logger.getInstance();

// Get all logs
const allLogs = logger.getEntries();

// Filter logs
const errors = logger.getEntries({
  level: LogLevel.ERROR,
  category: 'layer',
  since: new Date(Date.now() - 3600000), // Last hour
  limit: 100
});

// Export logs
const jsonExport = logger.exportJSON();
const csvExport = logger.exportCSV();
```

## Best Practices

### 1. Use Appropriate Log Levels

- **DEBUG**: Detailed information, method entry/exit, variable values
- **INFO**: Significant events, state changes, operations completed
- **WARN**: Recoverable issues, deprecated usage, performance concerns
- **ERROR**: Failures, exceptions, unrecoverable issues

### 2. Include Structured Data

```typescript
// Good
logger.info('Texture loaded', {
  id: textureId,
  size: { width: 512, height: 512 },
  format: 'RGBA',
  duration: '45ms'
});

// Bad
logger.info(`Texture ${textureId} loaded in 45ms`);
```

### 3. Use Child Loggers

```typescript
const parentLogger = getCategoryLogger(LogCategories.LAYER);
const childLogger = parentLogger.child('texture');

childLogger.info('Processing texture'); // Logs as 'layer.texture'
```

### 4. Avoid Logging in Hot Paths

```typescript
// Bad - logs on every frame
render() {
  logger.debug('Rendering frame');
  // ...
}

// Good - conditional logging
render() {
  if (this.frameCount % 100 === 0) {
    logger.debug('Rendered 100 frames');
  }
  // ...
}
```

### 5. Log Lifecycle Events

Always log component creation, initialization, and disposal:

```typescript
constructor() {
  this.logger.info('Component created', { id: this.id });
}

initialize() {
  this.logger.debug('Initializing', { config: this.config });
}

dispose() {
  this.logger.info('Disposing', { uptime: this.getUptime() });
}
```

## Production Considerations

### 1. Disable Debug Logging

```typescript
// Production configuration
Logger.getInstance({
  level: LogLevel.INFO,
  console: true,
  store: false, // Disable storage in production
  excludeCategories: ['performance', 'event.interaction']
});
```

### 2. Custom Log Handler

```typescript
// Send logs to external service
Logger.getInstance({
  handler: (entry) => {
    if (entry.level >= LogLevel.WARN) {
      sendToLoggingService(entry);
    }
  }
});
```

### 3. Performance Impact

- Logging has minimal overhead when disabled
- Use `excludeCategories` to skip expensive logging
- Avoid logging large objects in production

## Debugging Tips

### 1. Enable Verbose Logging

```typescript
// Temporarily enable all logs
setLogLevel(LogLevel.DEBUG);
enableLogStorage(true);

// Focus on specific category
Logger.getInstance({
  includeCategories: ['layer.image', 'memory']
});
```

### 2. Trace Operations

```typescript
const operation = 'loadVolume';
logger.debug(`Starting ${operation}`, { volumeId });

try {
  // ... operation code ...
  logger.debug(`${operation} completed`, { volumeId, duration });
} catch (error) {
  logger.error(`${operation} failed`, { volumeId, error });
}
```

### 3. Performance Analysis

```typescript
// Analyze performance logs
const perfLogs = logger.getEntries({
  category: 'performance',
  since: new Date(Date.now() - 60000) // Last minute
});

// Calculate statistics
const durations = perfLogs
  .filter(log => log.data?.duration)
  .map(log => parseFloat(log.data.duration));
```

## Integration Examples

### With ImageLayer

```typescript
export class ImageLayer {
  private logger = getCategoryLogger(LogCategories.IMAGE_LAYER);
  
  constructor(volStack: VolStack) {
    this.logger.info('Creating ImageLayer', {
      layerId: this.layerId,
      volumeCount: volStack.length
    });
  }
  
  renderSlice(sliceIndex: number): void {
    const timer = `renderSlice_${sliceIndex}`;
    PerformanceLogger.start(timer);
    
    try {
      // ... render logic ...
      PerformanceLogger.end(timer, { sliceIndex });
    } catch (error) {
      PerformanceLogger.end(timer, { sliceIndex, error: true });
      throw error;
    }
  }
}
```

### With Worker Pool

```typescript
export class WorkerPool {
  private logger = getCategoryLogger(LogCategories.WORKER);
  
  execute(task: WorkerTask): Promise<unknown> {
    this.logger.debug('Task started', {
      taskId: task.id,
      type: task.request.type
    });
    
    return this.executeInternal(task)
      .then(result => {
        this.logger.debug('Task completed', { taskId: task.id });
        return result;
      })
      .catch(error => {
        this.logger.error('Task failed', {
          taskId: task.id,
          error: error.message
        });
        throw error;
      });
  }
}
```

## Troubleshooting

### Logs Not Appearing

1. Check log level: `Logger.getInstance().configure({ level: LogLevel.DEBUG })`
2. Check category filters: Ensure category isn't excluded
3. Check console setting: `enableConsoleLogging(true)`

### Too Many Logs

1. Increase log level: `setLogLevel(LogLevel.WARN)`
2. Exclude categories: `Logger.getInstance({ excludeCategories: ['performance'] })`
3. Use conditional logging in hot paths

### Memory Usage

1. Disable log storage: `enableLogStorage(false)`
2. Reduce max entries: `Logger.getInstance({ maxEntries: 100 })`
3. Clear logs periodically: `Logger.getInstance().clearEntries()`