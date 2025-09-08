import LLM from '@themaximalist/llm.js';
import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';
  readonly displayName = 'Anthropic Claude';
  readonly supportedModels = [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
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
    // Nothing specific needed for reinitializing Claude
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    if (!this.config.apiKey) {
      throw new Error('請先在設定中配置 Anthropic API KEY 才能使用聊天功能。');
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

    const model = params.model || this.config.model || 'claude-3-5-sonnet-20241022';

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
      console.error('Claude streaming error:', error);
      throw new Error(`Claude API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
