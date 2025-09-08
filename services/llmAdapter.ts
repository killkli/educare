import { ChatMessage } from '../types';

export interface StreamingResponse {
  text: string;
  isComplete: boolean;
  metadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    model?: string;
    provider?: string;
  };
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface ChatParams {
  systemPrompt: string;
  ragContext?: string;
  history: ChatMessage[];
  message: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly displayName: string;
  readonly supportedModels: string[];
  readonly requiresApiKey: boolean;
  readonly supportsLocalMode: boolean;

  initialize(config: ProviderConfig): Promise<void>;
  isAvailable(): boolean;
  streamChat(params: ChatParams): AsyncIterable<StreamingResponse>;
  reinitialize?(): void;
}

export type ProviderType =
  | 'gemini'
  | 'openai'
  | 'claude'
  | 'ollama'
  | 'groq'
  | 'deepseek'
  | 'openrouter'
  | 'lmstudio'
  | 'grok'
  | 'test';

export interface ProviderSettings {
  activeProvider: ProviderType;
  providers: {
    [key in ProviderType]: {
      enabled: boolean;
      config: ProviderConfig;
    };
  };
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  activeProvider: 'gemini',
  providers: {
    gemini: {
      enabled: true,
      config: {
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    openai: {
      enabled: false,
      config: {
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    claude: {
      enabled: false,
      config: {
        model: 'claude-3-5-sonnet-20241022',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    ollama: {
      enabled: false,
      config: {
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2:latest',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    groq: {
      enabled: false,
      config: {
        model: 'llama-3.1-70b-versatile',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    deepseek: {
      enabled: false,
      config: {
        model: 'deepseek-chat',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    openrouter: {
      enabled: false,
      config: {
        model: 'openai/gpt-4o',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    lmstudio: {
      enabled: false,
      config: {
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    grok: {
      enabled: false,
      config: {
        model: 'grok-beta',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
    test: {
      enabled: true,
      config: {
        model: 'test-model',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
  },
};

export class ProviderManager {
  private static instance: ProviderManager;
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private settings: ProviderSettings;

  private constructor() {
    this.settings = this.loadSettings();
  }

  static getInstance(): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager();
    }
    return ProviderManager.instance;
  }

  private loadSettings(): ProviderSettings {
    const saved = localStorage.getItem('providerSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_PROVIDER_SETTINGS,
          ...parsed,
          providers: {
            ...DEFAULT_PROVIDER_SETTINGS.providers,
            ...parsed.providers,
          },
        };
      } catch (error) {
        console.warn('Failed to parse provider settings, using defaults:', error);
      }
    }
    return DEFAULT_PROVIDER_SETTINGS;
  }

  saveSettings(): void {
    localStorage.setItem('providerSettings', JSON.stringify(this.settings));
  }

  registerProvider(type: ProviderType, provider: LLMProvider): void {
    this.providers.set(type, provider);
  }

  getProvider(type?: ProviderType): LLMProvider | null {
    const providerType = type || this.settings.activeProvider;
    return this.providers.get(providerType) || null;
  }

  getActiveProvider(): LLMProvider | null {
    return this.getProvider(this.settings.activeProvider);
  }

  setActiveProvider(type: ProviderType): void {
    if (this.providers.has(type)) {
      this.settings.activeProvider = type;
      this.saveSettings();
    }
  }

  getSettings(): ProviderSettings {
    return { ...this.settings };
  }

  updateProviderConfig(type: ProviderType, config: Partial<ProviderConfig>): void {
    if (this.settings.providers[type]) {
      this.settings.providers[type].config = {
        ...this.settings.providers[type].config,
        ...config,
      };
      this.saveSettings();

      // Reinitialize the provider if it exists
      const provider = this.providers.get(type);
      if (provider && provider.reinitialize) {
        provider.reinitialize();
      }
    }
  }

  enableProvider(type: ProviderType, enabled = true): void {
    if (this.settings.providers[type]) {
      this.settings.providers[type].enabled = enabled;
      this.saveSettings();
    }
  }

  isProviderEnabled(type: ProviderType): boolean {
    return this.settings.providers[type]?.enabled || false;
  }

  getAvailableProviders(): Array<{ type: ProviderType; provider: LLMProvider }> {
    return Array.from(this.providers.entries())
      .filter(([type, provider]) => this.isProviderEnabled(type) && provider.isAvailable())
      .map(([type, provider]) => ({ type, provider }));
  }

  async streamChat(params: ChatParams): Promise<AsyncIterable<StreamingResponse>> {
    const activeProvider = this.getActiveProvider();
    if (!activeProvider) {
      throw new Error('No active LLM provider available');
    }

    if (!activeProvider.isAvailable()) {
      throw new Error(`Provider ${activeProvider.displayName} is not available`);
    }

    return activeProvider.streamChat(params);
  }
}
