/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('AppContext Short URL handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Short URL parameter detection', () => {
    it('should detect short URL parameter in search params', () => {
      const urlParams = new URLSearchParams('?s=abc12345');
      const shortCode = urlParams.get('s');

      expect(shortCode).toBe('abc12345');
    });

    it('should detect short URL parameter with other params', () => {
      const urlParams = new URLSearchParams('?foo=bar&s=xyz98765&baz=qux');
      const shortCode = urlParams.get('s');

      expect(shortCode).toBe('xyz98765');
    });

    it('should return null for missing short URL parameter', () => {
      const urlParams = new URLSearchParams('?share=test-id');
      const shortCode = urlParams.get('s');

      expect(shortCode).toBeNull();
    });

    it('should return null for empty search params', () => {
      const urlParams = new URLSearchParams('');
      const shortCode = urlParams.get('s');

      expect(shortCode).toBeNull();
    });
  });

  describe('URL manipulation for redirection', () => {
    it('should remove short URL parameter and add share parameters', () => {
      const mockUrl = new URL('https://example.com/chatbot-test?s=abc12345');

      // Remove short URL parameter
      mockUrl.searchParams.delete('s');
      // Add share parameters
      mockUrl.searchParams.set('share', 'test-assistant-123');
      mockUrl.searchParams.set('keys', 'encrypted-data-xyz');

      expect(mockUrl.toString()).toBe(
        'https://example.com/chatbot-test?share=test-assistant-123&keys=encrypted-data-xyz',
      );
    });

    it('should handle root path with short URL parameter', () => {
      const mockUrl = new URL('https://example.com/?s=abc12345');

      mockUrl.searchParams.delete('s');
      mockUrl.searchParams.set('share', 'test-assistant-123');

      expect(mockUrl.toString()).toBe('https://example.com/?share=test-assistant-123');
    });

    it('should preserve existing query parameters when processing short URL', () => {
      const mockUrl = new URL('https://example.com/app?foo=bar&s=abc12345&baz=qux');

      mockUrl.searchParams.delete('s');
      mockUrl.searchParams.set('share', 'test-assistant-123');

      expect(mockUrl.toString()).toBe(
        'https://example.com/app?foo=bar&baz=qux&share=test-assistant-123',
      );
    });
  });

  describe('Share URL construction', () => {
    it('should build correct share URL with base URL', () => {
      const mockOrigin = 'https://example.com';
      const basePath = '/chatbot-test';
      const assistantId = 'test-assistant-123';

      const shareUrl = new URL(mockOrigin + basePath);
      shareUrl.searchParams.set('share', assistantId);

      expect(shareUrl.toString()).toBe('https://example.com/chatbot-test?share=test-assistant-123');
    });

    it('should build correct share URL with encrypted keys', () => {
      const mockOrigin = 'https://example.com';
      const basePath = '/chatbot-test';
      const assistantId = 'test-assistant-123';
      const encryptedKeys = 'encrypted-data-xyz';

      const shareUrl = new URL(mockOrigin + basePath);
      shareUrl.searchParams.set('share', assistantId);
      shareUrl.searchParams.set('keys', encryptedKeys);

      expect(shareUrl.toString()).toBe(
        'https://example.com/chatbot-test?share=test-assistant-123&keys=encrypted-data-xyz',
      );
    });
  });
});
