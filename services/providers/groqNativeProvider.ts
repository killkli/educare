import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';

interface GroqModel {
  id: string;
  active: boolean;
}

export class GroqNativeProvider implements LLMProvider {
  readonly name = 'groq';
  readonly displayName = 'Groq';
  readonly supportedModels = [
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'mixtral-8x7b-32768',
    'gemma-7b-it',
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

  async getAvailableModels(): Promise<string[]> {
    if (!this.config.apiKey) {
      return this.supportedModels;
    }

    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        console.warn('Failed to fetch Groq models, using default list');
        return this.supportedModels;
      }

      const data = await response.json();
      const models = data.data
        .filter((model: GroqModel) => model.active)
        .map((model: GroqModel) => model.id)
        .sort();

      return models.length > 0 ? models : this.supportedModels;
    } catch (error) {
      console.warn('Error fetching Groq models:', error);
      return this.supportedModels;
    }
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
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
        const errorText = await response.text();
        throw new Error(`Groq API error: ${response.status} ${response.statusText} - ${errorText}`);
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
      console.error('Groq streaming error:', error);
      throw new Error(`Groq API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
