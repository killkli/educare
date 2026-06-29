import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ApiKeyManager from './apiKeyManager';

describe('ApiKeyManager.validateGroqApiKey', () => {
  it('accepts Groq keys with variable lengths after the gsk_ prefix', () => {
    expect(
      ApiKeyManager.validateGroqApiKey(
        'gsk_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234',
      ),
    ).toBe(true);
    expect(ApiKeyManager.validateGroqApiKey('gsk_shortbutvalid123456')).toBe(true);
  });

  it('rejects keys without the gsk_ prefix or with invalid characters', () => {
    expect(ApiKeyManager.validateGroqApiKey('sk_abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(ApiKeyManager.validateGroqApiKey('gsk_invalid-key')).toBe(false);
    expect(ApiKeyManager.validateGroqApiKey('gsk_')).toBe(false);
  });
});

describe('ApiKeyManager LM Studio API key support', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();

    vi.mocked(localStorage.getItem).mockImplementation(key => storage.get(key) ?? null);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      storage.set(key, String(value));
    });
    vi.mocked(localStorage.removeItem).mockImplementation(key => {
      storage.delete(key);
    });
    vi.mocked(localStorage.clear).mockImplementation(() => {
      storage.clear();
    });

    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores and returns the optional LM Studio API key', () => {
    ApiKeyManager.setUserApiKeys({
      lmstudioBaseUrl: 'http://localhost:1234/v1',
      lmstudioApiKey: 'lmstudio-secret',
    });

    const apiKeys = ApiKeyManager.getUserApiKeys();

    expect(localStorage.getItem('user_lmstudio_api_key')).toBe('lmstudio-secret');
    expect(ApiKeyManager.getLmstudioApiKey()).toBe('lmstudio-secret');
    expect(apiKeys.lmstudioBaseUrl).toBe('http://localhost:1234/v1');
  });

  it('removes the stored LM Studio API key when omitted', () => {
    ApiKeyManager.setUserApiKeys({
      lmstudioBaseUrl: 'http://localhost:1234/v1',
      lmstudioApiKey: 'lmstudio-secret',
    });

    ApiKeyManager.setUserApiKeys({
      lmstudioBaseUrl: 'http://localhost:1234/v1',
    });

    const apiKeys = ApiKeyManager.getUserApiKeys();
    expect(apiKeys.lmstudioApiKey).toBeUndefined();
  });
});
