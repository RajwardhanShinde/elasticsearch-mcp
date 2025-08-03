// Global test setup
import { jest } from '@jest/globals';

// Set up global test timeout
jest.setTimeout(10000);

// Mock console methods to reduce noise in tests
const originalConsole = { ...console };

beforeEach(() => {
  // Restore original console methods before each test
  Object.assign(console, originalConsole);
});

// Global mocks
global.console = {
  ...console,
  // Keep error and warn for important messages
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
};

// Environment variables for testing
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Minimize logging during tests