import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';

export class OllamaNativeProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly displayName = 'Ollama';
  readonly supportedModels = [
    'llama3.2:latest',
    'llama3.1:latest',
    'llama3.2:3b',
    'llama3.1:8b',
    'llama3.1:70b',
    'gemma2:latest',
    'mistral:latest',
    'codellama:latest',
    'qwen2:latest',
    'phi3:latest',
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
    // Nothing specific needed for reinitializing Ollama
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';

    if (!baseUrl) {
      throw new Error('請先在設定中配置 Ollama 基礎 URL 才能使用聊天功能。');
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

    const model = params.model || this.config.model || 'llama3.2:latest';

    // Build Ollama messages format
    const messages = [
      { role: 'system', content: finalSystemPrompt },
      ...truncatedHistory.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content,
      })),
      { role: 'user', content: params.message },
    ];

    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          options: {
            temperature: params.temperature || this.config.temperature || 0.7,
            num_predict: params.maxTokens || this.config.maxTokens || 4096,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      const decoder = new TextDecoder();
      let tokenCount = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim());

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);

              if (parsed.message?.content) {
                const content = parsed.message.content;
                tokenCount++;

                yield {
                  text: content,
                  isComplete: false,
                  metadata: {
                    model,
                    provider: this.name,
                  },
                };
              }

              // Check if response is complete
              if (parsed.done) {
                break;
              }
            } catch {
              // Skip invalid JSON lines
              continue;
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
          promptTokenCount: tokenCount, // Ollama doesn't provide separate counts
          candidatesTokenCount: tokenCount,
          model,
          provider: this.name,
        },
      };
    } catch (error) {
      console.error('Ollama streaming error:', error);
      throw new Error(`Ollama API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
