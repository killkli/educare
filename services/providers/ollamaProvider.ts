import LLM from '@themaximalist/llm.js';
import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly displayName = 'Ollama (Local)';
  readonly supportedModels = [
    'llama3.2:latest',
    'llama3.1:8b',
    'llama3.1:70b',
    'llama3:8b',
    'llama3:70b',
    'mixtral:8x7b',
    'codellama:13b',
    'qwen2.5:7b',
    'gemma2:9b',
    'phi3.5:latest',
    'mistral:7b',
    'deepseek-coder:6.7b',
  ];
  readonly requiresApiKey = false;
  readonly supportsLocalMode = true;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = {
      baseUrl: 'http://localhost:11434',
      ...config,
    };
  }

  isAvailable(): boolean {
    // For Ollama, we'll always return true and let the actual request fail if service is down
    // This allows users to see Ollama as an option even if not currently running
    return true;
  }

  reinitialize(): void {
    // Nothing specific needed for reinitializing Ollama
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
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

    const model = params.model || this.config.model || 'llama3.2:latest';

    // Create full prompt from system + history + user message
    let prompt = finalSystemPrompt + '\n\n';

    // Add conversation history
    for (const msg of truncatedHistory) {
      const role = msg.role === 'model' ? 'Assistant' : 'User';
      prompt += `${role}: ${msg.content}\n\n`;
    }

    // Add current user message
    prompt += `User: ${params.message}\n\nAssistant:`;

    try {
      const response = await LLM(prompt, {
        model,
        stream: true,
        temperature: params.temperature || this.config.temperature || 0.7,
        max_tokens: params.maxTokens || this.config.maxTokens || 4096,
        baseUrl: this.config.baseUrl || 'http://localhost:11434',
      });

      let fullResponseText = '';

      // Simple streaming - LLM.js returns chunks as strings when streaming
      for await (const chunk of response) {
        if (chunk && typeof chunk === 'string') {
          fullResponseText += chunk;

          yield {
            text: chunk,
            isComplete: false,
            metadata: {
              model,
              provider: this.name,
            },
          };
        }
      }

      // Final response with metadata
      yield {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount: Math.ceil(prompt.length / 4), // Rough estimate
          candidatesTokenCount: Math.ceil(fullResponseText.length / 4), // Rough estimate
          model,
          provider: this.name,
        },
      };
    } catch (error) {
      console.error('Ollama streaming error:', error);

      // Provide helpful error messages for common Ollama issues
      if (error instanceof Error) {
        if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
          throw new Error(`無法連接到 Ollama 服務。請確認：
1. Ollama 已安裝並正在運行 (ollama serve)
2. 服務運行在 ${this.config.baseUrl || 'http://localhost:11434'}
3. 模型 ${model} 已下載 (ollama pull ${model})`);
        }
      }

      throw new Error(`Ollama 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}

export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  readonly displayName = 'Groq';
  readonly supportedModels = [
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ];
  readonly requiresApiKey = true;
  readonly supportsLocalMode = false;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }

  reinitialize(): void {
    // Nothing specific needed for reinitializing Groq
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    if (!this.config.apiKey) {
      throw new Error('請先在設定中配置 Groq API KEY 才能使用聊天功能。');
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

    const model = params.model || this.config.model || 'llama-3.1-70b-versatile';

    // Create full prompt from system + history + user message
    let prompt = finalSystemPrompt + '\n\n';

    // Add conversation history
    for (const msg of truncatedHistory) {
      const role = msg.role === 'model' ? 'Assistant' : 'User';
      prompt += `${role}: ${msg.content}\n\n`;
    }

    // Add current user message
    prompt += `User: ${params.message}\n\nAssistant:`;

    try {
      const response = await LLM(prompt, {
        model,
        stream: true,
        temperature: params.temperature || this.config.temperature || 0.7,
        max_tokens: params.maxTokens || this.config.maxTokens || 4096,
        apiKey: this.config.apiKey,
      });

      let fullResponseText = '';

      // Simple streaming - LLM.js returns chunks as strings when streaming
      for await (const chunk of response) {
        if (chunk && typeof chunk === 'string') {
          fullResponseText += chunk;

          yield {
            text: chunk,
            isComplete: false,
            metadata: {
              model,
              provider: this.name,
            },
          };
        }
      }

      // Final response with metadata
      yield {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount: Math.ceil(prompt.length / 4), // Rough estimate
          candidatesTokenCount: Math.ceil(fullResponseText.length / 4), // Rough estimate
          model,
          provider: this.name,
        },
      };
    } catch (error) {
      console.error('Groq streaming error:', error);
      throw new Error(`Groq API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}

export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek';
  readonly displayName = 'DeepSeek';
  readonly supportedModels = ['deepseek-chat', 'deepseek-coder'];
  readonly requiresApiKey = true;
  readonly supportsLocalMode = false;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }

  reinitialize(): void {
    // Nothing specific needed for reinitializing DeepSeek
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    if (!this.config.apiKey) {
      throw new Error('請先在設定中配置 DeepSeek API KEY 才能使用聊天功能。');
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

    const model = params.model || this.config.model || 'deepseek-chat';

    // Create full prompt from system + history + user message
    let prompt = finalSystemPrompt + '\n\n';

    // Add conversation history
    for (const msg of truncatedHistory) {
      const role = msg.role === 'model' ? 'Assistant' : 'User';
      prompt += `${role}: ${msg.content}\n\n`;
    }

    // Add current user message
    prompt += `User: ${params.message}\n\nAssistant:`;

    try {
      const response = await LLM(prompt, {
        model,
        stream: true,
        temperature: params.temperature || this.config.temperature || 0.7,
        max_tokens: params.maxTokens || this.config.maxTokens || 4096,
        apiKey: this.config.apiKey,
      });

      let fullResponseText = '';

      // Simple streaming - LLM.js returns chunks as strings when streaming
      for await (const chunk of response) {
        if (chunk && typeof chunk === 'string') {
          fullResponseText += chunk;

          yield {
            text: chunk,
            isComplete: false,
            metadata: {
              model,
              provider: this.name,
            },
          };
        }
      }

      // Final response with metadata
      yield {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount: Math.ceil(prompt.length / 4), // Rough estimate
          candidatesTokenCount: Math.ceil(fullResponseText.length / 4), // Rough estimate
          model,
          provider: this.name,
        },
      };
    } catch (error) {
      console.error('DeepSeek streaming error:', error);
      throw new Error(`DeepSeek API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
