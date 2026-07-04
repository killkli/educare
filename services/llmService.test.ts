import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockInitializeProviders,
  mockGetActiveProvider,
  mockHasKnowledgeChunks,
  mockBuildKnowledgeSearchResponse,
  mockExecuteHtmlProjectToolCall,
  mockRecordHtmlProjectTelemetryEvent,
} = vi.hoisted(() => ({
  mockInitializeProviders: vi.fn(),
  mockGetActiveProvider: vi.fn(),
  mockHasKnowledgeChunks: vi.fn(),
  mockBuildKnowledgeSearchResponse: vi.fn(),
  mockExecuteHtmlProjectToolCall: vi.fn(),
  mockRecordHtmlProjectTelemetryEvent: vi.fn(),
}));

vi.mock('./providerRegistry', () => ({
  initializeProviders: mockInitializeProviders,
  providerManager: {
    getActiveProvider: mockGetActiveProvider,
  },
}));

vi.mock('./knowledgeSearchService', () => ({
  buildKnowledgeSearchResponse: mockBuildKnowledgeSearchResponse,
  hasKnowledgeChunks: mockHasKnowledgeChunks,
  KNOWLEDGE_SEARCH_SYSTEM_PROMPT: 'Knowledge prompt',
  KNOWLEDGE_SEARCH_TOOL_DESCRIPTION: 'Knowledge tool',
  KNOWLEDGE_SEARCH_TOOL_NAME: 'knowledgeSearch',
  KNOWLEDGE_SEARCH_TOOL_SCHEMA: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
}));

vi.mock('./htmlProjectToolService', async importOriginal => {
  const actual = await importOriginal<typeof import('./htmlProjectToolService')>();

  return {
    ...actual,
    executeHtmlProjectToolCall: mockExecuteHtmlProjectToolCall,
  };
});

vi.mock('./htmlProjectAgentTelemetry', () => ({
  recordHtmlProjectTelemetryEvent: mockRecordHtmlProjectTelemetryEvent,
}));

describe('streamChat', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockInitializeProviders.mockResolvedValue(undefined);
    mockHasKnowledgeChunks.mockReturnValue(false);
    mockBuildKnowledgeSearchResponse.mockReturnValue({ matches: [] });
    mockExecuteHtmlProjectToolCall.mockResolvedValue({
      workspace: {
        activeProjectId: 'project-123',
        activityMessage: 'updated project',
        preview: null,
      },
      result: {
        projectId: 'project-123',
        updated: ['/index.html'],
      },
      summary: 'updated project',
    });
  });

  it('rejects non-visible HTML project tools with a recoverable routing error', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        const executeTool = params.executeTool as (call: {
          name: string;
          args: Record<string, unknown>;
        }) => Promise<unknown>;
        const badToolResult = await executeTool({
          name: 'writeFiles',
          args: {
            projectId: 'project-123',
            files: [{ path: '/index.html', content: '<main>Hi</main>' }],
          },
        });

        expect(badToolResult).toMatchObject({
          ok: false,
          recoverable: true,
          code: 'tool-not-visible-for-turn',
          message: 'Tool writeFiles is not visible for the current HTML project route.',
          details: {
            requestedTool: 'writeFiles',
            selectedPackSet: ['inspect', 'todo_finalize', 'preview_recheck'],
            intent: 'finalize_or_complete',
          },
        });
        expect(
          (badToolResult as { details: { visibleToolNames: string[] } }).details.visibleToolNames,
        ).toEqual([
          'getProjectSummary',
          'listFiles',
          'searchFiles',
          'readFile',
          'listProjectTodos',
          'checkProjectTodos',
          'renderPreview',
          // harness-resident tools auto-attach to any non-empty HTML pack set (T4/G2)
          'reportTurnOutcome',
          'getPreviewRuntimeErrors',
          'listSnapshots',
          'revertToSnapshot',
        ]);

        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 1,
            repeatedRecoverableErrors: [
              {
                toolName: 'writeFiles',
                code: 'tool-not-visible-for-turn',
                count: 1,
              },
            ],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);

    const { streamChat } = await import('./llmService');

    await streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Please finish this and recheck preview before we wrap up.',
      assistantId: 'assistant-1',
      activeProjectId: 'project-123',
      knowledgeChunks: [],
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onProjectToolActivity: vi.fn(),
    });

    expect(mockExecuteHtmlProjectToolCall).toHaveBeenCalledTimes(1);
    expect(mockExecuteHtmlProjectToolCall).toHaveBeenNthCalledWith(
      1,
      {
        name: 'getProjectSummary',
        args: { projectId: 'project-123' },
      },
      {
        assistantId: 'assistant-1',
        sessionId: undefined,
        activeProjectId: 'project-123',
      },
    );
    expect(provider.streamChat).toHaveBeenCalledTimes(1);
    // 7 pack tools + 4 harness-resident tools (reportTurnOutcome,
    // getPreviewRuntimeErrors, listSnapshots, revertToSnapshot) auto-attached (T4/G2)
    expect(observedChatParams[0]?.tools).toHaveLength(11);
    expect(observedChatParams[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'getProjectSummary' }),
        expect.objectContaining({ name: 'listFiles' }),
        expect.objectContaining({ name: 'searchFiles' }),
        expect.objectContaining({ name: 'readFile' }),
        expect.objectContaining({ name: 'listProjectTodos' }),
        expect.objectContaining({ name: 'checkProjectTodos' }),
        expect.objectContaining({ name: 'renderPreview' }),
        expect.objectContaining({ name: 'reportTurnOutcome' }),
        expect.objectContaining({ name: 'getPreviewRuntimeErrors' }),
        expect.objectContaining({ name: 'listSnapshots' }),
        expect.objectContaining({ name: 'revertToSnapshot' }),
      ]),
    );
    expect(observedChatParams[0]?.tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'writeFiles' })]),
    );
  });

  it('returns a recoverable unsupported-tool error for unknown tool names', async () => {
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        const executeTool = params.executeTool as (call: {
          name: string;
          args: Record<string, unknown>;
        }) => Promise<unknown>;
        const result = await executeTool({
          name: 'unknownTool',
          args: { foo: 'bar' },
        });

        expect(result).toMatchObject({
          ok: false,
          recoverable: true,
          code: 'tool-unsupported',
          message: 'Unsupported tool: unknownTool',
          guidance: 'Retry using only tools that are explicitly exposed for this turn.',
          details: {
            requestedTool: 'unknownTool',
            selectedPackSet: ['inspect', 'todo_finalize', 'preview_recheck'],
            intent: 'finalize_or_complete',
          },
        });

        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 3,
            candidatesTokenCount: 1,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 1,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);

    const { streamChat } = await import('./llmService');

    await streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Please finish this and recheck preview before we wrap up.',
      assistantId: 'assistant-1',
      activeProjectId: 'project-123',
      knowledgeChunks: [],
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onProjectToolActivity: vi.fn(),
    });

    expect(mockExecuteHtmlProjectToolCall).toHaveBeenCalledTimes(1);
  });
});
