import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatContainer from '../ChatContainer';
import { createMockChatSession, TEST_ASSISTANTS } from './test-utils';
import { useAppContext } from '../../core/useAppContext';

const {
  mockCreateNewSession,
  mockStreamChat,
  mockPerformCachedRagQuery,
  mockResultsToContextString,
} = vi.hoisted(() => ({
  mockCreateNewSession: vi.fn().mockResolvedValue(undefined),
  mockStreamChat: vi.fn(),
  mockPerformCachedRagQuery: vi.fn(),
  mockResultsToContextString: vi.fn(),
}));

vi.mock('../../core/useAppContext', async () => {
  const React = await import('react');
  return {
    AppContext: React.createContext({
      actions: {
        createNewSession: mockCreateNewSession,
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAppContext).mockReturnValue({
      actions: {
        createNewSession: mockCreateNewSession,
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
    const user = userEvent.setup();
    render(<ChatContainer {...defaultProps} />);

    await user.type(screen.getByRole('textbox', { name: '輸入訊息' }), 'Need help');
    await user.click(screen.getByRole('button', { name: '傳送訊息' }));

    await waitFor(() => {
      expect(screen.getByText('Need help')).toBeInTheDocument();
    });
  });

  it('starts a new shared conversation from the header button', async () => {
    const user = userEvent.setup();
    const session = createMockChatSession({
      messages: [{ role: 'user', content: 'Existing message' }],
      tokenCount: 99,
    });

    render(<ChatContainer {...defaultProps} session={session} sharedMode={true} />);

    await user.click(screen.getByTitle('開啟新對話'));

    await waitFor(() => {
      expect(mockCreateNewSession).toHaveBeenCalledWith(defaultProps.assistantId);
    });

    expect(screen.getByTestId('welcome-message')).toBeInTheDocument();
    expect(screen.queryByText('Existing message')).not.toBeInTheDocument();
  });
});
