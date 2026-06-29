import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamOpenAICompatibleChat } from './openAICompatibleToolUtils';

const TOOL_DEFINITIONS = [
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
  {
    name: 'render_preview',
    description: 'Render preview',
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

describe('streamOpenAICompatibleChat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses auto tool choice by default and avoids Gemini-only fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: 'assistant', content: 'done' } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
    );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool: vi.fn(),
      },
    })) {
      responses.push(chunk);
    }

    expect(responses[0]?.text).toBe('done');

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools).toHaveLength(2);
    expect(body.toolConfig).toBeUndefined();
    expect(body.allowedFunctionNames).toBeUndefined();
    expect(body.functionCallingConfig).toBeUndefined();
  });

  it('prunes visible tools without forcing a tool call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: 'assistant', content: 'subset ok' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );

    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        allowedToolNames: ['render_preview'],
        executeTool: vi.fn(),
      },
    })) {
      void chunk;
    }

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]?.function?.name).toBe('render_preview');
  });

  it('maps requireAny to required tool choice', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: 'assistant', content: 'required' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );

    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        toolChoice: { mode: 'requireAny' },
        executeTool: vi.fn(),
      },
    })) {
      void chunk;
    }

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toBe('required');
  });

  it('maps requireSpecific to the OpenAI-specific function shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: 'assistant', content: 'specific' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );

    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
        executeTool: vi.fn(),
      },
    })) {
      void chunk;
    }

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toEqual({
      type: 'function',
      function: {
        name: 'render_preview',
      },
    });
  });
});
