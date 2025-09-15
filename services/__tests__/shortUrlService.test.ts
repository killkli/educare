/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildShortUrl } from '../shortUrlService';

describe('shortUrlService', () => {
  beforeEach(() => {
    // Reset location mock before each test
    vi.clearAllMocks();
  });

  describe('buildShortUrl', () => {
    it('should build short URL with root base URL', () => {
      // Mock window.location for root path
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://example.com',
          pathname: '/',
        },
        writable: true,
      });

      const shortCode = 'abc12345';
      const result = buildShortUrl(shortCode);

      expect(result).toBe('https://example.com/s/abc12345');
    });

    it('should build short URL with base URL from Vite config', () => {
      // Mock window.location for Vite base URL
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://example.com',
          pathname: '/chatbot-test/',
        },
        writable: true,
      });

      const shortCode = 'abc12345';
      const result = buildShortUrl(shortCode);

      expect(result).toBe('https://example.com/chatbot-test/s/abc12345');
    });

    it('should build short URL when accessing a subpage', () => {
      // Mock window.location for a subpage under base URL
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://example.com',
          pathname: '/chatbot-test/chat',
        },
        writable: true,
      });

      const shortCode = 'xyz98765';
      const result = buildShortUrl(shortCode);

      expect(result).toBe('https://example.com/chatbot-test/s/xyz98765');
    });

    it('should handle deep nested paths', () => {
      // Mock window.location for deep nested path
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://example.com',
          pathname: '/my-app/some/deep/path',
        },
        writable: true,
      });

      const shortCode = 'def54321';
      const result = buildShortUrl(shortCode);

      expect(result).toBe('https://example.com/my-app/s/def54321');
    });

    it('should handle localhost development environment', () => {
      // Mock window.location for localhost
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'http://localhost:5173',
          pathname: '/chatbot-test/chat',
        },
        writable: true,
      });

      const shortCode = 'dev12345';
      const result = buildShortUrl(shortCode);

      expect(result).toBe('http://localhost:5173/chatbot-test/s/dev12345');
    });
  });
});
