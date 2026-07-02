import { ChatParams, StreamingResponse, ToolDefinition } from '../llmAdapter';
import { readSseDataLines } from './sse';
import { resolveToolPolicy } from './toolPolicyUtils';

interface OpenAICompatibleToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAICompatibleMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAICompatibleToolCall[];
  tool_call_id?: string;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: OpenAICompatibleMessage;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface StreamOptions {
  endpoint: string;
  headers: Record<string, string>;
  providerName: string;
  model: string;
  params: ChatParams;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  defaultMaxToolRounds?: number;
}

interface RecoverableToolErrorResult {
  ok: false;
  recoverable: true;
  code: string;
  message: string;
  guidance: string;
  details?: Record<string, unknown>;
}

interface NormalizedOpenAICompatibleToolCall {
  name: string;
  args: Record<string, unknown>;
  argsError?: RecoverableToolErrorResult;
}

const MAX_RAW_TOOL_ARGS_PREVIEW_LENGTH = 500;

const buildTruncatedRawArgsDetails = (rawArgs: string): Record<string, unknown> => ({
  rawArgsLength: rawArgs.length,
  rawArgsPreview:
    rawArgs.length > MAX_RAW_TOOL_ARGS_PREVIEW_LENGTH
      ? `${rawArgs.slice(0, MAX_RAW_TOOL_ARGS_PREVIEW_LENGTH)}…`
      : rawArgs,
  truncated: rawArgs.length > MAX_RAW_TOOL_ARGS_PREVIEW_LENGTH,
});

const buildFinalSystemPrompt = (params: ChatParams): string => {
  if (!params.ragContext) {
    return params.systemPrompt;
  }

  const ragPreamble = `Use the information from the following context to inform your response to the user's question. Provide a natural, conversational answer as if the information is part of your general knowledge, without mentioning the context or documents directly. If the answer is not found in the provided information, state that you don't have the relevant information to answer the question. <context> ${params.ragContext} </context>`;
  return `${params.systemPrompt}\n\n${ragPreamble}`;
};

const buildMessages = (params: ChatParams, systemPrompt: string): OpenAICompatibleMessage[] => {
  const MAX_HISTORY_MESSAGES = 20;
  const truncatedHistory =
    params.history.length > MAX_HISTORY_MESSAGES
      ? params.history.slice(-MAX_HISTORY_MESSAGES)
      : params.history;

  return [
    { role: 'system', content: systemPrompt },
    ...truncatedHistory.map(msg => ({
      role: msg.role === 'model' ? ('assistant' as const) : ('user' as const),
      content: msg.content,
    })),
    { role: 'user', content: params.message },
  ];
};

const buildTools = (tools?: ToolDefinition[]) => {
  if (!tools?.length) {
    return undefined;
  }

  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.prompt ? `${tool.description} ${tool.prompt}` : tool.description,
      parameters: tool.parameters,
    },
  }));
};

const buildToolChoice = (params: ChatParams, tools?: ToolDefinition[]) => {
  if (!tools?.length) {
    return undefined;
  }

  const { toolChoice } = resolveToolPolicy(params);

  switch (toolChoice.mode) {
    case 'none':
      return 'none';
    case 'requireAny':
      return 'required';
    case 'requireSpecific':
      return {
        type: 'function',
        function: {
          name: toolChoice.name,
        },
      };
    case 'auto':
    default:
      return 'auto';
  }
};

const parseToolArgs = (
  rawArgs?: string,
): { args: Record<string, unknown>; error?: RecoverableToolErrorResult } => {
  if (typeof rawArgs === 'undefined') {
    return { args: {} };
  }

  try {
    const parsed = JSON.parse(rawArgs);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown> };
    }
  } catch (error) {
    console.warn('Failed to parse tool arguments:', error);
    return {
      args: {},
      error: {
        ok: false,
        recoverable: true,
        code: 'tool-arguments-invalid-json',
        message: 'Tool call arguments must be valid JSON object syntax.',
        guidance:
          'Retry the same tool with a valid JSON object for arguments. Keep payloads smaller if the request is large.',
        details: buildTruncatedRawArgsDetails(rawArgs),
      },
    };
  }

  return {
    args: {},
    error: {
      ok: false,
      recoverable: true,
      code: 'tool-arguments-invalid-shape',
      message: 'Tool call arguments must decode to a JSON object.',
      guidance:
        'Retry the same tool with key/value object arguments instead of an array, string, or null.',
      details: buildTruncatedRawArgsDetails(rawArgs),
    },
  };
};

const normalizeToolCall = (
  toolCall: OpenAICompatibleToolCall,
): NormalizedOpenAICompatibleToolCall | null => {
  const name = toolCall.function?.name;
  if (!name) {
    return null;
  }

  const { args, error } = parseToolArgs(toolCall.function?.arguments);
  return {
    name,
    args,
    argsError: error,
  };
};

