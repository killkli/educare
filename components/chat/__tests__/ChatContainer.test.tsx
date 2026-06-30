import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatContainer from '../ChatContainer';
import { createMockChatSession, TEST_ASSISTANTS } from './test-utils';
import { useAppContext } from '../../core/useAppContext';
import type { HtmlProjectPreviewArtifact } from '../../../types';

const {
  mockCreateNewSession,
  mockStreamChat,
  mockPerformCachedRagQuery,
  mockResultsToContextString,
  mockSetActiveProject,
  mockSetProjectWorkspaceOpen,
  mockSetProjectPreview,
  mockAppendProjectActivity,
  mockClearProjectWorkspace,
} = vi.hoisted(() => ({
  mockCreateNewSession: vi.fn().mockResolvedValue(undefined),
  mockStreamChat: vi.fn(),
  mockPerformCachedRagQuery: vi.fn(),
  mockResultsToContextString: vi.fn(),
  mockSetActiveProject: vi.fn(),
  mockSetProjectWorkspaceOpen: vi.fn(),
  mockSetProjectPreview: vi.fn(),
  mockAppendProjectActivity: vi.fn(),
  mockClearProjectWorkspace: vi.fn(),
}));

vi.mock('../../core/useAppContext', async () => {
  const React = await import('react');
  return {
    AppContext: React.createContext({
      actions: {
        createNewSession: mockCreateNewSession,
        setActiveProject: mockSetActiveProject,
        setProjectWorkspaceOpen: mockSetProjectWorkspaceOpen,
        setProjectPreview: mockSetProjectPreview,
        appendProjectActivity: mockAppendProjectActivity,
        clearProjectWorkspace: mockClearProjectWorkspace,
      },
    }),
    useAppContext: vi.fn(),
  };
});

vi.mock('../../../services/llmService', () => ({
  streamChat: mockStreamChat,
}));

vi.mock('../../../services/ragCacheManagerV2', () => ({
  ragCacheManagerV2: {
    performCachedRagQuery: mockPerformCachedRagQuery,
    resultsToContextString: mockResultsToContextString,
  },
}));

vi.mock('../../../services/ragQueryService', () => ({
  ragQueryService: {
    performRagQuery: vi.fn(),
    resultsToContextString: vi.fn(),
  },
}));

vi.mock('../../../services/ragSettingsService', () => ({
  getRagSettingsService: () => ({
    getVectorSearchLimit: () => 20,
    isRerankingEnabled: () => false,
    getRerankLimit: () => 5,
    getMinSimilarity: () => 0.3,
  }),
}));

vi.mock('../../settings', () => ({
  RagSettingsModal: () => null,
}));

