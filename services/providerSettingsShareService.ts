import { CryptoService } from './cryptoService';
import type { ProviderConfig, ProviderSettings, ProviderType } from './llmAdapter';
import { providerManager } from './providerRegistry';

export const PROVIDER_SETTINGS_SHARE_PARAM = 'ps';

export interface SharedProviderSettingsPayload {
  v: 1;
  kind: 'provider-settings';
  provider: ProviderType;
  config: {
    model: string;
    apiKey?: string;
    baseUrl?: string;
  };
  meta: {
    app: 'educare';
    sharedAt: string;
  };
}

const VISIBLE_PROVIDER_NAMES: Record<ProviderType, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  ollama: 'Ollama',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  lmstudio: 'OpenAI 相容端點',
};

const getShareableConfig = (config: ProviderConfig): SharedProviderSettingsPayload['config'] => ({
  model: String(config.model || '').trim(),
  apiKey:
    typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey.trim() : undefined,
  baseUrl:
    typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl.trim() : undefined,
});

export function getProviderDisplayName(provider: ProviderType): string {
  return VISIBLE_PROVIDER_NAMES[provider] || provider;
}

export function buildProviderSettingsPayload(
  settings: ProviderSettings,
  provider: ProviderType,
): SharedProviderSettingsPayload {
  const providerSettings = settings.providers[provider];
  if (!providerSettings) {
    throw new Error('找不到要分享的服務商設定');
  }

  const config = getShareableConfig(providerSettings.config);
  if (!config.model) {
    throw new Error('分享前請先設定模型');
  }

  if (!config.apiKey && !config.baseUrl) {
    throw new Error('分享前請先設定 API 金鑰或端點網址');
  }

  return {
    v: 1,
    kind: 'provider-settings',
    provider,
    config,
    meta: {
      app: 'educare',
      sharedAt: new Date().toISOString(),
    },
  };
}

export function getShareableProviderSummary(settings: ProviderSettings, provider: ProviderType) {
  const payload = buildProviderSettingsPayload(settings, provider);
  return {
    provider,
    providerName: getProviderDisplayName(provider),
    model: payload.config.model,
    baseUrl: payload.config.baseUrl,
    hasApiKey: Boolean(payload.config.apiKey),
  };
}

export async function encryptProviderSettingsPayload(
  payload: SharedProviderSettingsPayload,
  password: string,
): Promise<string> {
  return CryptoService.encryptPayload(payload, password);
}

export async function decryptProviderSettingsPayload(
  encryptedPayload: string,
  password: string,
): Promise<SharedProviderSettingsPayload> {
  const payload = await CryptoService.decryptPayload<SharedProviderSettingsPayload>(
    encryptedPayload,
    password,
  );

  validateProviderSettingsPayload(payload);
  return payload;
}

export function validateProviderSettingsPayload(payload: SharedProviderSettingsPayload): void {
  if (!payload || payload.kind !== 'provider-settings' || payload.v !== 1) {
    throw new Error('不支援的分享內容版本');
  }

  if (!payload.provider || !(payload.provider in VISIBLE_PROVIDER_NAMES)) {
    throw new Error('分享內容中的服務商無效');
  }

  if (!payload.config?.model?.trim()) {
    throw new Error('分享內容缺少模型設定');
  }

  if (!payload.config.apiKey && !payload.config.baseUrl) {
    throw new Error('分享內容缺少 API 金鑰或端點網址');
  }
}

export function buildProviderSettingsShareUrl(encryptedPayload: string): string {
  return CryptoService.generateSharingUrlForParam(PROVIDER_SETTINGS_SHARE_PARAM, encryptedPayload);
}

export function extractProviderSettingsShareFromUrl(): string | null {
  return CryptoService.extractFromUrl(PROVIDER_SETTINGS_SHARE_PARAM);
}

export function clearProviderSettingsShareFromUrl(): void {
  CryptoService.clearUrlParam(PROVIDER_SETTINGS_SHARE_PARAM);
}

export async function applyProviderSettingsPayload(
  payload: SharedProviderSettingsPayload,
): Promise<void> {
  validateProviderSettingsPayload(payload);

  const { provider, config } = payload;
  providerManager.updateProviderConfig(provider, config);
  providerManager.enableProvider(provider, true);
  providerManager.setActiveProvider(provider);

  const providerInstance = providerManager.getProvider(provider);
  if (providerInstance) {
    try {
      await providerInstance.initialize(config);
    } catch (error) {
      console.warn(`Failed to initialize imported provider ${provider}:`, error);
    }
  }
}
