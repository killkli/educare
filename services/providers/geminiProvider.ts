import { GoogleGenAI, Chat, GenerateContentResponse } from '@google/genai';
import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';
import { ApiKeyManager } from '../apiKeyManager';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly displayName = 'Google Gemini';
  readonly supportedModels = [
    'gemini-2.5-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.0-pro',
  ];
  readonly requiresApiKey = true;
  readonly supportsLocalMode = false;

  private ai: GoogleGenAI | null = null;
  private initializationAttempted = false;
  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.initializationAttempted = true;

    const userApiKey = ApiKeyManager.getGeminiApiKey();
    const builtInApiKey =
      typeof process !== 'undefined' && process.env ? process.env.API_KEY : undefined;
    const apiKey = config.apiKey || userApiKey || builtInApiKey;

    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    } else {
      this.ai = null;
      console.warn('No Gemini API key available. Please configure one in settings.');
    }
  }

  isAvailable(): boolean {
    // Check if already initialized
    if (this.ai) {
      return true;
    }

    // Check if we have API key from config
    if (this.config.apiKey) {
      return true;
    }

    // Check global API key manager (for backward compatibility)
    if (ApiKeyManager.hasGeminiApiKey()) {
      return true;
    }

    // Check environment variable
    if (typeof process !== 'undefined' && process.env?.API_KEY) {
      return true;
    }

    return false;
  }

  reinitialize(): void {
    this.ai = null;
    this.initializationAttempted = false;
    // Don't call initialize here - it will be called by ProviderManager
    // with the correct updated config
  }

  async getAvailableModels(): Promise<string[]> {
    // Gemini doesn't have a public models list API, so we return the supported models
    return this.supportedModels;
  }

  private getAi(): GoogleGenAI | null {
    if (!this.initializationAttempted) {
      this.initialize(this.config);
    }
    return this.ai;
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    const genAI = this.getAi();

    if (!genAI) {
      throw new Error('請先在設定中配置 Gemini API KEY 才能使用聊天功能。');
    }

    if (!this.isAvailable()) {
      throw new Error('請先在設定中配置 Gemini API KEY 才能使用聊天功能。');
    }

    const MAX_HISTORY_MESSAGES = 20;
    const truncatedHistory =
      params.history.length > MAX_HISTORY_MESSAGES
        ? params.history.slice(-MAX_HISTORY_MESSAGES)
        : params.history;

    let finalSystemPrompt = params.systemPrompt;
    if (params.ragContext) {
      const ragPreamble = `Use the information from the following context to inform your response to the user's question. Provide a natural, conversational answer as if the information is part of your general knowledge, without mentioning the context or documents directly. If the answer is not found in the provided information, state that you don't have the relevant information to answer the question. <context> ${params.ragContext} </context>`;
      finalSystemPrompt = `${params.systemPrompt}\n\n${ragPreamble}`;
    }

    const model = params.model || this.config.model || 'gemini-2.5-flash';
    const chat: Chat = genAI.chats.create({
      model,
      config: {
        systemInstruction: finalSystemPrompt,
        temperature: params.temperature || this.config.temperature || 0.7,
        maxOutputTokens: params.maxTokens || this.config.maxTokens || 4096,
      },
      history: truncatedHistory.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.content }],
      })),
    });

    const stream = await chat.sendMessageStream({ message: params.message });

    let aggregatedResponse: GenerateContentResponse | null = null;

    for await (const chunk of stream) {
      const chunkText = chunk.text;
      if (chunkText) {
        yield {
          text: chunkText,
          isComplete: false,
          metadata: {
            model,
            provider: this.name,
          },
        };
      }
      aggregatedResponse = chunk;
    }

    // Final response with complete metadata
    yield {
      text: '',
      isComplete: true,
      metadata: {
        promptTokenCount: aggregatedResponse?.usageMetadata?.promptTokenCount ?? 0,
        candidatesTokenCount: aggregatedResponse?.usageMetadata?.candidatesTokenCount ?? 0,
        model,
        provider: this.name,
      },
    };
  }
}