const createToolMessage = (toolCallId: string, result: unknown): OpenAICompatibleMessage => ({
  role: 'tool',
  tool_call_id: toolCallId,
  content: JSON.stringify(result),
});

const executeToolCalls = async (
  toolCalls: OpenAICompatibleToolCall[],
  executeTool: NonNullable<ChatParams['executeTool']>,
): Promise<OpenAICompatibleMessage[]> => {
  const toolMessages: OpenAICompatibleMessage[] = [];

  for (const toolCall of toolCalls) {
    const normalizedToolCall = normalizeToolCall(toolCall);
    if (!normalizedToolCall || !toolCall.id) {
      continue;
    }

    if (normalizedToolCall.argsError) {
      toolMessages.push(createToolMessage(toolCall.id, normalizedToolCall.argsError));
      continue;
    }

    const result = await executeTool({
      name: normalizedToolCall.name,
      args: normalizedToolCall.args,
    });

    toolMessages.push(createToolMessage(toolCall.id, result));
  }

  return toolMessages;
};

const fetchToolCallResponse = async (
  options: StreamOptions,
  messages: OpenAICompatibleMessage[],
) => {
  const {
    endpoint,
    headers,
    model,
    params,
    defaultTemperature = 0.7,
    defaultMaxTokens = 4096,
  } = options;

  const { visibleTools } = resolveToolPolicy(params);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      tools: buildTools(visibleTools),
      tool_choice: buildToolChoice(params, visibleTools),
      stream: false,
      temperature: params.temperature || defaultTemperature,
      max_tokens: params.maxTokens || defaultMaxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${response.statusText} - ${errorText}`);
  }

  return (await response.json()) as OpenAICompatibleResponse;
};

export async function* streamOpenAICompatibleChat(
  options: StreamOptions,
): AsyncIterable<StreamingResponse> {
  const {
    endpoint,
    headers,
    providerName,
    model,
    params,
    defaultTemperature = 0.7,
    defaultMaxTokens = 4096,
    defaultMaxToolRounds = 20,
  } = options;

  const systemPrompt = buildFinalSystemPrompt(params);
  let messages = buildMessages(params, systemPrompt);
  let promptTokenCount = 0;
  let candidatesTokenCount = 0;
  const { visibleTools } = resolveToolPolicy(params);
  const MAX_OPENAI_COMPATIBLE_TOOL_ROUNDS = Math.max(1, Math.round(defaultMaxToolRounds));

  if (visibleTools?.length && params.executeTool) {
    let toolRoundCount = 0;

    while (true) {
      const toolResponse = await fetchToolCallResponse(options, messages);
      const assistantMessage = toolResponse.choices?.[0]?.message;

      promptTokenCount += toolResponse.usage?.prompt_tokens || 0;
      candidatesTokenCount += toolResponse.usage?.completion_tokens || 0;

      if (!assistantMessage?.tool_calls?.length) {
        if (assistantMessage?.content) {
          yield {
            text: assistantMessage.content,
            isComplete: false,
            metadata: {
              model,
              provider: providerName,
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
            provider: providerName,
          },
        };
        return;
      }

      if (toolRoundCount >= MAX_OPENAI_COMPATIBLE_TOOL_ROUNDS) {
        throw new Error(
          `OpenAI-compatible providers exceeded maximum tool rounds (${MAX_OPENAI_COMPATIBLE_TOOL_ROUNDS}).`,
        );
      }

      const toolMessages = await executeToolCalls(assistantMessage.tool_calls, params.executeTool);
      messages = [...messages, assistantMessage, ...toolMessages];
      toolRoundCount += 1;
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: params.temperature || defaultTemperature,
      max_tokens: params.maxTokens || defaultMaxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${response.statusText} - ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response reader');
  }

  for await (const data of readSseDataLines(reader)) {
    if (data === '[DONE]') {
      break;
    }

    try {
      const parsed = JSON.parse(data);
      const deltaContent = parsed.choices?.[0]?.delta?.content;

      if (deltaContent) {
        candidatesTokenCount++;

        yield {
          text: deltaContent,
          isComplete: false,
          metadata: {
            model,
            provider: providerName,
          },
        };
      }

      if (parsed.usage) {
        promptTokenCount = parsed.usage.prompt_tokens || promptTokenCount;
        candidatesTokenCount = parsed.usage.completion_tokens || candidatesTokenCount;
      }
    } catch {
      continue;
    }
  }

  yield {
    text: '',
    isComplete: true,
    metadata: {
      promptTokenCount,
      candidatesTokenCount,
      model,
      provider: providerName,
    },
  };
}
