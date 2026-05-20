import { describe, it, expect } from 'vitest';
import ApiKeyManager from './apiKeyManager';

describe('ApiKeyManager.validateGroqApiKey', () => {
  it('accepts Groq keys with variable lengths after the gsk_ prefix', () => {
    expect(ApiKeyManager.validateGroqApiKey('gsk_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234')).toBe(true);
    expect(ApiKeyManager.validateGroqApiKey('gsk_shortbutvalid123456')).toBe(true);
  });

  it('rejects keys without the gsk_ prefix or with invalid characters', () => {
    expect(ApiKeyManager.validateGroqApiKey('sk_abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(ApiKeyManager.validateGroqApiKey('gsk_invalid-key')).toBe(false);
    expect(ApiKeyManager.validateGroqApiKey('gsk_')).toBe(false);
  });
});
