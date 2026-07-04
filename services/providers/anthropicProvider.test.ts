import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropicProvider';

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
] as const;

const createJsonResponse = (payload: unknown) =>
  new globalThis.Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('AnthropicProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends Anthropic-native tool fields in auto mode', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: 'anthropic-test-key', model: 'claude-opus-4-8' });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
    );

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.text).toBe('done');

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.tools[0]).toMatchObject({
      name: 'render_preview',
      input_schema: TOOL_DEFINITIONS[0].parameters,
    });
    expect(body.tools[0]?.function).toBeUndefined();
    expect(body.allowedFunctionNames).toBeUndefined();
    expect(body.toolConfig).toBeUndefined();
  });

  it('preserves auto mode when restricting visible tools', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: 'anthropic-test-key', model: 'claude-opus-4-8' });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        content: [{ type: 'text', text: 'subset' }],
        usage: { input_tokens: 2, output_tokens: 1 },
      }),
    );

    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [
        ...TOOL_DEFINITIONS,
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
      ],
      allowedToolNames: ['render_preview'],
    })) {
      void chunk;
    }

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]?.name).toBe('render_preview');
  });

  it('maps requireSpecific to Anthropic tool choice', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: 'anthropic-test-key', model: 'claude-opus-4-8' });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        content: [{ type: 'text', text: 'specific' }],
        usage: { input_tokens: 2, output_tokens: 1 },
      }),
    );

    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
    })) {
      void chunk;
    }

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toEqual({
      type: 'tool',
      name: 'render_preview',
    });
  });

  it('supports multiple tool rounds before yielding final text', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
      maxToolRounds: 20,
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-2',
              name: 'render_preview',
              input: { projectId: 'project-2' },
            },
          ],
          usage: { input_tokens: 3, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 4, output_tokens: 2 },
        }),
      );

    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ ok: 'first' })
      .mockResolvedValueOnce({ ok: 'second' });

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    })) {
      chunks.push(chunk);
    }

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(chunks[0]?.text).toBe('done');
  });

  it('serializes recoverable tool error payloads into tool_result content and continues to final text', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
      maxToolRounds: 20,
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [{ type: 'text', text: 'Recovered after tool error' }],
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
      );

    const recoverableError = {
      ok: false,
      recoverable: true,
      code: 'preview-temporary-unavailable',
      message: 'Preview service is still starting.',
      guidance: 'Retry the same preview shortly.',
      details: { retryAfterMs: 750 },
    };
    const executeTool = vi.fn().mockResolvedValue(recoverableError);

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    })) {
      chunks.push(chunk);
    }

    expect(executeTool).toHaveBeenCalledWith({
      name: 'render_preview',
      args: { projectId: 'project-1' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks[0]?.text).toBe('Recovered after tool error');

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: JSON.stringify(recoverableError),
        },
      ],
    });
  });

  it('stops after repeated recoverable tool errors and reports matching completion metadata', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
      maxToolRounds: 20,
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-2',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 3, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-3',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 4, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [{ type: 'text', text: 'unused stop-route response' }],
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
      );

    const recoverableError = {
      ok: false,
      recoverable: true,
      code: 'preview-temporary-unavailable',
      message: 'Preview service is still starting.',
      guidance: 'Retry the same preview shortly.',
      details: { retryAfterMs: 750 },
    };
    const executeTool = vi.fn().mockResolvedValue(recoverableError);

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    })) {
      chunks.push(chunk);
    }

    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(chunks[0]).toMatchObject({
      text: 'Stopped repeated recoverable tool failures and need a different repair path: render_preview:preview-temporary-unavailable x3',
      isComplete: false,
      metadata: {
        model: 'claude-opus-4-8',
        provider: 'anthropic',
      },
    });
    expect(chunks[1]).toMatchObject({
      text: '',
      isComplete: true,
      metadata: {
        model: 'claude-opus-4-8',
        provider: 'anthropic',
        toolRoundCount: 3,
        repeatedRecoverableErrors: [
          {
            toolName: 'render_preview',
            code: 'preview-temporary-unavailable',
            count: 3,
          },
        ],
      },
    });

    const fourthRequestBody = JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string);
    const stopRoutePayload = JSON.parse(fourthRequestBody.messages.at(-1).content[0].content);
    expect(stopRoutePayload).toMatchObject({
      recoverable: false,
      loopAction: 'stop-route',
      escalation: {
        toolName: 'render_preview',
        code: 'preview-temporary-unavailable',
        attempt: 3,
      },
    });
  });

  it('throws when Anthropic exceeds the maximum number of tool rounds', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
      maxToolRounds: 2,
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'loop-call',
              name: 'render_preview',
              input: { projectId: 'project-loop' },
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      ),
    );
    const executeTool = vi.fn().mockResolvedValue({ ok: true });

    await expect(async () => {
      for await (const chunk of provider.streamChat({
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      })) {
        void chunk;
      }
    }).rejects.toThrow('Anthropic exceeded maximum tool rounds (2).');

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
