import { ProviderManager, ProviderType } from './llmAdapter';
import { GeminiProvider } from './providers/geminiProvider';
import { OpenAINativeProvider } from './providers/openaiNativeProvider';
import { OpenRouterProvider } from './providers/openrouterProvider';
import { LMStudioProvider } from './providers/lmstudioProvider';
import { OllamaNativeProvider } from './providers/ollamaNativeProvider';
import { GroqNativeProvider } from './providers/groqNativeProvider';

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
    // Register providers using static imports for proper bundling
    manager.registerProvider('gemini', new GeminiProvider());
    console.log('✅ gemini provider loaded successfully');

    // Load native providers (no LLM.js dependencies)
    const nativeProviders = [
      { name: 'openai', ProviderClass: OpenAINativeProvider },
      { name: 'openrouter', ProviderClass: OpenRouterProvider },
      { name: 'lmstudio', ProviderClass: LMStudioProvider },
      { name: 'ollama', ProviderClass: OllamaNativeProvider },
      { name: 'groq', ProviderClass: GroqNativeProvider },
    ];

    for (const { name, ProviderClass } of nativeProviders) {
      try {
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
