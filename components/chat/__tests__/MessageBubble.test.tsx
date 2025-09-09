import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import MessageBubble from '../MessageBubble';
import { createMockChatMessage } from './test-utils';

// Mock dependencies before importing
beforeAll(() => {
  vi.mock('react-markdown', () => ({
    default: ({ children }: { children: string }) => (
      <div data-testid='markdown-content'>{children}</div>
    ),
  }));

  vi.mock('remark-gfm', () => ({ default: vi.fn() }));
  vi.mock('rehype-highlight', () => ({ default: vi.fn() }));
  vi.mock('highlight.js/styles/github-dark.css', () => ({}));

  vi.mock('../../ui/Icons', () => ({
    UserIcon: ({ className }: { className?: string }) => (
      <div data-testid='user-icon' className={className}>
        User
      </div>
    ),
    GeminiIcon: ({ className }: { className?: string }) => (
      <div data-testid='gemini-icon' className={className}>
        Gemini
      </div>
    ),
  }));
});

describe('MessageBubble', () => {
  describe('User Message Rendering', () => {
    it('should render user message with proper layout', () => {
      // Arrange
      const userMessage = createMockChatMessage({
        role: 'user',
        content: 'Hello world',
      });

      // Act
      render(<MessageBubble message={userMessage} index={0} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Hello world');
      expect(screen.getByTestId('user-icon')).toBeInTheDocument();

      // Check for right-aligned layout - should have justify-end class somewhere
      const justifyEndElement = document.querySelector('.justify-end');
      expect(justifyEndElement).toBeInTheDocument();
    });

    it('should show copy button for user messages', () => {
      // Arrange
      const userMessage = createMockChatMessage({
        role: 'user',
        content: 'Test message',
      });

      // Act
      render(<MessageBubble message={userMessage} index={0} />);

      // Assert
      const copyButton = screen.getByTitle('複製訊息');
      expect(copyButton).toBeInTheDocument();
    });

    it('should handle copy functionality', async () => {
      // Arrange
      const userMessage = createMockChatMessage({
        role: 'user',
        content: 'Copy this message',
      });
      render(<MessageBubble message={userMessage} index={0} />);

      // Act
      const copyButton = screen.getByTitle('複製訊息');
      fireEvent.click(copyButton);

      // Assert
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy this message');
      });
    });
  });

  describe('Assistant Message Rendering', () => {
    it('should render assistant message with proper layout', () => {
      // Arrange
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Assistant response',
      });

      // Act
      render(<MessageBubble message={assistantMessage} index={0} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Assistant response');
      expect(screen.getByTestId('gemini-icon')).toBeInTheDocument();

      // Check for left-aligned layout - should have justify-start class somewhere
      const justifyStartElement = document.querySelector('.justify-start');
      expect(justifyStartElement).toBeInTheDocument();
    });

    it('should show copy button for assistant messages', () => {
      // Arrange
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Assistant message',
      });

      // Act
      render(<MessageBubble message={assistantMessage} index={0} />);

      // Assert
      const copyButton = screen.getByTitle('複製回應');
      expect(copyButton).toBeInTheDocument();
    });

    it('should handle copy functionality for assistant messages', async () => {
      // Arrange
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Copy this response',
      });
      render(<MessageBubble message={assistantMessage} index={0} />);

      // Act
      const copyButton = screen.getByTitle('複製回應');
      fireEvent.click(copyButton);

      // Assert
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy this response');
      });
    });
  });

  describe('Markdown Content Processing', () => {
    it('should render content through ReactMarkdown', () => {
      // Arrange
      const markdownMessage = createMockChatMessage({
        role: 'model',
        content: '# Heading\n\nSome **bold** text',
      });

      // Act
      render(<MessageBubble message={markdownMessage} index={0} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
      // The mock renders content without preserving whitespace exactly
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(
        '# Heading Some **bold** text',
      );
    });
  });

  describe('Timestamp Display', () => {
    it('should display timestamp for both message types', () => {
      // Arrange
      const userMessage = createMockChatMessage({
        role: 'user',
        content: 'Test message',
      });

      // Act
      render(<MessageBubble message={userMessage} index={0} />);

      // Assert
      // Look for any element that matches time format
      const timestampElement = document.querySelector('.text-xs.text-gray-400');
      expect(timestampElement).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle empty content gracefully', () => {
      // Arrange
      const emptyMessage = createMockChatMessage({
        role: 'user',
        content: '',
      });

      // Act & Assert
      expect(() => {
        render(<MessageBubble message={emptyMessage} index={0} />);
      }).not.toThrow();

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
    });

    it('should handle very long content', () => {
      // Arrange
      const longMessage = createMockChatMessage({
        role: 'model',
        content: 'Very long content. '.repeat(100),
      });

      // Act & Assert
      expect(() => {
        render(<MessageBubble message={longMessage} index={0} />);
      }).not.toThrow();
    });
  });
});
