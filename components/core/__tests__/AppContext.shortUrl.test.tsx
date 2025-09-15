/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('AppContext Short URL handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Short URL pattern matching', () => {
    it('should detect short URL with root base URL', () => {
      const pathname = '/s/abc12345';
      const shortUrlMatch = pathname.match(/\/s\/([a-zA-Z0-9]+)$/);

      expect(shortUrlMatch).not.toBeNull();
      expect(shortUrlMatch![1]).toBe('abc12345');
    });

    it('should detect short URL with Vite base URL', () => {
      const pathname = '/chatbot-test/s/xyz98765';
      const shortUrlMatch = pathname.match(/\/s\/([a-zA-Z0-9]+)$/);

      expect(shortUrlMatch).not.toBeNull();
      expect(shortUrlMatch![1]).toBe('xyz98765');
    });

    it('should not match regular paths', () => {
      const pathname = '/chatbot-test/chat';
      const shortUrlMatch = pathname.match(/\/s\/([a-zA-Z0-9]+)$/);

      expect(shortUrlMatch).toBeNull();
    });

    it('should not match invalid short URL format', () => {
      const pathname = '/s/';
      const shortUrlMatch = pathname.match(/\/s\/([a-zA-Z0-9]+)$/);

      expect(shortUrlMatch).toBeNull();
    });
  });

  describe('Base URL extraction for redirection', () => {
    it('should extract base URL correctly from short URL path', () => {
      const pathname = '/chatbot-test/s/abc12345';
      const baseUrl = pathname.replace(/\/s\/[a-zA-Z0-9]+$/, '') || '/';

      expect(baseUrl).toBe('/chatbot-test');
    });

    it('should handle root path short URL', () => {
      const pathname = '/s/abc12345';
      const baseUrl = pathname.replace(/\/s\/[a-zA-Z0-9]+$/, '') || '/';

      expect(baseUrl).toBe('/');
    });

    it('should handle deep nested base URL', () => {
      const pathname = '/my-app/nested/s/abc12345';
      const baseUrl = pathname.replace(/\/s\/[a-zA-Z0-9]+$/, '') || '/';

      expect(baseUrl).toBe('/my-app/nested');
    });
  });

  describe('Share URL construction', () => {
    it('should build correct share URL with base URL', () => {
      const mockOrigin = 'https://example.com';
      const baseUrl = '/chatbot-test';
      const assistantId = 'test-assistant-123';

      const shareUrl = new URL(mockOrigin);
      shareUrl.pathname = baseUrl;
      shareUrl.searchParams.set('share', assistantId);

      expect(shareUrl.toString()).toBe('https://example.com/chatbot-test?share=test-assistant-123');
    });

    it('should build correct share URL with encrypted keys', () => {
      const mockOrigin = 'https://example.com';
      const baseUrl = '/chatbot-test';
      const assistantId = 'test-assistant-123';
      const encryptedKeys = 'encrypted-data-xyz';

      const shareUrl = new URL(mockOrigin);
      shareUrl.pathname = baseUrl;
      shareUrl.searchParams.set('share', assistantId);
      shareUrl.searchParams.set('keys', encryptedKeys);

      expect(shareUrl.toString()).toBe(
        'https://example.com/chatbot-test?share=test-assistant-123&keys=encrypted-data-xyz',
      );
    });
  });
});
