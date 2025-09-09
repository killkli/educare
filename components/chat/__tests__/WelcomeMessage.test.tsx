import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WelcomeMessage from '../WelcomeMessage';
import { setupTestEnvironment, mockIcons } from './test-utils';

// Mock external dependencies
mockIcons();

describe('WelcomeMessage', () => {
  let testEnv: ReturnType<typeof setupTestEnvironment>;

  beforeEach(() => {
    testEnv = setupTestEnvironment();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe('Basic Rendering', () => {
    it('should render assistant name', () => {
      // Arrange
      const assistantName = 'Test Assistant';

      // Act
      render(<WelcomeMessage assistantName={assistantName} />);

      // Assert
      expect(screen.getByText(assistantName)).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(assistantName);
    });

    it('should render Gemini icon', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' />);

      // Assert
      expect(screen.getByTestId('gemini-icon')).toBeInTheDocument();
    });

    it('should have proper semantic structure', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' />);

      // Assert
      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveClass('text-2xl', 'font-semibold', 'text-white');
    });

    it('should apply center alignment styling', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' />);

      // Assert
      const container = screen.getByText('Test Assistant').closest('div');
      expect(container).toHaveClass('text-center', 'py-12');
    });
  });

  describe('Assistant Description', () => {
    it('should render description when provided', () => {
      // Arrange
      const assistantName = 'Test Assistant';
      const description = 'This is a helpful AI assistant for testing purposes.';

      // Act
      render(<WelcomeMessage assistantName={assistantName} assistantDescription={description} />);

      // Assert
      expect(screen.getByText(description)).toBeInTheDocument();
    });

    it('should not render description section when not provided', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' />);

      // Assert
      // Should only have the default message
      expect(screen.getByText('問我任何問題，我會幫助您！')).toBeInTheDocument();

      // Should not have any description paragraph
      const paragraphs = screen.getAllByText(/./);
      const descriptionParagraphs = paragraphs.filter(
        p => p.tagName === 'P' && p.className.includes('text-gray-300'),
      );
      expect(descriptionParagraphs).toHaveLength(0);
    });

    it('should apply proper styling to description', () => {
      // Arrange
      const description = 'Test description';

      // Act
      render(<WelcomeMessage assistantName='Test Assistant' assistantDescription={description} />);

      // Assert
      const descriptionElement = screen.getByText(description);
      expect(descriptionElement).toHaveClass(
        'text-gray-300',
        'mb-6',
        'max-w-2xl',
        'mx-auto',
        'leading-relaxed',
      );
    });

    it('should show different footer message when description is provided', () => {
      // Arrange
      const description = 'Test description';

      // Act
      render(<WelcomeMessage assistantName='Test Assistant' assistantDescription={description} />);

      // Assert
      expect(screen.getByText('讓我們開始聊天吧！')).toBeInTheDocument();
      expect(screen.queryByText('問我任何問題，我會幫助您！')).not.toBeInTheDocument();
    });

    it('should show default footer message when no description is provided', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' />);

      // Assert
      expect(screen.getByText('問我任何問題，我會幫助您！')).toBeInTheDocument();
      expect(screen.queryByText('讓我們開始聊天吧！')).not.toBeInTheDocument();
    });
  });

  describe('Shared Mode Indicators', () => {
    it('should show shared mode indicator when sharedMode is true', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' sharedMode={true} />);

      // Assert
      expect(screen.getByText('分享的 AI 助理 - 您的對話不會永久儲存')).toBeInTheDocument();
    });

    it('should not show shared mode indicator when sharedMode is false', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' sharedMode={false} />);

      // Assert
      expect(screen.queryByText('分享的 AI 助理 - 您的對話不會永久儲存')).not.toBeInTheDocument();
    });

    it('should not show shared mode indicator when sharedMode is undefined', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' />);

      // Assert
      expect(screen.queryByText('分享的 AI 助理 - 您的對話不會永久儲存')).not.toBeInTheDocument();
    });

    it('should apply proper styling to shared mode indicator', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' sharedMode={true} />);

      // Assert
      const sharedIndicator = screen.getByText('分享的 AI 助理 - 您的對話不會永久儲存');
      const container = sharedIndicator.closest('div');
      expect(container).toHaveClass(
        'inline-flex',
        'items-center',
        'gap-2',
        'bg-gray-800',
        'px-4',
        'py-2',
        'rounded-full',
        'text-sm',
        'text-gray-400',
        'mb-6',
      );
    });

    it('should include emoji icon in shared mode indicator', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' sharedMode={true} />);

      // Assert
      expect(screen.getByText('💡')).toBeInTheDocument();
    });
  });

  describe('Icon Container', () => {
    it('should render icon container with proper styling', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' />);

      // Assert
      const iconContainer = screen.getByTestId('gemini-icon').closest('div');
      expect(iconContainer).toHaveClass(
        'w-20',
        'h-20',
        'bg-cyan-600',
        'rounded-full',
        'flex',
        'items-center',
        'justify-center',
        'mx-auto',
        'mb-6',
      );
    });

    it('should apply correct icon size', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' />);

      // Assert
      const icon = screen.getByTestId('gemini-icon');
      expect(icon).toHaveClass('w-10', 'h-10', 'text-white');
    });
  });

  describe('Content Variations', () => {
    it('should render complete layout with all optional content', () => {
      // Arrange
      const props = {
        assistantName: 'Full Featured Assistant',
        assistantDescription: 'This assistant has all features enabled.',
        sharedMode: true,
      };

      // Act
      render(<WelcomeMessage {...props} />);

      // Assert
      expect(screen.getByText(props.assistantName)).toBeInTheDocument();
      expect(screen.getByText(props.assistantDescription)).toBeInTheDocument();
      expect(screen.getByText('分享的 AI 助理 - 您的對話不會永久儲存')).toBeInTheDocument();
      expect(screen.getByText('讓我們開始聊天吧！')).toBeInTheDocument();
      expect(screen.getByTestId('gemini-icon')).toBeInTheDocument();
    });

    it('should render minimal layout with only required content', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Minimal Assistant' />);

      // Assert
      expect(screen.getByText('Minimal Assistant')).toBeInTheDocument();
      expect(screen.getByText('問我任何問題，我會幫助您！')).toBeInTheDocument();
      expect(screen.getByTestId('gemini-icon')).toBeInTheDocument();

      // Optional content should not be present
      expect(screen.queryByText(/分享的 AI 助理/)).not.toBeInTheDocument();
    });

    it('should handle description with shared mode but no description', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Shared Assistant' sharedMode={true} />);

      // Assert
      expect(screen.getByText('Shared Assistant')).toBeInTheDocument();
      expect(screen.getByText('分享的 AI 助理 - 您的對話不會永久儲存')).toBeInTheDocument();
      expect(screen.getByText('問我任何問題，我會幫助您！')).toBeInTheDocument(); // Default message since no description
    });

    it('should handle description without shared mode', () => {
      // Arrange & Act
      render(
        <WelcomeMessage
          assistantName='Private Assistant'
          assistantDescription='This is a private assistant.'
          sharedMode={false}
        />,
      );

      // Assert
      expect(screen.getByText('Private Assistant')).toBeInTheDocument();
      expect(screen.getByText('This is a private assistant.')).toBeInTheDocument();
      expect(screen.getByText('讓我們開始聊天吧！')).toBeInTheDocument(); // Since description is provided
      expect(screen.queryByText(/分享的 AI 助理/)).not.toBeInTheDocument();
    });
  });

  describe('Text Styling', () => {
    it('should apply correct styles to assistant name', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Styled Assistant' />);

      // Assert
      const nameElement = screen.getByText('Styled Assistant');
      expect(nameElement).toHaveClass('text-2xl', 'font-semibold', 'text-white', 'mb-3');
    });

    it('should apply correct styles to footer message', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Test Assistant' />);

      // Assert
      const footerMessage = screen.getByText('問我任何問題，我會幫助您！');
      expect(footerMessage).toHaveClass('text-gray-400', 'text-lg');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty assistant name', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='' />);

      // Assert
      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('');
    });

    it('should handle very long assistant name', () => {
      // Arrange
      const longName = 'A'.repeat(100);

      // Act
      render(<WelcomeMessage assistantName={longName} />);

      // Assert
      expect(screen.getByText(longName)).toBeInTheDocument();
    });

    it('should handle very long description', () => {
      // Arrange
      const longDescription = 'This is a very long description. '.repeat(50);

      // Act
      render(
        <WelcomeMessage assistantName='Test Assistant' assistantDescription={longDescription} />,
      );

      // Assert
      expect(screen.getByText(longDescription)).toBeInTheDocument();

      // Should still apply max-width constraint
      const descriptionElement = screen.getByText(longDescription);
      expect(descriptionElement).toHaveClass('max-w-2xl');
    });

    it('should handle special characters in name and description', () => {
      // Arrange
      const specialName = 'Test Assistant 🤖 with émojis & spéciał chars';
      const specialDescription = 'Description with "quotes", <tags>, and 中文字符';

      // Act
      render(
        <WelcomeMessage assistantName={specialName} assistantDescription={specialDescription} />,
      );

      // Assert
      expect(screen.getByText(specialName)).toBeInTheDocument();
      expect(screen.getByText(specialDescription)).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should use semantic heading for assistant name', () => {
      // Arrange & Act
      render(<WelcomeMessage assistantName='Accessible Assistant' />);

      // Assert
      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('Accessible Assistant');
    });

    it('should have proper text hierarchy', () => {
      // Arrange & Act
      render(
        <WelcomeMessage assistantName='Test Assistant' assistantDescription='Test description' />,
      );

      // Assert
      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toBeInTheDocument();

      // Description should be in a paragraph
      const description = screen.getByText('Test description');
      expect(description.tagName).toBe('P');
    });

    it('should maintain contrast ratios with color classes', () => {
      // Arrange & Act
      render(
        <WelcomeMessage
          assistantName='Test Assistant'
          assistantDescription='Test description'
          sharedMode={true}
        />,
      );

      // Assert
      const nameElement = screen.getByText('Test Assistant');
      expect(nameElement).toHaveClass('text-white'); // High contrast on dark background

      const descriptionElement = screen.getByText('Test description');
      expect(descriptionElement).toHaveClass('text-gray-300'); // Good contrast

      const sharedIndicator = screen.getByText('分享的 AI 助理 - 您的對話不會永久儲存');
      expect(sharedIndicator).toHaveClass('text-gray-400'); // Adequate contrast for secondary info
    });
  });
});
