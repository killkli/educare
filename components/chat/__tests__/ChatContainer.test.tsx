import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ChatContainer from '../ChatContainer';
import {
  setupTestEnvironment,
  TEST_SESSIONS,
  TEST_ASSISTANTS,
  createMockChatSession,
} from './test-utils';
import { ragCacheManagerV2 } from '../../../services/ragCacheManagerV2';

// Stable spy created via vi.hoisted so the mock factory always exports the exact same
// vi.fn() reference — even if Vitest re-evaluates the mock module between tests.
// Without this, the test's import binding becomes stale while the component receives
// a freshly-created spy, breaking mockImplementation calls in individual tests.
const { mockStreamChat } = vi.hoisted(() => ({
  mockStreamChat: vi.fn(),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid='markdown-content'>{children}</div>
  ),
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-highlight', () => ({ default: vi.fn() }));
vi.mock('highlight.js/styles/github-dark.css', () => ({}));
vi.mock('../../ui/Icons', () => ({
  GeminiIcon: ({ className }: { className?: string }) => (
    <span data-testid='gemini-icon' className={className}>
      Gemini
    </span>
  ),
  UserIcon: ({ className }: { className?: string }) => (
    <span data-testid='user-icon' className={className}>
      User
    </span>
  ),
}));
vi.mock('../../../services/embeddingService', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  cosineSimilarity: vi.fn().mockReturnValue(0.8),
}));
vi.mock('../../../services/tursoService', () => ({
  searchSimilarChunks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../services/llmService', () => ({
  streamChat: mockStreamChat,
}));
vi.mock('../../core/useAppContext', () => ({
  useAppContext: () => ({
    actions: {
      createNewSession: vi.fn().mockResolvedValue({
        id: 'new-session-1',
        assistantId: 'test-assistant-1',
        title: 'New Chat',
        messages: [],
        createdAt: Date.now(),
        tokenCount: 0,
      }),
    },
    state: {},
    dispatch: vi.fn(),
  }),
}));
vi.mock('../../../services/ragCacheManagerV2', () => ({
  ragCacheManagerV2: {
    performCachedRagQuery: vi.fn().mockResolvedValue({
      results: [],
      fromCache: false,
      queryTime: 0,
      cacheStats: null,
      ragMetadata: { source: 'test', totalCandidates: 0, filteredCandidates: 0, finalResults: 0 },
    }),
    resultsToContextString: vi.fn().mockReturnValue(''),
  },
}));
vi.mock('../../../services/ragQueryService', () => ({
  ragQueryService: {
    performRagQuery: vi.fn().mockResolvedValue({ results: [] }),
    resultsToContextString: vi.fn().mockReturnValue(''),
  },
}));
vi.mock('../../../services/ragSettingsService', () => ({
  getRagSettingsService: () => ({
    getVectorSearchLimit: vi.fn().mockReturnValue(5),
    isRerankingEnabled: vi.fn().mockReturnValue(false),
    getRerankLimit: vi.fn().mockReturnValue(3),
    getMinSimilarity: vi.fn().mockReturnValue(0.5),
  }),
}));
vi.mock('../../settings', () => ({
  RagSettingsModal: () => null,
}));

