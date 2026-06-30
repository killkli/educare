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

type MockResponse = {
  text?: string;
  functionCalls?: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
};

type SetupProviderOptions = {
  sendMessageResponses?: MockResponse[];
  streamChunks?: MockResponse[];
};

type ListedModel = {
  name?: string;
  supportedGenerationMethods?: string[];
};

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

  const collectResponses = async (
    provider: GeminiProvider,
    params?: Partial<Parameters<GeminiProvider['streamChat']>[0]>,
  ) => {
    const responses = [];

    for await (const chunk of provider.streamChat({
      message: 'Hi',
      history: [],
      systemPrompt: 'You are helpful.',
      model: 'gemini-2.5-flash',
      ...params,
    })) {
      responses.push(chunk);
    }

    return responses;
  };

  const setupProvider = async (provider: GeminiProvider, options: SetupProviderOptions = {}) => {
    vi.spyOn(ApiKeyManager, 'getGeminiApiKey').mockImplementation(
      () => 'AIzaSy123456789012345678901234567890123',
    );
    vi.spyOn(ApiKeyManager, 'hasGeminiApiKey').mockReturnValue(true);

    const streamChunks = options.streamChunks ?? [
      { text: 'hello', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } },
    ];

    const fakeStream = (async function* () {
      for (const chunk of streamChunks) {
        yield chunk;
      }
    })();

    const sendMessage = vi.fn();
    for (const response of options.sendMessageResponses ?? []) {
      sendMessage.mockResolvedValueOnce(response);
    }

    const sendMessageStream = vi.fn().mockResolvedValue(fakeStream);
    const create = vi.fn().mockReturnValue({
      sendMessage,
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

    return { create, sendMessage, sendMessageStream };
  };

  const setupModelListing = async (
    provider: GeminiProvider,
    options: {
      listedModels?: ListedModel[];
      listError?: Error;
    } = {},
  ) => {
    vi.spyOn(ApiKeyManager, 'getGeminiApiKey').mockImplementation(
      () => 'AIzaSy123456789012345678901234567890123',
    );
    vi.spyOn(ApiKeyManager, 'hasGeminiApiKey').mockReturnValue(true);

    const list = vi.fn();

    if (options.listError) {
      list.mockRejectedValueOnce(options.listError);
    } else {
      const listedModels = options.listedModels ?? [];
      list.mockResolvedValueOnce(
        (async function* () {
          for (const listedModel of listedModels) {
            yield listedModel;
          }
        })(),
      );
    }

    vi.spyOn(provider, 'initialize').mockImplementation(async config => {
      await Promise.resolve();
      Object.assign(provider as object, {
        config,
        initializationAttempted: true,
        initializationPromise: Promise.resolve(),
        ai: {
          models: { list },
        },
      });
    });

    return { list };
  };

  it('lists available models from the Google GenAI client and normalizes model names', async () => {
    const provider = new GeminiProvider();
    const { list } = await setupModelListing(provider, {
      listedModels: [
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        {
          name: 'gemini-2.5-flash',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.0-flash' },
        { supportedGenerationMethods: ['generateContent'] },
      ],
    });

    const models = await provider.getAvailableModels();

    expect(list).toHaveBeenCalledWith({
      config: {
        pageSize: 100,
      },
    });
    expect(models).toEqual(['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('falls back to supportedModels when model listing throws', async () => {
    const provider = new GeminiProvider();
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { list } = await setupModelListing(provider, {
      listError: new Error('listing failed'),
    });

    const models = await provider.getAvailableModels();

    expect(list).toHaveBeenCalledTimes(1);
    expect(models).toEqual(provider.supportedModels);
    expect(warningSpy).toHaveBeenCalledWith(
      'Error fetching Gemini models:',
      expect.objectContaining({ message: 'listing failed' }),
    );
  });

  it('falls back to supportedModels when listing yields no usable models', async () => {
    const provider = new GeminiProvider();
    const { list } = await setupModelListing(provider, {
      listedModels: [
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/code-execution-only', supportedGenerationMethods: ['countTokens'] },
        {},
      ],
    });

    const models = await provider.getAvailableModels();

    expect(list).toHaveBeenCalledTimes(1);
    expect(models).toEqual(provider.supportedModels);
  });

  it('awaits lazy initialization before creating a chat stream', async () => {
    const provider = new GeminiProvider();
    const { create, sendMessageStream } = await setupProvider(provider);

    const responses = await collectResponses(provider);

    expect(create).toHaveBeenCalledTimes(1);
    expect(sendMessageStream).toHaveBeenCalledWith({ message: 'Hi' });
    expect(responses[0]?.text).toBe('hello');
    expect(responses.at(-1)?.isComplete).toBe(true);
  });

  it('keeps AUTO mode without allowedFunctionNames by default', async () => {
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);

    await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
    });

    const createConfig = create.mock.calls[0]?.[0]?.config;
    expect(createConfig.toolConfig.functionCallingConfig.mode).toBe(FunctionCallingConfigMode.AUTO);
    expect(createConfig.toolConfig.functionCallingConfig.allowedFunctionNames).toBeUndefined();
  });

  it('prunes visible tools while preserving AUTO mode', async () => {
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);

    await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      allowedToolNames: ['render_preview'],
    });

    const createConfig = create.mock.calls[0]?.[0]?.config;
    expect(createConfig.tools[0].functionDeclarations).toHaveLength(1);
    expect(createConfig.tools[0].functionDeclarations[0]?.name).toBe('render_preview');
    expect(createConfig.toolConfig.functionCallingConfig.mode).toBe(FunctionCallingConfigMode.AUTO);
    expect(createConfig.toolConfig.functionCallingConfig.allowedFunctionNames).toBeUndefined();
  });

  it('uses ANY plus allowedFunctionNames only for requireSpecific', async () => {
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);

    await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
    });

    const createConfig = create.mock.calls[0]?.[0]?.config;
    expect(createConfig.toolConfig.functionCallingConfig).toEqual({
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: ['render_preview'],
    });
  });

  it('streams a text-only response even when tools are available', async () => {
    const provider = new GeminiProvider();
    const { sendMessage, sendMessageStream } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          text: 'Tool-capable hello',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
        },
      ],
    });

    const executeTool = vi.fn();
    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    expect(sendMessage).toHaveBeenCalledWith({ message: 'Hi' });
    expect(sendMessageStream).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
    expect(responses).toEqual([
      expect.objectContaining({ text: 'Tool-capable hello', isComplete: false }),
      expect.objectContaining({
        text: '',
        isComplete: true,
        metadata: expect.objectContaining({ promptTokenCount: 2, candidatesTokenCount: 3 }),
      }),
    ]);
  });

  it('continues from one function call to a final text response without switching to streaming', async () => {
    const provider = new GeminiProvider();
    const { sendMessage, sendMessageStream } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [
            { id: 'call-1', name: 'render_preview', args: { projectId: 'project-1' } },
          ],
        },
        {
          text: 'Preview ready',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8 },
        },
      ],
    });

    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledWith({
      name: 'render_preview',
      args: { projectId: 'project-1' },
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      message: [
        expect.objectContaining({
          functionResponse: expect.objectContaining({ name: 'render_preview' }),
        }),
      ],
    });
    expect(sendMessageStream).not.toHaveBeenCalled();
    expect(responses).toEqual([
      expect.objectContaining({ text: 'Preview ready', isComplete: false }),
      expect.objectContaining({ isComplete: true }),
    ]);
  });

  it('supports multiple tool rounds before yielding final text', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'pricing' } }],
        },
        {
          functionCalls: [
            { id: 'call-2', name: 'render_preview', args: { projectId: 'project-2' } },
          ],
        },
        {
          text: 'Done after two rounds',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 11 },
        },
      ],
    });

    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ results: ['pricing doc'] })
      .mockResolvedValueOnce({ previewUrl: 'blob:project-2' });

    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    expect(executeTool).toHaveBeenNthCalledWith(1, {
      name: 'search_docs',
      args: { query: 'pricing' },
    });
    expect(executeTool).toHaveBeenNthCalledWith(2, {
      name: 'render_preview',
      args: { projectId: 'project-2' },
    });
    expect(responses).toEqual([
      expect.objectContaining({ text: 'Done after two rounds', isComplete: false }),
      expect.objectContaining({ isComplete: true }),
    ]);
  });

  it('executes multiple function calls returned in the same turn before final text', async () => {
    const provider = new GeminiProvider();
    const { sendMessage } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [
            { id: 'call-1', name: 'search_docs', args: { query: 'safety' } },
            { id: 'call-2', name: 'render_preview', args: { projectId: 'project-3' } },
          ],
        },
        {
          text: 'Both tools complete',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 12 },
        },
      ],
    });

    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ documents: 2 })
      .mockResolvedValueOnce({ previewReady: true });

    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      message: [
        expect.objectContaining({
          functionResponse: expect.objectContaining({ name: 'search_docs' }),
        }),
        expect.objectContaining({
          functionResponse: expect.objectContaining({ name: 'render_preview' }),
        }),
      ],
    });
    expect(responses).toEqual([
      expect.objectContaining({ text: 'Both tools complete', isComplete: false }),
      expect.objectContaining({ isComplete: true }),
    ]);
  });

  it('surfaces tool execution failures without attempting a follow-up stream', async () => {
    const provider = new GeminiProvider();
    const { sendMessageStream } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'broken' } }],
        },
      ],
    });

    const executeTool = vi.fn().mockRejectedValue(new Error('Tool exploded'));

    await expect(
      collectResponses(provider, {
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      }),
    ).rejects.toThrow('Tool exploded');

    expect(sendMessageStream).not.toHaveBeenCalled();
  });

  it('throws when a tool result cannot be serialized for Gemini', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'broken' } }],
        },
      ],
    });

    const circularResult: { self?: unknown } = {};
    circularResult.self = circularResult;

    const executeTool = vi.fn().mockResolvedValue(circularResult);

    await expect(
      collectResponses(provider, {
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      }),
    ).rejects.toThrow('Gemini tool result could not be serialized.');
  });

  it('throws when Gemini exceeds the maximum number of tool rounds', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      sendMessageResponses: Array.from({ length: 21 }, (_, index) => ({
        functionCalls: [
          {
            id: `call-${index + 1}`,
            name: 'search_docs',
            args: { query: `round-${index + 1}` },
          },
        ],
      })),
    });

    const executeTool = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      collectResponses(provider, {
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      }),
    ).rejects.toThrow(/max(imum)? tool round/i);
  });

  it('throws for a non-text terminal response with no actionable tool calls', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 },
        },
      ],
    });

    await expect(
      collectResponses(provider, {
        tools: [...TOOL_DEFINITIONS],
        executeTool: vi.fn(),
      }),
    ).rejects.toThrow(/non-text|no text|terminal/i);
  });

  it('preserves no-tools streaming behavior across multiple chunks', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      streamChunks: [
        { text: 'Hello ', usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 0 } },
        { text: 'world', usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5 } },
      ],
    });

    const responses = await collectResponses(provider);

    expect(responses).toEqual([
      expect.objectContaining({ text: 'Hello ', isComplete: false }),
      expect.objectContaining({ text: 'world', isComplete: false }),
      expect.objectContaining({
        text: '',
        isComplete: true,
        metadata: expect.objectContaining({ promptTokenCount: 3, candidatesTokenCount: 5 }),
      }),
    ]);
  });
});
