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

  it('downgrades forced tool choice to auto after the first tool round', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi.fn().mockResolvedValueOnce({ html: '<div>preview</div>' });

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'render_preview',
                      arguments: JSON.stringify({ projectId: 'proj-123' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Recovered after required tool call.',
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
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
        toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(responses.at(0)).toMatchObject({ text: 'Recovered after required tool call.' });

    const firstRequestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(firstRequestBody.tool_choice).toEqual({
      type: 'function',
      function: {
        name: 'render_preview',
      },
    });
    expect(secondRequestBody.tool_choice).toBe('auto');
  });

  it('handles two tool-call rounds before yielding the final assistant text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ matches: ['doc-1'] })
      .mockResolvedValueOnce({ html: '<div>preview</div>' });

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: JSON.stringify({ query: 'financial aid' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-2',
                    type: 'function',
                    function: {
                      name: 'render_preview',
                      arguments: JSON.stringify({ projectId: 'proj-123' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Here is the completed preview.',
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
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
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).toHaveBeenNthCalledWith(1, {
      name: 'search_docs',
      args: { query: 'financial aid' },
    });
    expect(executeTool).toHaveBeenNthCalledWith(2, {
      name: 'render_preview',
      args: { projectId: 'proj-123' },
    });
    expect(responses).toEqual([
      {
        text: 'Here is the completed preview.',
        isComplete: false,
        metadata: {
          model: 'gpt-4o',
          provider: 'openai',
        },
      },
      {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 6,
          model: 'gpt-4o',
          provider: 'openai',
        },
      },
    ]);

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    const thirdRequestBody = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string);

    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: JSON.stringify({ matches: ['doc-1'] }),
    });
    expect(thirdRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-2',
      content: JSON.stringify({ html: '<div>preview</div>' }),
    });
  });

  it('serializes malformed tool calls without a function name as recoverable tool errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi.fn();

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-missing-name',
                    type: 'function',
                    function: {
                      arguments: JSON.stringify({ query: 'financial aid' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Recovered after missing tool name.',
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
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
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).not.toHaveBeenCalled();
    expect(responses.at(0)).toMatchObject({ text: 'Recovered after missing tool name.' });

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-missing-name',
      content: JSON.stringify({
        ok: false,
        recoverable: true,
        code: 'tool-call-missing-name',
        message: 'Tool call is missing a function name.',
        guidance: 'Retry the tool call with a valid function name and JSON object arguments.',
        details: {
          toolCallType: 'function',
        },
      }),
    });
  });

  it('serializes malformed tool-call JSON as a recoverable tool error and continues to final text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi.fn();
    const malformedArguments = '{"query":';

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: malformedArguments,
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Recovered after invalid tool arguments.',
              },
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
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
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).not.toHaveBeenCalled();
    expect(responses).toEqual([
      {
        text: 'Recovered after invalid tool arguments.',
        isComplete: false,
        metadata: {
          model: 'gpt-4o',
          provider: 'openai',
        },
      },
      {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount: 7,
          candidatesTokenCount: 3,
          model: 'gpt-4o',
          provider: 'openai',
        },
      },
    ]);

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: JSON.stringify({
        ok: false,
        recoverable: true,
        code: 'tool-arguments-invalid-json',
        message: 'Tool call arguments must be valid JSON object syntax.',
        guidance:
          'Retry the same tool with a valid JSON object for arguments. Keep payloads smaller if the request is large.',
        details: {
          rawArgsLength: malformedArguments.length,
          rawArgsPreview: malformedArguments,
          truncated: false,
        },
      }),
    });
  });

  it('treats empty tool argument strings as invalid JSON instead of silently calling the tool with {}', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi.fn();

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-empty',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: '',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Recovered after empty tool arguments.',
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
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
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).not.toHaveBeenCalled();
    expect(responses.at(0)).toMatchObject({ text: 'Recovered after empty tool arguments.' });

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-empty',
      content: JSON.stringify({
        ok: false,
        recoverable: true,
        code: 'tool-arguments-invalid-json',
        message: 'Tool call arguments must be valid JSON object syntax.',
        guidance:
          'Retry the same tool with a valid JSON object for arguments. Keep payloads smaller if the request is large.',
        details: {
          rawArgsLength: 0,
          rawArgsPreview: '',
          truncated: false,
        },
      }),
    });
  });

  it('throws a clear error after exceeding the maximum number of tool rounds', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'loop-call',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: JSON.stringify({ query: 'loop forever' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      ),
    );
    const executeTool = vi.fn().mockResolvedValue({ matches: [] });

    await expect(async () => {
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
          executeTool,
        },
      })) {
        void chunk;
      }
    }).rejects.toThrow('OpenAI-compatible providers exceeded maximum tool rounds (20).');

    expect(executeTool).toHaveBeenCalledTimes(20);
    expect(fetchMock).toHaveBeenCalledTimes(21);
  });
});
