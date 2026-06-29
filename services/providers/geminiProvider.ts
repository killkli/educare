import {
  Chat,
  createPartFromFunctionResponse,
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  GenerateContentResponse,
  GoogleGenAI,
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
    return this.supportedModels;
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

    try {
      if (params.tools?.length && params.executeTool) {
        const chat = await this.createChat(params, finalSystemPrompt, model);
        const initialResponse = await chat.sendMessage({ message: params.message });
        const functionCalls = initialResponse.functionCalls || [];

        if (functionCalls.length > 0) {
          const toolResponses = [];

          for (const functionCall of functionCalls) {
            if (!functionCall.name) {
              continue;
            }

            const result = await params.executeTool({
              name: functionCall.name,
              args:
                functionCall.args && typeof functionCall.args === 'object'
                  ? (functionCall.args as Record<string, unknown>)
                  : {},
            });

            toolResponses.push(
              createPartFromFunctionResponse(functionCall.id ?? '', functionCall.name, {
                output: result,
              }),
            );
          }

          const finalStream = await chat.sendMessageStream({ message: toolResponses });
          let aggregatedResponse: GenerateContentResponse | null = null;

          for await (const chunk of finalStream) {
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
          return;
        }

        const initialText = initialResponse.text;
        if (initialText) {
          yield {
            text: initialText,
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
            promptTokenCount: initialResponse.usageMetadata?.promptTokenCount ?? 0,
            candidatesTokenCount: initialResponse.usageMetadata?.candidatesTokenCount ?? 0,
            model,
            provider: this.name,
          },
        };
        return;
      }

      const chat = await this.createChat(params, finalSystemPrompt, model);
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
    } catch (error) {
      console.error('Gemini streaming error:', error);
      throw error;
    }
  }
}
