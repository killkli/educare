import { ChatParams, StreamingResponse, ToolCall, ToolDefinition } from '../llmAdapter';

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
}

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

const parseToolArgs = (rawArgs?: string): Record<string, unknown> => {
  if (!rawArgs) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawArgs);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    console.warn('Failed to parse tool arguments:', error);
  }

  return {};
};

const normalizeToolCall = (toolCall: OpenAICompatibleToolCall): ToolCall | null => {
  const name = toolCall.function?.name;
  if (!name) {
    return null;
  }

  return {
    name,
    args: parseToolArgs(toolCall.function?.arguments),
  };
};

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

    const result = await executeTool(normalizedToolCall);

    toolMessages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify(result),
    });
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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      tools: buildTools(params.tools),
      tool_choice: 'auto',
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
  } = options;

  const systemPrompt = buildFinalSystemPrompt(params);
  let messages = buildMessages(params, systemPrompt);
  let promptTokenCount = 0;
  let candidatesTokenCount = 0;

  if (params.tools?.length && params.executeTool) {
    const toolResponse = await fetchToolCallResponse(options, messages);
    const assistantMessage = toolResponse.choices?.[0]?.message;

    promptTokenCount = toolResponse.usage?.prompt_tokens || 0;
    candidatesTokenCount = toolResponse.usage?.completion_tokens || 0;

    if (assistantMessage?.tool_calls?.length) {
      const toolMessages = await executeToolCalls(assistantMessage.tool_calls, params.executeTool);
      messages = [...messages, assistantMessage, ...toolMessages];
    } else if (assistantMessage?.content) {
      yield {
        text: assistantMessage.content,
        isComplete: false,
        metadata: {
          model,
          provider: providerName,
        },
      };

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

  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          continue;
        }

        const data = line.slice(6);
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
    }
  } finally {
    reader.releaseLock();
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