describe('ChatContainer', () => {
  let testEnv: ReturnType<typeof setupTestEnvironment>;

  const defaultProps = {
    session: TEST_SESSIONS.emptySession,
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
    // Fresh onNewMessage each test to avoid stale call counts
    defaultProps.onNewMessage = vi.fn();
    testEnv = setupTestEnvironment();

    // Re-establish streamChat implementation for each test.
    // Uses mockStreamChat (the hoisted stable spy) so beforeEach and tests always
    // reference the same vi.fn() that the component receives via the mock factory.
    mockStreamChat.mockImplementation(
      async ({
        onChunk,
        onComplete,
      }: {
        onChunk?: (chunk: string) => void;
        onComplete?: (
          tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
          response: string,
        ) => void;
      }) => {
        await new Promise<void>(resolve => setTimeout(resolve, 10));
        if (onChunk) {
          onChunk('Hello world!');
        }
        await new Promise<void>(resolve => setTimeout(resolve, 60));
        if (onComplete) {
          onComplete({ promptTokenCount: 10, candidatesTokenCount: 15 }, 'Hello world!');
        }
      },
    );

    vi.mocked(ragCacheManagerV2.performCachedRagQuery).mockResolvedValue({
      results: [],
      fromCache: false,
      queryTime: 0,
      cacheStats: null,
      ragMetadata: { source: 'test', totalCandidates: 0, filteredCandidates: 0, finalResults: 0 },
    });

    vi.mocked(ragCacheManagerV2.resultsToContextString).mockReturnValue('');
  });

  afterEach(async () => {
    // Flush any pending async work from in-flight handleSend before cleanup
    await act(async () => {});
    // Restore only the explicit spies (console, Date.now) — NOT vi.restoreAllMocks(),
    // which resets vi.mock() factory implementations (streamChat, ragCacheManagerV2)
    // and breaks subsequent tests even after beforeEach re-establishes them.
    testEnv.consoleSpy.mockRestore();
    testEnv.consoleErrorSpy.mockRestore();
    testEnv.dateNow.spy.mockRestore();
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render chat container with all components', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} />);

      // Assert
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /傳送/ })).toBeInTheDocument();
    });

    it('should render header when not hidden', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} hideHeader={false} />);

      // Assert
      const headers = screen.getAllByText(defaultProps.assistantName);
      expect(headers.length).toBeGreaterThan(0);
      const headerSection = screen.getByRole('heading', { level: 2 }).closest('div');
      expect(headerSection).toBeInTheDocument();
    });

    it('should hide header when hideHeader is true', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} hideHeader={true} />);

      // Assert
      expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    });

    it('should have proper ARIA labels', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} />);

      // Assert
      const main = screen.getByRole('main');
      expect(main).toHaveAttribute('aria-label', '聊天對話');
    });
  });

  describe('Welcome Message Display', () => {
    it('should show welcome message for empty session', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} session={TEST_SESSIONS.emptySession} />);

      // Assert
      const welcomeMessage = screen.getByTestId('welcome-message');
      expect(welcomeMessage).toBeInTheDocument();
      expect(within(welcomeMessage).getByText(defaultProps.assistantName)).toBeInTheDocument();
      expect(
        within(welcomeMessage).getByText(defaultProps.assistantDescription!),
      ).toBeInTheDocument();
    });

    it('should not show welcome message when session has messages', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} session={TEST_SESSIONS.sessionWithMessages} />);

      // Assert
      // Welcome message should not be visible when there are existing messages
      const welcomeMessages = screen.queryAllByText(defaultProps.assistantDescription!);
      expect(welcomeMessages).toHaveLength(0);
    });

    it('should pass sharedMode to welcome message', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} sharedMode={true} />);

      // Assert
      expect(screen.getByText('分享的 AI 助理 - 您的對話不會永久儲存')).toBeInTheDocument();
    });
  });

  describe('Message Rendering', () => {
    it('should render existing messages', () => {
      // Arrange
      const sessionWithMessages = createMockChatSession({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'model', content: 'Hi there!' },
        ],
      });

      // Act
      render(<ChatContainer {...defaultProps} session={sessionWithMessages} />);

      // Assert
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.getByText('Hi there!')).toBeInTheDocument();
    });

    it('should render messages with proper indices', () => {
      // Arrange
      const sessionWithMessages = createMockChatSession({
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'model', content: 'Second message' },
          { role: 'user', content: 'Third message' },
        ],
      });

      // Act
      render(<ChatContainer {...defaultProps} session={sessionWithMessages} />);

      // Assert
      expect(screen.getByText('First message')).toBeInTheDocument();
      expect(screen.getByText('Second message')).toBeInTheDocument();
      expect(screen.getByText('Third message')).toBeInTheDocument();
    });

    it('should maintain message order', () => {
      // Arrange
      const sessionWithMessages = createMockChatSession({
        messages: [
          { role: 'user', content: 'Question 1' },
          { role: 'model', content: 'Answer 1' },
          { role: 'user', content: 'Question 2' },
          { role: 'model', content: 'Answer 2' },
        ],
      });

      // Act
      render(<ChatContainer {...defaultProps} session={sessionWithMessages} />);

      // Assert
      const messages = screen.getAllByTestId('markdown-content');
      expect(messages[0]).toHaveTextContent('Question 1');
      expect(messages[1]).toHaveTextContent('Answer 1');
      expect(messages[2]).toHaveTextContent('Question 2');
      expect(messages[3]).toHaveTextContent('Answer 2');
    });
  });

  describe('Input Handling', () => {
    it('should handle text input changes', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');

      // Assert
      expect(textarea).toHaveValue('Test message');
    });

    it('should clear input after sending message', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');
      const sendButton = screen.getByRole('button', { name: /傳送/ });
      await user.click(sendButton);

      // Assert
      await waitFor(() => {
        expect(textarea).toHaveValue('');
      });

      // Drain handleSend fully — prevents in-flight async ops from leaking into next test
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });
    });

    it('should disable input during loading', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');
      const sendButton = screen.getByRole('button', { name: /傳送/ });
      await user.click(sendButton);

      // Assert
      await waitFor(() => {
        expect(textarea).toBeDisabled();
      });

      // Drain handleSend fully — prevents in-flight async ops from leaking into next test
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });
    });
  });

  describe('Send Message Flow', () => {
    it('should handle send button click', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Hello AI');
      const sendButton = screen.getByRole('button', { name: /傳送/ });
      await user.click(sendButton);

      // Assert
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });
    });

    it('should handle Enter key press', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Hello AI');
      await user.keyboard('{Enter}');

      // Assert
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });
    });

    it('should not send empty messages', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, '   '); // Only whitespace

      // Assert — send button is disabled for whitespace-only input
      const sendButton = screen.getByRole('button', { name: /傳送/ });
      expect(sendButton).toBeDisabled();
      expect(defaultProps.onNewMessage).not.toHaveBeenCalled();
    });

    it('should prevent sending during loading state', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'First message');
      const sendButton = screen.getByRole('button', { name: /傳送/ });

      // Send first message (starts loading)
      await user.click(sendButton);

      // While loading the button is disabled — verify it cannot trigger a second send
      expect(sendButton).toBeDisabled();

      // Assert
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Thinking and Streaming States', () => {
    it('should show thinking indicator during processing', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');
      const sendButton = screen.getByRole('button', { name: /傳送/ });
      await user.click(sendButton);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('AI 正在思考...')).toBeInTheDocument();
      });

      // Drain handleSend fully — prevents in-flight async ops from leaking into next test
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });
    });

    it('should show streaming response when available', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');
      const sendButton = screen.getByRole('button', { name: /傳送/ });
      await user.click(sendButton);

      // Assert — thinking indicator appears while AI processes, then the streamed AI response
      // is committed to the session once onComplete fires.
      await waitFor(() => {
        expect(screen.getByText('AI 正在思考...')).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });
      // The streamed content appears as a chat message after onComplete
      expect(screen.getByText('Hello world!')).toBeInTheDocument();
    });

    it('should hide thinking indicator when streaming starts', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');
      const sendButton = screen.getByRole('button', { name: /傳送/ });
      await user.click(sendButton);

      // Assert
      // Initially should show thinking
      await waitFor(() => {
        expect(screen.getByText('AI 正在思考...')).toBeInTheDocument();
      });

      // After streaming starts, thinking should be hidden
      await waitFor(
        () => {
          expect(screen.queryByText('AI 正在思考...')).not.toBeInTheDocument();
        },
        { timeout: 200 },
      );

      // Drain handleSend fully — prevents in-flight async ops from leaking into next test
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });
    });
  });

  describe('Session Management Integration', () => {
    it('should update session when props change', () => {
      // Arrange
      const { rerender } = render(<ChatContainer {...defaultProps} />);

      const newSession = createMockChatSession({
        id: 'new-session',
        messages: [{ role: 'user', content: 'New message' }],
      });

      // Act
      rerender(<ChatContainer {...defaultProps} session={newSession} />);

      // Assert
      expect(screen.getByText('New message')).toBeInTheDocument();
    });

    it('should call onNewMessage with correct parameters', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test query');
      const sendButton = screen.getByRole('button', { name: /傳送/ });
      await user.click(sendButton);

      // Assert
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalledWith(
          expect.any(Object), // session
          'Test query', // userMessage
          'Hello world!', // modelResponse
          { promptTokenCount: 10, candidatesTokenCount: 15 }, // tokenInfo
        );
      });
    });

    it('should maintain session state during interaction', async () => {
      // Arrange
      const user = userEvent.setup();
      const sessionWithToken = createMockChatSession({ tokenCount: 100 });
      render(<ChatContainer {...defaultProps} session={sessionWithToken} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');

      // Assert
      expect(screen.getByText('100')).toBeInTheDocument(); // Token counter
    });
  });

  describe('Shared Mode Functionality', () => {
    it('should pass sharedMode to input component', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} sharedMode={true} />);

      // Assert — send button is disabled when no text is entered
      const sendButton = screen.getByRole('button', { name: /傳送/ });
      expect(sendButton).toBeDisabled();
    });

    it('should enable input in shared mode when text is present', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} sharedMode={true} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Some text');

      // Assert
      expect(textarea).not.toBeDisabled();
    });

    it('should show shared mode indicators in welcome message', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} sharedMode={true} />);

      // Assert
      expect(screen.getByText('分享的 AI 助理 - 您的對話不會永久儲存')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle errors during message sending', async () => {
      // Override the beforeEach implementation so streamChat throws.
      // Uses mockStreamChat (the vi.hoisted stable spy) which is the exact same
      // reference the component receives — no stale-binding issues.
      mockStreamChat.mockImplementation(async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 10));
        throw new Error('Network error');
      });

      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      await user.type(screen.getByRole('textbox'), 'Test message');
      await user.click(screen.getByRole('button', { name: /傳送/ }));

      // Wait for the catch block to execute — it calls console.error then sets the error
      // streaming response. Polling via waitFor handles the async delay in the error impl.
      await waitFor(() => {
        expect(testEnv.consoleErrorSpy).toHaveBeenCalledWith(
          'Error during chat stream:',
          expect.any(Error),
        );
      });

      // getAllByTestId because the user MessageBubble also renders a markdown-content element;
      // the last one is the StreamingResponse content (error text).
      const allMarkdown = screen.getAllByTestId('markdown-content');
      expect(allMarkdown[allMarkdown.length - 1]).toHaveTextContent('抱歉，發生錯誤');
    });

    it('should reset states after error', async () => {
      // Arrange — make streamChat reject so loading/thinking states are cleared
      mockStreamChat.mockRejectedValueOnce(new Error('Test error'));

      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Error message');
      const sendButton = screen.getByRole('button', { name: /傳送/ });
      await user.click(sendButton);

      // Wait for error state — thinking indicator should clear
      await waitFor(() => {
        expect(screen.queryByText('AI 正在思考...')).not.toBeInTheDocument();
      });

      // Assert — input should be re-enabled after error
      expect(textarea).not.toBeDisabled();
    });
  });

  describe('Header Visibility Controls', () => {
    it('should show header by default', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} />);

      // Assert — h2 is the header heading (h3 also exists in WelcomeMessage)
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toHaveTextContent(defaultProps.assistantName);
      const headerSection = heading.closest('.bg-gray-800');
      expect(headerSection).toHaveClass('border-b', 'border-gray-700', 'p-2');
    });

    it('should hide header when hideHeader is true', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} hideHeader={true} />);

      // Assert — only h3 in WelcomeMessage remains; h2 header is gone
      expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    });

    it('should apply proper styling to header', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} hideHeader={false} />);

      // Assert — header div wraps the h2; actual class is p-2 md:p-4
      const header = screen.getByRole('heading', { level: 2 }).closest('.bg-gray-800');
      expect(header).toHaveClass(
        'p-2',
        'border-b',
        'border-gray-700',
        'flex-shrink-0',
        'bg-gray-800',
      );
    });
  });

  describe('Layout and Styling', () => {
    it('should apply proper container layout', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} />);

      // Assert
      const mainContainer = screen.getByRole('main').closest('.flex.flex-col.h-full.bg-gray-900');
      expect(mainContainer).toBeInTheDocument();
    });

    it('should have scrollable messages area', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} />);

      // Assert
      const messagesArea = screen.getByRole('main');
      expect(messagesArea).toHaveClass('flex-1', 'overflow-y-auto', 'chat-scroll');
    });

    it('should have proper spacing between messages', () => {
      // Arrange
      const sessionWithMessages = createMockChatSession({
        messages: [
          { role: 'user', content: 'Message 1' },
          { role: 'model', content: 'Message 2' },
        ],
      });

      // Act
      render(<ChatContainer {...defaultProps} session={sessionWithMessages} />);

      // Assert
      const messageContainer = screen.getByText('Message 1').closest('.space-y-8');
      expect(messageContainer).toBeInTheDocument();
    });
  });

  describe('Integration Testing', () => {
    it('should handle complete conversation flow', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act - Send first message
      let textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Hello');
      await user.click(screen.getByRole('button', { name: /傳送/ }));

      // Wait for response
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });

      // Act - Send second message
      textarea = screen.getByRole('textbox');
      await user.type(textarea, 'How are you?');
      await user.click(screen.getByRole('button', { name: /傳送/ }));

      // Assert
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalledTimes(2);
      });
    });

    it('should maintain scroll position during updates', async () => {
      // Arrange
      const sessionWithManyMessages = createMockChatSession({
        messages: Array.from({ length: 20 }, (_, i) => ({
          role: i % 2 === 0 ? ('user' as const) : ('model' as const),
          content: `Message ${i + 1}`,
        })),
      });

      // Act
      render(<ChatContainer {...defaultProps} session={sessionWithManyMessages} />);

      // Assert
      // Should render all messages
      expect(screen.getByText('Message 1')).toBeInTheDocument();
      expect(screen.getByText('Message 20')).toBeInTheDocument();
    });
  });
});
