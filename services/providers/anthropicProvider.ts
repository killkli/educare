import { ChatParams, LLMProvider, ProviderConfig, StreamingResponse } from '../llmAdapter';
import { resolveToolPolicy } from './toolPolicyUtils';

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicMessageResponse {
  content?: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  usage?: AnthropicUsage;
  stop_reason?: string | null;
}

interface AnthropicRequestMessage {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        | { type: 'tool_result'; tool_use_id: string; content: string }
      >;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly displayName = 'Anthropic Claude';
  readonly supportedModels = [
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
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
    // Nothing specific needed for reinitializing Anthropic
  }

  private buildFinalSystemPrompt(params: ChatParams): string {
    if (!params.ragContext) {
      return params.systemPrompt;
    }

    const ragPreamble = `Use the information from the following context to inform your response to the user's question. Provide a natural, conversational answer as if the information is part of your general knowledge, without mentioning the context or documents directly. If the answer is not found in the provided information, state that you don't have the relevant information to answer the question. <context> ${params.ragContext} </context>`;
    return `${params.systemPrompt}\n\n${ragPreamble}`;
  }

  private buildMessages(params: ChatParams): AnthropicRequestMessage[] {
    const MAX_HISTORY_MESSAGES = 20;
    const truncatedHistory =
      params.history.length > MAX_HISTORY_MESSAGES
        ? params.history.slice(-MAX_HISTORY_MESSAGES)
        : params.history;

    return [
      ...truncatedHistory.map(message => ({
        role: message.role === 'model' ? ('assistant' as const) : ('user' as const),
        content: message.content,
      })),
      { role: 'user', content: params.message },
    ];
  }

  private buildToolChoice(
    toolChoice: ReturnType<typeof resolveToolPolicy>['toolChoice'],
  ): Record<string, string> {
    switch (toolChoice.mode) {
      case 'none':
        return { type: 'none' };
      case 'requireAny':
        return { type: 'any' };
      case 'requireSpecific':
        return { type: 'tool', name: toolChoice.name };
      case 'auto':
      default:
        return { type: 'auto' };
    }
  }

  private async createMessage(body: Record<string, unknown>): Promise<AnthropicMessageResponse> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${response.status} ${response.statusText} - ${errorText}`);
    }

    return (await response.json()) as AnthropicMessageResponse;
  }

  private extractText(response: AnthropicMessageResponse): string {
    return (
      response.content
        ?.filter((block): block is AnthropicTextBlock => block.type === 'text')
        .map(block => block.text)
        .join('') || ''
    );
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    if (!this.config.apiKey) {
      throw new Error('請先在設定中配置 Anthropic API KEY 才能使用聊天功能。');
    }

    const model = params.model || this.config.model || 'claude-opus-4-8';
    const finalSystemPrompt = this.buildFinalSystemPrompt(params);
    const { visibleTools, toolChoice } = resolveToolPolicy(params);
    const messages = this.buildMessages(params);

    const requestBody: Record<string, unknown> = {
      model,
      system: finalSystemPrompt,
      messages,
      max_tokens: params.maxTokens || this.config.maxTokens || 4096,
    };

    if (visibleTools?.length) {
      requestBody.tools = visibleTools.map(tool => ({
        name: tool.name,
        description: tool.prompt ? `${tool.description} ${tool.prompt}` : tool.description,
        input_schema: tool.parameters,
      }));
      requestBody.tool_choice = this.buildToolChoice(toolChoice);
    }

    try {
      let response = await this.createMessage(requestBody);
      let promptTokenCount = response.usage?.input_tokens || 0;
      let candidatesTokenCount = response.usage?.output_tokens || 0;
      const maxToolRounds = Math.max(1, Math.round(Number(this.config.maxToolRounds ?? 20)));
      let toolRoundCount = 0;
      let conversationMessages = [...messages];

      while (visibleTools?.length && params.executeTool) {
        const toolUseBlocks =
          response.content?.filter(
            (block): block is AnthropicToolUseBlock => block.type === 'tool_use',
          ) || [];

        if (toolUseBlocks.length === 0) {
          break;
        }

        if (toolRoundCount >= maxToolRounds) {
          throw new Error(`Anthropic exceeded maximum tool rounds (${maxToolRounds}).`);
        }

        const toolResults = [] as Array<{
          type: 'tool_result';
          tool_use_id: string;
          content: string;
        }>;

        for (const toolUseBlock of toolUseBlocks) {
          const result = await params.executeTool({
            name: toolUseBlock.name,
            args: toolUseBlock.input || {},
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: JSON.stringify(result),
          });
        }

        conversationMessages = [
          ...conversationMessages,
          {
            role: 'assistant',
            content: (response.content ?? []).map(block =>
              block.type === 'text'
                ? { type: 'text', text: block.text }
                : {
                    type: 'tool_use',
                    id: block.id,
                    name: block.name,
                    input: block.input || {},
                  },
            ),
          },
          {
            role: 'user',
            content: toolResults,
          },
        ];

        response = await this.createMessage({
          model,
          system: finalSystemPrompt,
          messages: conversationMessages,
          max_tokens: params.maxTokens || this.config.maxTokens || 4096,
          tools: visibleTools.map(tool => ({
            name: tool.name,
            description: tool.prompt ? `${tool.description} ${tool.prompt}` : tool.description,
            input_schema: tool.parameters,
          })),
          tool_choice: this.buildToolChoice(toolChoice),
        });

        promptTokenCount += response.usage?.input_tokens || 0;
        candidatesTokenCount += response.usage?.output_tokens || 0;
        toolRoundCount += 1;
      }

      const finalText = this.extractText(response);
      if (finalText) {
        yield {
          text: finalText,
          isComplete: false,
          metadata: {
            model,
            provider: this.name,
          },
        };
      }

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
      console.error('Anthropic streaming error:', error);
      throw new Error(`Anthropic API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
