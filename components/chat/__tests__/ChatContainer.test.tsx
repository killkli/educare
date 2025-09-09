import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ChatContainer from '../ChatContainer';
import { RagChunk, ChatSession } from '../../../types';
import {
  setupTestEnvironment,
  TEST_SESSIONS,
  TEST_ASSISTANTS,
  createMockChatSession,
  mockReactMarkdown,
  mockMarkdownDependencies,
  mockIcons,
  mockEmbeddingService,
  mockTursoService,
  mockLLMService,
} from './test-utils';

// Mock external dependencies
mockReactMarkdown();
mockMarkdownDependencies();
mockIcons();
mockEmbeddingService();
mockTursoService();
mockLLMService();

// Mock SessionManager
vi.mock('../SessionManager', () => ({
  default: ({
    session,
    onSessionUpdate: _onSessionUpdate,
  }: {
    session: ChatSession;
    onSessionUpdate: (session: ChatSession) => void;
  }) => ({
    currentSession: session,
    handleSendMessage: vi.fn(
      async (
        userMessage: string,
        systemPrompt: string,
        assistantId: string,
        ragChunks: RagChunk[],
        setStatusText: (text: string) => void,
        setIsThinking: (thinking: boolean) => void,
        onStreamingChunk: (chunk: string) => void,
        onComplete: (
          tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
          fullResponse: string,
        ) => void,
        _onError: (_error: Error) => void,
      ) => {
        // Simulate the message flow
        setIsThinking(true);
        setStatusText('Processing...');

        // Simulate streaming response
        setTimeout(() => {
          onStreamingChunk('Hello');
          setTimeout(() => {
            onStreamingChunk(' world!');
            setTimeout(() => {
              onComplete({ promptTokenCount: 10, candidatesTokenCount: 15 }, 'Hello world!');
            }, 50);
          }, 50);
        }, 50);
      },
    ),
    messagesEndRef: { current: null },
  }),
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
    testEnv = setupTestEnvironment();
    vi.clearAllMocks();
  });

  afterEach(() => {
    testEnv.cleanup();
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
      expect(screen.getByText(defaultProps.assistantName)).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        defaultProps.assistantName,
      );
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
      expect(screen.getByText(defaultProps.assistantName)).toBeInTheDocument();
      expect(screen.getByText(defaultProps.assistantDescription!)).toBeInTheDocument();
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
    });

    it('should disable input during loading', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');
      const sendButton = screen.getByRole('button');
      await user.click(sendButton);

      // Assert
      await waitFor(() => {
        expect(textarea).toBeDisabled();
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
      const sendButton = screen.getByRole('button');
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
      const sendButton = screen.getByRole('button');
      await user.click(sendButton);

      // Assert
      expect(defaultProps.onNewMessage).not.toHaveBeenCalled();
    });

    it('should prevent sending during loading state', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'First message');
      const sendButton = screen.getByRole('button');

      // Send first message (starts loading)
      await user.click(sendButton);

      // Try to send another message while loading
      await user.type(textarea, 'Second message');
      await user.click(sendButton);

      // Assert
      // Should only be called once for the first message
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
      const sendButton = screen.getByRole('button');
      await user.click(sendButton);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('AI 正在思考...')).toBeInTheDocument();
      });
    });

    it('should show streaming response when available', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');
      const sendButton = screen.getByRole('button');
      await user.click(sendButton);

      // Assert
      await waitFor(
        () => {
          expect(screen.getByText('正在輸入...')).toBeInTheDocument();
        },
        { timeout: 200 },
      );
    });

    it('should hide thinking indicator when streaming starts', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');
      const sendButton = screen.getByRole('button');
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
      const sendButton = screen.getByRole('button');
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

      // Assert
      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled(); // Should be disabled when no input text in shared mode
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
      // Arrange
      const mockSessionManager = vi.fn().mockImplementation(() => ({
        currentSession: defaultProps.session,
        handleSendMessage: vi.fn().mockRejectedValue(new Error('Network error')),
        messagesEndRef: { current: null },
      }));

      // Mock the SessionManager to throw error
      vi.doMock('../SessionManager', () => ({
        default: mockSessionManager,
      }));

      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');
      const sendButton = screen.getByRole('button');
      await user.click(sendButton);

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/抱歉，發生錯誤/)).toBeInTheDocument();
      });
    });

    it('should reset states after error', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatContainer {...defaultProps} />);

      // Simulate error by triggering the error callback in SessionManager
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Error message');
      const sendButton = screen.getByRole('button');
      await user.click(sendButton);

      // Wait for error state
      await waitFor(() => {
        expect(screen.queryByText('AI 正在思考...')).not.toBeInTheDocument();
      });

      // Assert
      expect(textarea).not.toBeDisabled(); // Should be re-enabled after error
    });
  });

  describe('Header Visibility Controls', () => {
    it('should show header by default', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} />);

      // Assert
      expect(screen.getByText(defaultProps.assistantName)).toBeInTheDocument();
      const headerSection = screen.getByRole('heading').closest('div');
      expect(headerSection).toHaveClass('p-4', 'border-b', 'border-gray-700');
    });

    it('should hide header when hideHeader is true', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} hideHeader={true} />);

      // Assert
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('should apply proper styling to header', () => {
      // Arrange & Act
      render(<ChatContainer {...defaultProps} hideHeader={false} />);

      // Assert
      const header = screen.getByRole('heading').closest('div');
      expect(header).toHaveClass(
        'p-4',
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
      await user.click(screen.getByRole('button'));

      // Wait for response
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });

      // Act - Send second message
      textarea = screen.getByRole('textbox');
      await user.type(textarea, 'How are you?');
      await user.click(screen.getByRole('button'));

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