describe('ChatContainer', () => {
  const defaultProps = {
    session: createMockChatSession(),
    assistantName: TEST_ASSISTANTS.basicAssistant.name,
    systemPrompt: TEST_ASSISTANTS.basicAssistant.systemPrompt,
    assistantId: TEST_ASSISTANTS.basicAssistant.id,
    ragChunks: [],
    onNewMessage: vi.fn(),
    hideHeader: false,
    sharedMode: false,
    assistantDescription: TEST_ASSISTANTS.basicAssistant.description,
  };

  const sendMessage = async (message: string) => {
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: '輸入訊息' }), message);
    await user.click(screen.getByRole('button', { name: '傳送訊息' }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAppContext).mockReturnValue({
      actions: {
        createNewSession: mockCreateNewSession,
        setActiveProject: mockSetActiveProject,
        setProjectWorkspaceOpen: mockSetProjectWorkspaceOpen,
        setProjectPreview: mockSetProjectPreview,
        appendProjectActivity: mockAppendProjectActivity,
        clearProjectWorkspace: mockClearProjectWorkspace,
      },
    } as unknown as ReturnType<typeof useAppContext>);

    mockPerformCachedRagQuery.mockResolvedValue({
      results: [],
      fromCache: false,
      queryTime: 12,
      ragMetadata: {
        source: 'indexeddb',
        totalCandidates: 0,
        filteredCandidates: 0,
        finalResults: 0,
      },
    });
    mockResultsToContextString.mockReturnValue('');
    mockStreamChat.mockImplementation(async ({ message, onChunk, onComplete }) => {
      onChunk('Hello');
      onComplete({ promptTokenCount: 10, candidatesTokenCount: 15 }, `${message} reply`);
    });
  });

  it('renders the header and welcome state for an empty session', () => {
    render(<ChatContainer {...defaultProps} />);

    expect(
      screen.getByRole('heading', { level: 2, name: defaultProps.assistantName }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('welcome-message')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: '聊天對話' })).toBeInTheDocument();
  });

  it('hides the header when hideHeader is true', () => {
    render(<ChatContainer {...defaultProps} hideHeader={true} />);

    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('renders existing messages and suppresses the welcome message', () => {
    const session = createMockChatSession({
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'model', content: 'First answer' },
      ],
    });

    render(<ChatContainer {...defaultProps} session={session} />);

    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.getByText('First answer')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-message')).not.toBeInTheDocument();
  });

  it('adds the user message immediately when sending', async () => {
    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Need help');

    await waitFor(() => {
      expect(screen.getByText('Need help')).toBeInTheDocument();
    });
  });

  it('passes assistant, session, and active project ids to streamChat', async () => {
    const session = createMockChatSession({ activeProjectId: 'project-42' });

    render(<ChatContainer {...defaultProps} session={session} />);

    await sendMessage('Continue building');

    await waitFor(() => {
      expect(mockStreamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantId: defaultProps.assistantId,
          sessionId: session.id,
          activeProjectId: 'project-42',
          message: 'Continue building',
        }),
      );
    });
  });

  it('wires project tool activity into AppContext workspace actions', async () => {
    const preview: HtmlProjectPreviewArtifact = {
      projectId: 'project-99',
      previewVersion: 3,
      entryFile: '/index.html',
      previewReady: true,
      previewUrlType: 'blob',
      html: '<html></html>',
      url: 'blob:preview-99',
      warnings: [],
      error: null,
      generatedAt: Date.now(),
    };

    mockStreamChat.mockImplementationOnce(async ({ onProjectToolActivity, onComplete }) => {
      onProjectToolActivity({
        activeProjectId: 'project-99',
        preview,
        activityMessage: 'Updated preview',
      });
      onComplete({ promptTokenCount: 1, candidatesTokenCount: 2 }, 'Done');
    });

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Make a landing page');

    await waitFor(() => {
      expect(mockSetActiveProject).toHaveBeenCalledWith('project-99');
      expect(mockSetProjectWorkspaceOpen).toHaveBeenCalledWith(true);
      expect(mockSetProjectPreview).toHaveBeenCalledWith(preview);
      expect(mockAppendProjectActivity).toHaveBeenCalledWith('Updated preview');
    });
  });

  it('clears loading state when completion happens before any chunk arrives', async () => {
    mockStreamChat.mockImplementationOnce(async ({ onComplete }) => {
      onComplete({ promptTokenCount: 2, candidatesTokenCount: 4 }, 'Final response');
    });

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Finish without chunk');

    await waitFor(() => {
      expect(screen.getByText('Final response')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: '正在傳送訊息' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '輸入訊息' })).toBeEnabled();
    expect(screen.queryByText('🤖 生成回答...')).not.toBeInTheDocument();
  });

  it('clears loading state and shows the error when rejection happens before any chunk arrives', async () => {
    mockStreamChat.mockRejectedValueOnce(new Error('Gemini terminal response had no visible text'));

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Fail before chunk');

    await waitFor(() => {
      expect(screen.getByText(/Gemini terminal response had no visible text/)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: '正在傳送訊息' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '輸入訊息' })).toBeEnabled();
    expect(screen.queryByText('🤖 生成回答...')).not.toBeInTheDocument();
  });

  it('starts a new shared conversation from the header button', async () => {
    const user = userEvent.setup();
    const session = createMockChatSession({
      messages: [{ role: 'user', content: 'Existing message' }],
      tokenCount: 99,
      activeProjectId: 'project-7',
    });

    render(<ChatContainer {...defaultProps} session={session} sharedMode={true} />);

    await user.click(screen.getByTitle('開啟新對話'));

    await waitFor(() => {
      expect(mockCreateNewSession).toHaveBeenCalledWith(defaultProps.assistantId);
    });

    expect(mockClearProjectWorkspace).toHaveBeenCalled();
    expect(screen.getByTestId('welcome-message')).toBeInTheDocument();
    expect(screen.queryByText('Existing message')).not.toBeInTheDocument();
  });
});
