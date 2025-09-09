import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssistantCard } from '../AssistantCard';
import { AssistantCardProps } from '../types';
import { TEST_ASSISTANTS, setupAssistantTestEnvironment, mockIcons } from './test-utils';

// Mock dependencies
mockIcons();

describe('AssistantCard', () => {
  let mockProps: AssistantCardProps;
  let testEnvironment: ReturnType<typeof setupAssistantTestEnvironment>;

  beforeEach(() => {
    testEnvironment = setupAssistantTestEnvironment();

    mockProps = {
      assistant: TEST_ASSISTANTS.basic,
      isSelected: false,
      onSelect: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onShare: vi.fn(),
    };
  });

  afterEach(() => {
    testEnvironment.cleanup();
  });

  describe('Rendering', () => {
    it('renders assistant name', () => {
      render(<AssistantCard {...mockProps} />);

      expect(screen.getByText(TEST_ASSISTANTS.basic.name)).toBeInTheDocument();
    });

    it('renders assistant description when present', () => {
      render(<AssistantCard {...mockProps} />);

      expect(screen.getByText(TEST_ASSISTANTS.basic.description)).toBeInTheDocument();
    });

    it('does not render description section when description is empty', () => {
      const propsWithoutDescription = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.withoutDescription,
      };

      render(<AssistantCard {...propsWithoutDescription} />);

      // Check that no description paragraph is rendered (the component should skip rendering description)
      const nameElement = screen.getByText(TEST_ASSISTANTS.withoutDescription.name);
      const nameContainer = nameElement.parentElement;
      const descriptionElements = nameContainer?.querySelectorAll('p');

      // Should only find metadata paragraph (creation date), not description
      expect(descriptionElements?.length).toBeLessThanOrEqual(1);
    });

    it('renders creation date in correct format', () => {
      const fixedDate = new Date('2024-01-01T00:00:00Z');
      const assistantWithFixedDate = {
        ...TEST_ASSISTANTS.basic,
        createdAt: fixedDate.getTime(),
      };

      render(<AssistantCard {...mockProps} assistant={assistantWithFixedDate} />);

      expect(screen.getByText(/建立於/)).toBeInTheDocument();
    });

    it('renders RAG indicator when assistant has RAG chunks', () => {
      render(<AssistantCard {...mockProps} assistant={TEST_ASSISTANTS.withRag} />);

      const ragIndicator = screen.getByText(/RAG:/);
      expect(ragIndicator).toBeInTheDocument();
      expect(
        screen.getByText(`${TEST_ASSISTANTS.withRag.ragChunks.length} 檔案`),
      ).toBeInTheDocument();
    });

    it('does not render RAG indicator when assistant has no RAG chunks', () => {
      render(<AssistantCard {...mockProps} />);

      expect(screen.queryByText(/RAG:/)).not.toBeInTheDocument();
    });

    it('renders shared indicator when assistant is shared', () => {
      render(<AssistantCard {...mockProps} assistant={TEST_ASSISTANTS.shared} />);

      expect(screen.getByText('已分享')).toBeInTheDocument();
    });

    it('does not render shared indicator when assistant is not shared', () => {
      render(<AssistantCard {...mockProps} />);

      expect(screen.queryByText('已分享')).not.toBeInTheDocument();
    });
  });

  describe('Selection State', () => {
    it('applies selected styles when isSelected is true', () => {
      const selectedProps = {
        ...mockProps,
        isSelected: true,
      };

      render(<AssistantCard {...selectedProps} />);

      const card = screen.getByRole('button');
      expect(card).toHaveClass('bg-cyan-600/20', 'border-cyan-500/30', 'text-white');
    });

    it('applies unselected styles when isSelected is false', () => {
      render(<AssistantCard {...mockProps} />);

      const card = screen.getByRole('button');
      expect(card).toHaveClass('bg-gray-800/30', 'text-gray-200', 'border-transparent');
    });

    it('has hover styles in CSS classes', () => {
      render(<AssistantCard {...mockProps} />);

      const card = screen.getByRole('button');
      expect(card).toHaveClass(
        'hover:bg-gray-700/50',
        'hover:text-white',
        'hover:border-gray-600/30',
      );
    });
  });

  describe('User Interactions', () => {
    it('calls onSelect when card is clicked', () => {
      render(<AssistantCard {...mockProps} />);

      const card = screen.getByRole('button');
      fireEvent.click(card);

      expect(mockProps.onSelect).toHaveBeenCalledWith(TEST_ASSISTANTS.basic.id);
    });

    it('calls onEdit when edit button is clicked', () => {
      render(<AssistantCard {...mockProps} />);

      const editButton = screen.getByRole('button', { name: /編輯助理/i });
      fireEvent.click(editButton);

      expect(mockProps.onEdit).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
      expect(mockProps.onSelect).not.toHaveBeenCalled(); // Should not trigger card selection
    });

    it('calls onDelete when delete button is clicked', () => {
      render(<AssistantCard {...mockProps} />);

      const deleteButton = screen.getByRole('button', { name: /刪除助理/i });
      fireEvent.click(deleteButton);

      expect(mockProps.onDelete).toHaveBeenCalledWith(TEST_ASSISTANTS.basic.id);
      expect(mockProps.onSelect).not.toHaveBeenCalled(); // Should not trigger card selection
    });

    it('calls onShare when share button is clicked', () => {
      render(<AssistantCard {...mockProps} />);

      const shareButton = screen.getByRole('button', { name: /分享助理/i });
      fireEvent.click(shareButton);

      expect(mockProps.onShare).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
      expect(mockProps.onSelect).not.toHaveBeenCalled(); // Should not trigger card selection
    });

    it('stops propagation when action buttons are clicked', () => {
      render(<AssistantCard {...mockProps} />);

      const editButton = screen.getByRole('button', { name: /編輯助理/i });
      const deleteButton = screen.getByRole('button', { name: /刪除助理/i });
      const shareButton = screen.getByRole('button', { name: /分享助理/i });

      // Click each action button
      fireEvent.click(editButton);
      fireEvent.click(deleteButton);
      fireEvent.click(shareButton);

      // onSelect should not be called because stopPropagation prevents card click
      expect(mockProps.onSelect).not.toHaveBeenCalled();
    });
  });

  describe('Action Buttons', () => {
    it('renders all action buttons', () => {
      render(<AssistantCard {...mockProps} />);

      expect(screen.getByRole('button', { name: /編輯助理/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /刪除助理/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /分享助理/i })).toBeInTheDocument();
    });

    it('action buttons have correct ARIA labels', () => {
      render(<AssistantCard {...mockProps} />);

      expect(screen.getByRole('button', { name: /編輯助理/i })).toHaveAttribute(
        'aria-label',
        '編輯助理',
      );
      expect(screen.getByRole('button', { name: /刪除助理/i })).toHaveAttribute(
        'aria-label',
        '刪除助理',
      );
      expect(screen.getByRole('button', { name: /分享助理/i })).toHaveAttribute(
        'aria-label',
        '分享助理',
      );
    });

    it('action buttons have correct title attributes', () => {
      render(<AssistantCard {...mockProps} />);

      expect(screen.getByRole('button', { name: /編輯助理/i })).toHaveAttribute(
        'title',
        '編輯助理',
      );
      expect(screen.getByRole('button', { name: /刪除助理/i })).toHaveAttribute(
        'title',
        '刪除助理',
      );
      expect(screen.getByRole('button', { name: /分享助理/i })).toHaveAttribute(
        'title',
        '分享助理',
      );
    });

    it('action buttons have hover styles', () => {
      render(<AssistantCard {...mockProps} />);

      const editButton = screen.getByRole('button', { name: /編輯助理/i });
      const deleteButton = screen.getByRole('button', { name: /刪除助理/i });
      const shareButton = screen.getByRole('button', { name: /分享助理/i });

      expect(editButton).toHaveClass('hover:text-cyan-400', 'hover:bg-cyan-500/20');
      expect(deleteButton).toHaveClass('hover:text-red-400', 'hover:bg-red-500/20');
      expect(shareButton).toHaveClass('hover:text-blue-400', 'hover:bg-blue-500/20');
    });
  });

  describe('Content Truncation', () => {
    it('truncates long assistant names', () => {
      const assistantWithLongName = {
        ...TEST_ASSISTANTS.basic,
        name: 'This is a very long assistant name that should be truncated to fit in the card layout',
      };

      render(<AssistantCard {...mockProps} assistant={assistantWithLongName} />);

      const nameElement = screen.getByText(assistantWithLongName.name);
      expect(nameElement).toHaveClass('truncate');
    });

    it('applies line-clamp to long descriptions', () => {
      render(<AssistantCard {...mockProps} assistant={TEST_ASSISTANTS.withLongDescription} />);

      const descriptionElement = screen.getByText(TEST_ASSISTANTS.withLongDescription.description);
      expect(descriptionElement).toHaveClass('line-clamp-2');
    });
  });

  describe('Layout and Structure', () => {
    it('has proper flex layout classes', () => {
      render(<AssistantCard {...mockProps} />);

      const card = screen.getByRole('button');
      expect(card).toHaveClass('group', 'p-4', 'rounded-lg', 'cursor-pointer');

      const mainContent = card.querySelector('.flex.items-start.justify-between');
      expect(mainContent).toBeInTheDocument();
    });

    it('action buttons are hidden by default and shown on hover', () => {
      render(<AssistantCard {...mockProps} />);

      const actionContainer = screen.getByRole('button', { name: /編輯助理/i }).parentElement;
      expect(actionContainer).toHaveClass('opacity-0', 'group-hover:opacity-100');
    });

    it('has proper metadata layout', () => {
      render(<AssistantCard {...mockProps} assistant={TEST_ASSISTANTS.withRag} />);

      const metadataContainer = screen.getByText(/建立於/).parentElement;
      expect(metadataContainer).toHaveClass(
        'flex',
        'items-center',
        'text-xs',
        'text-gray-500',
        'space-x-4',
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles empty RAG chunks array', () => {
      const assistantWithEmptyRag = {
        ...TEST_ASSISTANTS.basic,
        ragChunks: [],
      };

      render(<AssistantCard {...mockProps} assistant={assistantWithEmptyRag} />);

      expect(screen.queryByText(/RAG:/)).not.toBeInTheDocument();
    });

    it('handles undefined RAG chunks', () => {
      const assistantWithUndefinedRag = {
        ...TEST_ASSISTANTS.basic,
        ragChunks: undefined,
      };

      render(<AssistantCard {...mockProps} assistant={assistantWithUndefinedRag} />);

      expect(screen.queryByText(/RAG:/)).not.toBeInTheDocument();
    });

    it('handles assistant without isShared property', () => {
      const assistantWithoutSharedProp = {
        ...TEST_ASSISTANTS.basic,
        isShared: undefined,
      };

      render(<AssistantCard {...mockProps} assistant={assistantWithoutSharedProp} />);

      expect(screen.queryByText('已分享')).not.toBeInTheDocument();
    });

    it('renders correctly with minimal assistant data', () => {
      const minimalAssistant = {
        id: 'minimal-1',
        name: 'Minimal',
        description: '',
        systemPrompt: 'You are minimal.',
        ragChunks: [],
        createdAt: Date.now(),
      };

      render(<AssistantCard {...mockProps} assistant={minimalAssistant} />);

      expect(screen.getByText('Minimal')).toBeInTheDocument();
      expect(screen.getByText(/建立於/)).toBeInTheDocument();
    });
  });
});
