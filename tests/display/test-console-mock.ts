import { vi } from 'vitest';

// Mock console methods to reduce noise in tests
export const setupConsoleMocks = () => {
  // Store original console.error
  const originalError = console.error;
  
  global.console.log = vi.fn();
  global.console.warn = vi.fn();
  global.console.error = vi.fn((message, ...args) => {
    // Only show actual errors, not warnings
    if (message && typeof message === 'string' && message.includes('Error')) {
      // Use the original console.error to avoid recursion
      originalError(message, ...args);
    }
  });
};