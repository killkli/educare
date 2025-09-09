/* global HTMLSelectElement */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Assistant } from '../../../types';
import { AssistantList } from '../AssistantList';
import { AssistantListProps } from '../types';
import { TEST_ASSISTANTS, setupAssistantTestEnvironment } from './test-utils';

// Mock dependencies
vi.mock('../ui/Icons', () => ({
  PlusIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'plus-icon', className }, 'Plus');
  },
  EditIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'edit-icon', className }, 'Edit');
  },
  TrashIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'trash-icon', className }, 'Trash');
  },
}));

vi.mock('../ui/CustomSelect', () => ({
  CustomSelect: ({
    assistants,
    selectedAssistant,
    onSelect,
    placeholder,
  }: {
    assistants: Assistant[];
    selectedAssistant: Assistant | null;
    onSelect: (id: string) => void;
    placeholder: string;
  }) => {
    return React.createElement(
      'select',
      {
        'data-testid': 'custom-select',
        value: selectedAssistant?.id || '',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onSelect(e.target.value),
      },
      [
        React.createElement('option', { key: 'placeholder', value: '' }, placeholder),
        ...assistants.map(assistant =>
          React.createElement('option', { key: assistant.id, value: assistant.id }, assistant.name),
        ),
      ],
    );
  },
}));

describe('AssistantList', () => {
  let mockProps: AssistantListProps;
  let testEnvironment: ReturnType<typeof setupAssistantTestEnvironment>;

  beforeEach(() => {
    testEnvironment = setupAssistantTestEnvironment();

    mockProps = {
      assistants: [TEST_ASSISTANTS.basic, TEST_ASSISTANTS.withRag],
      selectedAssistant: null,
      onSelect: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onShare: vi.fn(),
      onCreateNew: vi.fn(),
    };
  });

  afterEach(() => {
    testEnvironment.cleanup();
  });

  describe('Rendering', () => {
    it('renders the assistant selection section', () => {
      render(<AssistantList {...mockProps} />);

      expect(screen.getByRole('navigation', { name: /助理選擇/i })).toBeInTheDocument();
      expect(screen.getByText('選擇助理')).toBeInTheDocument();
    });

    it('renders CustomSelect component with correct props', () => {
      render(<AssistantList {...mockProps} />);

      const select = screen.getByTestId('custom-select');
      expect(select).toBeInTheDocument();
      expect(select).toHaveValue('');
    });

    it('renders create new button', () => {
      render(<AssistantList {...mockProps} />);

      const createButton = screen.getByRole('button', { name: /新增助理/i });
      expect(createButton).toBeInTheDocument();
      expect(createButton).toHaveAttribute('title', '新增助理');
    });

    it('does not render action buttons when no assistant is selected', () => {
      render(<AssistantList {...mockProps} />);

      expect(screen.queryByRole('button', { name: /編輯助理/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /刪除助理/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /分享助理/i })).not.toBeInTheDocument();
    });

    it('renders action buttons when an assistant is selected', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      expect(screen.getByRole('button', { name: /編輯助理/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /刪除助理/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /分享助理/i })).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('calls onCreateNew when create button is clicked', () => {
      render(<AssistantList {...mockProps} />);

      const createButton = screen.getByRole('button', { name: /新增助理/i });
      fireEvent.click(createButton);

      expect(mockProps.onCreateNew).toHaveBeenCalledTimes(1);
    });

    it('calls onSelect when an assistant is selected from dropdown', () => {
      render(<AssistantList {...mockProps} />);

      const select = screen.getByTestId('custom-select');
      fireEvent.change(select, { target: { value: TEST_ASSISTANTS.basic.id } });

      expect(mockProps.onSelect).toHaveBeenCalledWith(TEST_ASSISTANTS.basic.id);
    });

    it('calls onEdit when edit button is clicked', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      const editButton = screen.getByRole('button', { name: /編輯助理/i });
      fireEvent.click(editButton);

      expect(mockProps.onEdit).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
    });

    it('calls onDelete when delete button is clicked', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      const deleteButton = screen.getByRole('button', { name: /刪除助理/i });
      fireEvent.click(deleteButton);

      expect(mockProps.onDelete).toHaveBeenCalledWith(TEST_ASSISTANTS.basic.id);
    });

    it('calls onShare when share button is clicked', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      const shareButton = screen.getByRole('button', { name: /分享助理/i });
      fireEvent.click(shareButton);

      expect(mockProps.onShare).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels for all buttons', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      expect(screen.getByRole('button', { name: /新增助理/i })).toHaveAttribute(
        'aria-label',
        '新增助理',
      );
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

    it('has proper navigation role and label', () => {
      render(<AssistantList {...mockProps} />);

      const navigation = screen.getByRole('navigation');
      expect(navigation).toHaveAttribute('aria-label', '助理選擇');
    });

    it('has proper title attributes for tooltips', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      expect(screen.getByRole('button', { name: /新增助理/i })).toHaveAttribute(
        'title',
        '新增助理',
      );
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
  });

  describe('Edge Cases', () => {
    it('handles empty assistants array', () => {
      const propsWithEmptyList = {
        ...mockProps,
        assistants: [],
      };

      render(<AssistantList {...propsWithEmptyList} />);

      expect(screen.getByTestId('custom-select')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /新增助理/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /編輯助理/i })).not.toBeInTheDocument();
    });

    it('handles null selectedAssistant', () => {
      const propsWithNullSelected = {
        ...mockProps,
        selectedAssistant: null,
      };

      render(<AssistantList {...propsWithNullSelected} />);

      expect(screen.getByTestId('custom-select')).toHaveValue('');
      expect(screen.queryByRole('button', { name: /編輯助理/i })).not.toBeInTheDocument();
    });

    it('updates selection when selectedAssistant prop changes', () => {
      const { rerender } = render(<AssistantList {...mockProps} />);

      expect(screen.getByTestId('custom-select')).toHaveValue('');

      rerender(<AssistantList {...mockProps} selectedAssistant={TEST_ASSISTANTS.basic} />);

      expect(screen.getByTestId('custom-select')).toHaveValue(TEST_ASSISTANTS.basic.id);
    });
  });

  describe('Styling and CSS Classes', () => {
    it('applies correct CSS classes to main container', () => {
      render(<AssistantList {...mockProps} />);

      const container = screen.getByRole('navigation').parentElement;
      expect(container).toHaveClass('mb-6', 'px-2');
    });

    it('applies hover styles to buttons', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      const createButton = screen.getByRole('button', { name: /新增助理/i });
      expect(createButton).toHaveClass('hover:text-cyan-400', 'hover:bg-cyan-500/20');

      const editButton = screen.getByRole('button', { name: /編輯助理/i });
      expect(editButton).toHaveClass('hover:text-cyan-400', 'hover:bg-cyan-500/20');

      const deleteButton = screen.getByRole('button', { name: /刪除助理/i });
      expect(deleteButton).toHaveClass('hover:text-red-400', 'hover:bg-red-500/20');

      const shareButton = screen.getByRole('button', { name: /分享助理/i });
      expect(shareButton).toHaveClass('hover:text-blue-400', 'hover:bg-blue-500/20');
    });
  });
});
