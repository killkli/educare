import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';

interface OpenAIModel {
  id: string;
}

export class OpenAINativeProvider implements LLMProvider {
  readonly name = 'openai';
  readonly displayName = 'OpenAI';
  readonly supportedModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
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
    // Nothing specific needed for reinitializing OpenAI
  }

  async getAvailableModels(): Promise<string[]> {
    if (!this.config.apiKey) {
      return this.supportedModels;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        console.warn('Failed to fetch OpenAI models, using default list');
        return this.supportedModels;
      }

      const data = await response.json();
      const models = data.data
        .filter((model: OpenAIModel) => model.id.startsWith('gpt-'))
        .map((model: OpenAIModel) => model.id)
        .sort();

      return models.length > 0 ? models : this.supportedModels;
    } catch (error) {
      console.warn('Error fetching OpenAI models:', error);
      return this.supportedModels;
    }
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    if (!this.config.apiKey) {
      throw new Error('請先在設定中配置 OpenAI API KEY 才能使用聊天功能。');
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

    const model = params.model || this.config.model || 'gpt-4o';

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
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          temperature: params.temperature || this.config.temperature || 0.7,
          max_tokens: params.maxTokens || this.config.maxTokens || 4096,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
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
      console.error('OpenAI streaming error:', error);
      throw new Error(`OpenAI API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
