import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionCallingConfigMode } from '@google/genai';
import { GeminiProvider } from './geminiProvider';
import { ApiKeyManager } from '../apiKeyManager';

const TOOL_DEFINITIONS = [
  {
    name: 'render_preview',
    description: 'Render an HTML preview',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_docs',
    description: 'Search docs',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
] as const;

describe('GeminiProvider', () => {
  const originalProcess = globalThis.process;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.process = {
      env: {},
    } as typeof process;
  });

  afterEach(() => {
    globalThis.process = originalProcess;
    vi.restoreAllMocks();
  });

  const setupProvider = async (provider: GeminiProvider) => {
    vi.spyOn(ApiKeyManager, 'getGeminiApiKey').mockImplementation(
      () => 'AIzaSy123456789012345678901234567890123',
    );
    vi.spyOn(ApiKeyManager, 'hasGeminiApiKey').mockReturnValue(true);

    const fakeStream = (async function* () {
      yield { text: 'hello', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    })();

    const sendMessageStream = vi.fn().mockResolvedValue(fakeStream);
    const create = vi.fn().mockReturnValue({
      sendMessageStream,
    });

    const chats = { create };

    vi.spyOn(provider, 'initialize').mockImplementation(async config => {
      await Promise.resolve();
      Object.assign(provider as object, {
        config,
        initializationAttempted: true,
        initializationPromise: Promise.resolve(),
        ai: { chats },
      });
    });

    return { create, sendMessageStream };
  };

  it('awaits lazy initialization before creating a chat stream', async () => {
    const provider = new GeminiProvider();
    const { create, sendMessageStream } = await setupProvider(provider);

    const responses = [];
    for await (const chunk of provider.streamChat({
      message: 'Hi',
      history: [],
      systemPrompt: 'You are helpful.',
      model: 'gemini-2.5-flash',
    })) {
      responses.push(chunk);
    }

    expect(create).toHaveBeenCalledTimes(1);
    expect(sendMessageStream).toHaveBeenCalledWith({ message: 'Hi' });
    expect(responses[0]?.text).toBe('hello');
    expect(responses.at(-1)?.isComplete).toBe(true);
  });

  it('keeps AUTO mode without allowedFunctionNames by default', async () => {
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);

    for await (const chunk of provider.streamChat({
      message: 'Hi',
      history: [],
      systemPrompt: 'You are helpful.',
      model: 'gemini-2.5-flash',
      tools: [...TOOL_DEFINITIONS],
    })) {
      void chunk;
    }

    const createConfig = create.mock.calls[0]?.[0]?.config;
    expect(createConfig.toolConfig.functionCallingConfig.mode).toBe(FunctionCallingConfigMode.AUTO);
    expect(createConfig.toolConfig.functionCallingConfig.allowedFunctionNames).toBeUndefined();
  });

  it('prunes visible tools while preserving AUTO mode', async () => {
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);

    for await (const chunk of provider.streamChat({
      message: 'Hi',
      history: [],
      systemPrompt: 'You are helpful.',
      model: 'gemini-2.5-flash',
      tools: [...TOOL_DEFINITIONS],
      allowedToolNames: ['render_preview'],
    })) {
      void chunk;
    }

    const createConfig = create.mock.calls[0]?.[0]?.config;
    expect(createConfig.tools[0].functionDeclarations).toHaveLength(1);
    expect(createConfig.tools[0].functionDeclarations[0]?.name).toBe('render_preview');
    expect(createConfig.toolConfig.functionCallingConfig.mode).toBe(FunctionCallingConfigMode.AUTO);
    expect(createConfig.toolConfig.functionCallingConfig.allowedFunctionNames).toBeUndefined();
  });

  it('uses ANY plus allowedFunctionNames only for requireSpecific', async () => {
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);

    for await (const chunk of provider.streamChat({
      message: 'Hi',
      history: [],
      systemPrompt: 'You are helpful.',
      model: 'gemini-2.5-flash',
      tools: [...TOOL_DEFINITIONS],
      toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
    })) {
      void chunk;
    }

    const createConfig = create.mock.calls[0]?.[0]?.config;
    expect(createConfig.toolConfig.functionCallingConfig).toEqual({
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: ['render_preview'],
    });
  });
});
