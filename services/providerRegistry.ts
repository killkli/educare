import { ProviderManager, ProviderType } from './llmAdapter';

let providerManagerInstance: ProviderManager | null = null;
let isInitializing = false;

// Simple lazy initialization without immediate execution
export function getProviderManager(): ProviderManager {
  if (!providerManagerInstance) {
    providerManagerInstance = ProviderManager.getInstance();

    // Don't initialize providers immediately to avoid stack overflow
    // They will be initialized when first accessed
  }

  return providerManagerInstance;
}

// Initialize providers asynchronously when needed
export async function initializeProviders(): Promise<void> {
  const manager = getProviderManager();
  if (isInitializing || !manager) {
    return;
  }

  isInitializing = true;

  try {
    // Dynamic imports to avoid circular dependencies
    // Load safe providers first
    const [{ GeminiProvider }] = await Promise.all([import('./providers/geminiProvider')]);

    // Register safe providers first
    manager.registerProvider('gemini', new GeminiProvider());

    // Load native providers (no LLM.js dependencies)
    const nativeProviders = [
      {
        name: 'openai',
        module: './providers/openaiNativeProvider',
        className: 'OpenAINativeProvider',
      },
      {
        name: 'openrouter',
        module: './providers/openrouterProvider',
        className: 'OpenRouterProvider',
      },
      { name: 'lmstudio', module: './providers/lmstudioProvider', className: 'LMStudioProvider' },
      {
        name: 'ollama',
        module: './providers/ollamaNativeProvider',
        className: 'OllamaNativeProvider',
      },
      { name: 'groq', module: './providers/groqNativeProvider', className: 'GroqNativeProvider' },
    ];

    for (const { name, module, className } of nativeProviders) {
      try {
        const providerModule = await import(module);
        const ProviderClass = providerModule[className];
        manager.registerProvider(name as ProviderType, new ProviderClass());
        console.log(`✅ ${name} provider loaded successfully`);
      } catch (error) {
        console.warn(`⚠️ Failed to load ${name} provider:`, error);
      }
    }

    // Initialize providers with their configurations
    const settings = manager.getSettings();

    for (const [providerType, providerSettings] of Object.entries(settings.providers)) {
      if (providerSettings.enabled) {
        const provider = manager.getProvider(providerType as ProviderType);
        if (provider) {
          await provider.initialize(providerSettings.config).catch(error => {
            console.warn(`Failed to initialize ${providerType} provider:`, error);
          });
        }
      }
    }

    console.log('✅ All providers initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize providers:', error);
  } finally {
    isInitializing = false;
  }
}

// Export the lazy getter
export const providerManager = getProviderManager();

export function isLLMAvailable(): boolean {
  return providerManager.getAvailableProviders().length > 0;
}
