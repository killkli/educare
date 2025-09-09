import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.indexedDB for testing
Object.defineProperty(window, 'indexedDB', {
  value: {
    open: vi.fn(),
    deleteDatabase: vi.fn(),
    databases: vi.fn(),
  },
  writable: true,
});

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// Mock sessionStorage
Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// Mock fetch for API calls
global.fetch = vi.fn();

// Mock DOM methods
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Element.prototype.scrollIntoView = vi.fn();

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
  writable: true,
});

// Mock environment variables
vi.mock('vite', () => ({
  loadEnv: vi.fn(() => ({
    GEMINI_API_KEY: 'test-api-key',
    TURSO_URL: 'test-turso-url',
    TURSOAPI_KEY: 'test-turso-api-key',
  })),
}));

// This import extends expect with jest-dom matchers
// The matchers are added automatically when imported
