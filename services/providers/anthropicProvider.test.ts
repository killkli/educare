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
});
