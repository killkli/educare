import { ChatMessage } from '../types';
import { providerManager, initializeProviders } from './providerRegistry';

export interface StreamChatParams {
  systemPrompt: string;
  ragContext?: string;
  history: ChatMessage[];
  message: string;
  onChunk: (text: string) => void;
  onComplete: (
    metadata: { promptTokenCount: number; candidatesTokenCount: number },
    fullText: string,
  ) => void;
}

export const streamChat = async (params: StreamChatParams) => {
  const { systemPrompt, ragContext, history, message, onChunk, onComplete } = params;

  // Ensure providers are initialized
  await initializeProviders();

  const activeProvider = providerManager.getActiveProvider();
  if (!activeProvider) {
    throw new Error('沒有可用的 AI 服務商。請在設定中配置至少一個服務商。');
  }

  if (!activeProvider.isAvailable()) {
    throw new Error(`${activeProvider.displayName} 服務不可用。請檢查您的配置。`);
  }

  let fullResponseText = '';
  let promptTokenCount = 0;
  let candidatesTokenCount = 0;

  try {
    const chatParams = {
      systemPrompt,
      ragContext,
      history,
      message,
    };

    for await (const response of activeProvider.streamChat(chatParams)) {
      if (response.text && !response.isComplete) {
        onChunk(response.text);
        fullResponseText += response.text;
      }

      if (response.isComplete && response.metadata) {
        promptTokenCount = response.metadata.promptTokenCount || 0;
        candidatesTokenCount = response.metadata.candidatesTokenCount || 0;
        break;
      }
    }

    onComplete(
      {
        promptTokenCount,
        candidatesTokenCount,
      },
      fullResponseText,
    );
  } catch (error) {
    console.error('LLM streaming error:', error);

    // Provide user-friendly error messages
    if (error instanceof Error) {
      if (error.message.includes('API key') || error.message.includes('unauthorized')) {
        throw new Error(`API 金鑰錯誤：請檢查 ${activeProvider.displayName} 的 API 金鑰是否正確。`);
      } else if (error.message.includes('rate limit') || error.message.includes('quota')) {
        throw new Error(`API 配額不足：${activeProvider.displayName} 的使用配額已達上限。`);
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        throw new Error(`網路連接錯誤：無法連接到 ${activeProvider.displayName} 服務。`);
      }
    }

    throw error;
  }
};

export const isLLMAvailable = (): boolean => {
  try {
    const availableProviders = providerManager.getAvailableProviders();
    return availableProviders.length > 0;
  } catch {
    // If providers aren't initialized yet, return false
    return false;
  }
};

export const getActiveProviderName = (): string => {
  const activeProvider = providerManager.getActiveProvider();
  return activeProvider ? activeProvider.displayName : '無';
};

export const getActiveProviderModel = (): string => {
  const settings = providerManager.getSettings();
  const activeProvider = settings.activeProvider;
  const config = settings.providers[activeProvider]?.config;
  return config?.model || '預設模型';
};
