import { ChatMessage, RagChunk, type HtmlProjectWorkspaceUpdate } from '../types';
import { ToolCall } from './llmAdapter';
import { providerManager, initializeProviders } from './providerRegistry';
import {
  buildKnowledgeSearchResponse,
  hasKnowledgeChunks,
  type KnowledgeSearchArgs,
  KNOWLEDGE_SEARCH_SYSTEM_PROMPT,
  KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
  KNOWLEDGE_SEARCH_TOOL_NAME,
  KNOWLEDGE_SEARCH_TOOL_SCHEMA,
} from './knowledgeSearchService';
import {
  executeHtmlProjectToolCall,
  getHtmlProjectToolDefinitions,
  isHtmlProjectToolName,
} from './htmlProjectToolService';
import { buildHtmlProjectSystemPrompt, shouldEnableHtmlProjectTools } from './htmlProjectPrompting';

export interface StreamChatParams {
  systemPrompt: string;
  ragContext?: string;
  history: ChatMessage[];
  message: string;
  assistantId: string;
  sessionId?: string | null;
  activeProjectId?: string | null;
  knowledgeChunks?: RagChunk[];
  onChunk: (text: string) => void;
  onProjectToolActivity?: (update: HtmlProjectWorkspaceUpdate) => void;
  onComplete: (
    metadata: { promptTokenCount: number; candidatesTokenCount: number },
    fullText: string,
  ) => void;
}

export const streamChat = async (params: StreamChatParams) => {
  const {
    systemPrompt,
    ragContext,
    history,
    message,
    assistantId,
    sessionId,
    activeProjectId,
    knowledgeChunks = [],
    onChunk,
    onProjectToolActivity,
    onComplete,
  } = params;

  await initializeProviders();

  const activeProvider = providerManager.getActiveProvider();
  if (!activeProvider) {
    throw new Error('沒有可用的 AI 服務商。請在設定中配置至少一個服務商。');
  }

  if (!activeProvider.isAvailable()) {
    throw new Error(`${activeProvider.displayName} 服務不可用。請檢查您的配置。`);
  }

  let fullResponseText = '';
  let promptTokenCount = 0;
  let candidatesTokenCount = 0;
  let resolvedActiveProjectId = activeProjectId ?? null;

  const knowledgeToolEnabled = hasKnowledgeChunks(knowledgeChunks);
  const htmlProjectToolEnabled = shouldEnableHtmlProjectTools(message, resolvedActiveProjectId);

  const finalSystemPrompt = [
    systemPrompt,
    knowledgeToolEnabled ? KNOWLEDGE_SEARCH_SYSTEM_PROMPT : '',
    htmlProjectToolEnabled ? buildHtmlProjectSystemPrompt(resolvedActiveProjectId) : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const executeTool = async (call: ToolCall) => {
    if (call.name === KNOWLEDGE_SEARCH_TOOL_NAME) {
      return buildKnowledgeSearchResponse(
        knowledgeChunks,
        call.args as unknown as KnowledgeSearchArgs,
      );
    }

    if (htmlProjectToolEnabled && isHtmlProjectToolName(call.name)) {
      const toolResult = await executeHtmlProjectToolCall(call, {
        assistantId,
        sessionId,
        activeProjectId: resolvedActiveProjectId,
      });

      resolvedActiveProjectId = toolResult.workspace.activeProjectId;
      onProjectToolActivity?.(toolResult.workspace);

      return {
        ...toolResult.result,
        summary: toolResult.summary,
      };
    }

    return { error: `Unsupported tool: ${call.name}` };
  };

  const tools = [
    ...(knowledgeToolEnabled
      ? [
          {
            name: KNOWLEDGE_SEARCH_TOOL_NAME,
            description: KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
            parameters: KNOWLEDGE_SEARCH_TOOL_SCHEMA,
          },
        ]
      : []),
    ...(htmlProjectToolEnabled ? getHtmlProjectToolDefinitions() : []),
  ];

  try {
    const chatParams = {
      systemPrompt: finalSystemPrompt,
      ragContext,
      history,
      message,
      tools: tools.length > 0 ? tools : undefined,
      executeTool: tools.length > 0 ? executeTool : undefined,
    };

    for await (const response of activeProvider.streamChat(chatParams)) {
      if (response.text && !response.isComplete) {
        onChunk(response.text);
        fullResponseText += response.text;
      }

      if (response.isComplete && response.metadata) {
        promptTokenCount = response.metadata.promptTokenCount || 0;
        candidatesTokenCount = response.metadata.candidatesTokenCount || 0;
        break;
      }
    }

    onComplete(
      {
        promptTokenCount,
        candidatesTokenCount,
      },
      fullResponseText,
    );
  } catch (error) {
    console.error('LLM streaming error:', error);

    if (error instanceof Error) {
      if (error.message.includes('API key') || error.message.includes('unauthorized')) {
        throw new Error(`API 金鑰錯誤：請檢查 ${activeProvider.displayName} 的 API 金鑰是否正確。`);
      } else if (error.message.includes('rate limit') || error.message.includes('quota')) {
        throw new Error(`API 配額不足：${activeProvider.displayName} 的使用配額已達上限。`);
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        throw new Error(`網路連接錯誤：無法連接到 ${activeProvider.displayName} 服務。`);
      }
    }

    throw error;
  }
};
