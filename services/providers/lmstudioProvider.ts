import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';

export class LMStudioProvider implements LLMProvider {
  readonly name = 'lmstudio';
  readonly displayName = 'LM Studio';
  readonly supportedModels = [
    'local-model',
    'llama-2-7b-chat',
    'llama-2-13b-chat',
    'code-llama-7b-instruct',
    'mistral-7b-instruct',
    'phi-2',
  ];
  readonly requiresApiKey = false;
  readonly supportsLocalMode = true;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  isAvailable(): boolean {
    // For local mode, we assume it's available if baseUrl is configured
    return !!this.config.baseUrl;
  }

  reinitialize(): void {
    // Nothing specific needed for reinitializing LMStudio
  }

  async getAvailableModels(): Promise<string[]> {
    const baseUrl = this.config.baseUrl || 'http://localhost:1234/v1';

    try {
      const response = await fetch(`${baseUrl}/models`);

      if (!response.ok) {
        console.warn('Failed to fetch LM Studio models, using default list');
        return this.supportedModels;
      }

      const data = await response.json();
      const models = data.data?.map((model: any) => model.id) || [];

      return models.length > 0 ? models : this.supportedModels;
    } catch (error) {
      console.warn('Error fetching LM Studio models:', error);
      return this.supportedModels;
    }
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    const baseUrl = this.config.baseUrl || 'http://localhost:1234/v1';

    if (!baseUrl) {
      throw new Error('請先在設定中配置 LM Studio 基礎 URL 才能使用聊天功能。');
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

    const model = params.model || this.config.model || 'local-model';

    // Convert to OpenAI message format
    const messages = [
      { role: 'system', content: finalSystemPrompt },
      ...truncatedHistory.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content,
      })),
      { role: 'user', content: params.message },
    ];

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add API key if provided (some LMStudio setups might use it)
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          temperature: params.temperature || this.config.temperature || 0.7,
          max_tokens: params.maxTokens || this.config.maxTokens || 4096,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `LM Studio API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      const decoder = new TextDecoder();
      let promptTokenCount = 0;
      let candidatesTokenCount = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                break;
              }

              try {
                const parsed = JSON.parse(data);
                const deltaContent = parsed.choices?.[0]?.delta?.content;

                if (deltaContent) {
                  candidatesTokenCount++;

                  yield {
                    text: deltaContent,
                    isComplete: false,
                    metadata: {
                      model,
                      provider: this.name,
                    },
                  };
                }

                // Get usage info if available
                if (parsed.usage) {
                  promptTokenCount = parsed.usage.prompt_tokens || 0;
                  candidatesTokenCount = parsed.usage.completion_tokens || candidatesTokenCount;
                }
              } catch {
                // Skip invalid JSON lines
                continue;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Final response with metadata
      yield {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount,
          candidatesTokenCount,
          model,
          provider: this.name,
        },
      };
    } catch (error) {
      console.error('LM Studio streaming error:', error);
      throw new Error(`LM Studio API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
