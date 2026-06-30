import {
  Chat,
  createPartFromFunctionResponse,
  FunctionCallingConfigMode,
  type FunctionCall,
  type FunctionDeclaration,
  GenerateContentResponse,
  GoogleGenAI,
  type Part,
} from '@google/genai';
import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';
import { ApiKeyManager } from '../apiKeyManager';
import { resolveToolPolicy } from './toolPolicyUtils';

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
  private initializationPromise: Promise<void> | null = null;
  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.initializationAttempted = true;

    this.initializationPromise = (async () => {
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
    })();

    await this.initializationPromise;
  }

  isAvailable(): boolean {
    if (this.ai) {
      return true;
    }

    if (this.config.apiKey) {
      return true;
    }

    if (ApiKeyManager.hasGeminiApiKey()) {
      return true;
    }

    if (typeof process !== 'undefined' && process.env?.API_KEY) {
      return true;
    }

    return false;
  }

  reinitialize(): void {
    this.ai = null;
    this.initializationAttempted = false;
    this.initializationPromise = null;
    // Don't call initialize here - it will be called by ProviderManager
    // with the correct updated config
  }

  async getAvailableModels(): Promise<string[]> {
    const ai = await this.getAi();

    if (!ai) {
      return this.supportedModels;
    }

    try {
      const modelPager = await (ai as any).models?.list?.({
        config: {
          pageSize: 100,
        },
      });

      if (!modelPager) {
        return this.supportedModels;
      }

      const models: string[] = [];

      for await (const listedModel of modelPager as AsyncIterable<{
        name?: string;
        supportedGenerationMethods?: string[];
      }>) {
        const supportedGenerationMethods = Array.isArray(listedModel?.supportedGenerationMethods)
          ? listedModel.supportedGenerationMethods
          : [];

        if (
          supportedGenerationMethods.length > 0 &&
          !supportedGenerationMethods.includes('generateContent')
        ) {
          continue;
        }

        const normalizedName = listedModel?.name?.replace(/^models\//, '');
        if (!normalizedName) {
          continue;
        }

        models.push(normalizedName);
      }

      const uniqueModels = Array.from(new Set(models)).sort();
      return uniqueModels.length > 0 ? uniqueModels : this.supportedModels;
    } catch (error) {
      console.warn('Error fetching Gemini models:', error);
      return this.supportedModels;
    }
  }

  private async getAi(): Promise<GoogleGenAI | null> {
    if (!this.initializationAttempted) {
      await this.initialize(this.config);
    } else if (this.initializationPromise) {
      await this.initializationPromise;
    }

    return this.ai;
  }

  private buildFinalSystemPrompt(params: ChatParams): string {
    if (!params.ragContext) {
      return params.systemPrompt;
    }

    const ragPreamble = `Use the information from the following context to inform your response to the user's question. Provide a natural, conversational answer as if the information is part of your general knowledge, without mentioning the context or documents directly. If the answer is not found in the provided information, state that you don't have the relevant information to answer the question. <context> ${params.ragContext} </context>`;
    return `${params.systemPrompt}\n\n${ragPreamble}`;
  }

  private async createChat(
    params: ChatParams,
    finalSystemPrompt: string,
    model: string,
  ): Promise<Chat> {
    const MAX_HISTORY_MESSAGES = 20;
    const truncatedHistory =
      params.history.length > MAX_HISTORY_MESSAGES
        ? params.history.slice(-MAX_HISTORY_MESSAGES)
        : params.history;

    const { visibleTools, toolChoice } = resolveToolPolicy(params);
    const functionDeclarations: FunctionDeclaration[] | undefined = visibleTools?.map(tool => ({
      name: tool.name,
      description: tool.prompt ? `${tool.description} ${tool.prompt}` : tool.description,
      parametersJsonSchema: tool.parameters,
    }));

    const ai = await this.getAi();
    if (!ai) {
      throw new Error('請先在設定中配置 Gemini API KEY 才能使用聊天功能。');
    }

    const functionCallingConfig = (() => {
      switch (toolChoice.mode) {
        case 'none':
          return {
            mode: FunctionCallingConfigMode.NONE,
          };
        case 'requireAny':
          return {
            mode: FunctionCallingConfigMode.ANY,
          };
        case 'requireSpecific':
          return {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [toolChoice.name],
          };
        case 'auto':
        default:
          return {
            mode: FunctionCallingConfigMode.AUTO,
          };
      }
    })();

    return ai.chats.create({
      model,
      config: {
        systemInstruction: finalSystemPrompt,
        temperature: (params.temperature as number | undefined) || this.config.temperature || 0.7,
        maxOutputTokens: (params.maxTokens as number | undefined) || this.config.maxTokens || 4096,
        ...(functionDeclarations?.length
          ? {
              tools: [{ functionDeclarations }],
              toolConfig: {
                functionCallingConfig,
              },
            }
          : {}),
      },
      history: truncatedHistory.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.content }],
      })),
    });
  }

  private getResponseParts(response: GenerateContentResponse): Part[] {
    return response.candidates?.[0]?.content?.parts ?? [];
  }

  private extractVisibleText(response: GenerateContentResponse): string {
    const parts = this.getResponseParts(response);

    if (parts.length > 0) {
      return parts
        .filter(part => typeof part.text === 'string' && !part.thought)
        .map(part => part.text ?? '')
        .join('');
    }

    return response.text ?? '';
  }

  private getFunctionCalls(response: GenerateContentResponse): FunctionCall[] {
    const parts = this.getResponseParts(response);

    if (parts.length > 0) {
      return parts.flatMap(part => (part.functionCall?.name ? [part.functionCall] : []));
    }

    return (response.functionCalls ?? []).filter((functionCall): functionCall is FunctionCall =>
      Boolean(functionCall.name),
    );
  }

  private normalizeToolResult(result: unknown): unknown {
    if (typeof result === 'undefined') {
      return null;
    }

    try {
      return JSON.parse(JSON.stringify(result)) as unknown;
    } catch {
      throw new Error('Gemini tool result could not be serialized.');
    }
  }

  private buildCompletionChunk(
    response: GenerateContentResponse,
    model: string,
  ): StreamingResponse {
    return {
      text: '',
      isComplete: true,
      metadata: {
        promptTokenCount: response.usageMetadata?.promptTokenCount ?? 0,
        candidatesTokenCount: response.usageMetadata?.candidatesTokenCount ?? 0,
        model,
        provider: this.name,
      },
    };
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    const genAI = await this.getAi();

    if (!genAI) {
      throw new Error('請先在設定中配置 Gemini API KEY 才能使用聊天功能。');
    }

    if (!this.isAvailable()) {
      throw new Error('請先在設定中配置 Gemini API KEY 才能使用聊天功能。');
    }

    const model = params.model || this.config.model || 'gemini-2.5-flash';
    const finalSystemPrompt = this.buildFinalSystemPrompt(params);
    const MAX_GEMINI_TOOL_ROUNDS = 5;

    try {
      const chat = await this.createChat(params, finalSystemPrompt, model);

      if (params.tools?.length && params.executeTool) {
        let response = await chat.sendMessage({ message: params.message });
        let toolRoundCount = 0;

        while (true) {
          const functionCalls = this.getFunctionCalls(response);

          if (functionCalls.length === 0) {
            const visibleText = this.extractVisibleText(response);
            if (!visibleText) {
              throw new Error(
                'Gemini terminal response had no visible text or actionable tool calls.',
              );
            }

            yield {
              text: visibleText,
              isComplete: false,
              metadata: {
                model,
                provider: this.name,
              },
            };

            yield this.buildCompletionChunk(response, model);
            return;
          }

          if (toolRoundCount >= MAX_GEMINI_TOOL_ROUNDS) {
            throw new Error(`Gemini exceeded maximum tool rounds (${MAX_GEMINI_TOOL_ROUNDS}).`);
          }

          const toolResponses = [];

          for (const functionCall of functionCalls) {
            const functionName = functionCall.name;
            if (!functionName) {
              continue;
            }

            const result = await params.executeTool({
              name: functionName,
              args:
                functionCall.args && typeof functionCall.args === 'object'
                  ? (functionCall.args as Record<string, unknown>)
                  : {},
            });

            toolResponses.push(
              createPartFromFunctionResponse(functionCall.id ?? '', functionName, {
                output: this.normalizeToolResult(result),
              }),
            );
          }

          toolRoundCount += 1;
          response = await chat.sendMessage({ message: toolResponses });
        }
      }

      const stream = await chat.sendMessageStream({ message: params.message });
      let aggregatedResponse: GenerateContentResponse | null = null;

      for await (const chunk of stream) {
        const chunkText = this.extractVisibleText(chunk);
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

      yield this.buildCompletionChunk(aggregatedResponse ?? new GenerateContentResponse(), model);
    } catch (error) {
      console.error('Gemini streaming error:', error);
      throw error;
    }
  }
}
