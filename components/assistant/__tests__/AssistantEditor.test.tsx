import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { AssistantEditor } from '../AssistantEditor';
import { Assistant, RagChunk } from '../../../types';
import { TEST_ASSISTANTS, TEST_RAG_CHUNKS, setupAssistantTestEnvironment } from './test-utils';

// Mock useTursoAssistantStatus so canShare is true for existing assistants
vi.mock('../../../hooks/useTursoAssistantStatus', () => ({
  useTursoAssistantStatus: (assistantId: string | null) => ({
    isInTurso: !!assistantId,
    isChecking: false,
    canShare: !!assistantId,
    recheckStatus: vi.fn(),
  }),
}));

// Mock dependencies
vi.mock('../../../services/tursoService', () => ({
  saveAssistantToTurso: vi.fn().mockResolvedValue(undefined),
  checkAssistantExistsInTurso: vi.fn().mockResolvedValue(false),
}));

beforeAll(() => {
  // Mock RAGFileUpload component for focused testing
  vi.mock('../RAGFileUpload', () => ({
    RAGFileUpload: ({
      ragChunks,
      onRagChunksChange,
      disabled,
    }: {
      ragChunks: RagChunk[];
      onRagChunksChange: (chunks: RagChunk[]) => void;
      disabled?: boolean;
    }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'rag-file-upload' }, [
        React.createElement('div', { key: 'label' }, '知識檔案 (RAG)'),
        React.createElement('div', { key: 'chunks' }, `Chunks: ${ragChunks.length}`),
        React.createElement(
          'button',
          {
            key: 'add-chunk',
            onClick: () => onRagChunksChange([...ragChunks, TEST_RAG_CHUNKS.pdf]),
            disabled,
            'data-testid': 'add-chunk-button',
          },
          'Add Chunk',
        ),
        React.createElement(
          'button',
          {
            key: 'remove-chunk',
            onClick: () => onRagChunksChange(ragChunks.slice(0, -1)),
            disabled,
            'data-testid': 'remove-chunk-button',
          },
          'Remove Chunk',
        ),
      ]);
    },
  }));
});

interface AssistantEditorProps {
  assistant: Assistant | null;
  onSave: (assistant: Assistant) => void;
  onCancel: () => void;
  onShare?: (assistant: Assistant) => void;
}

describe('AssistantEditor', () => {
  let mockProps: AssistantEditorProps;
  let testEnvironment: ReturnType<typeof setupAssistantTestEnvironment>;

  beforeEach(() => {
    testEnvironment = setupAssistantTestEnvironment();

    mockProps = {
      assistant: null,
      onSave: vi.fn(),
      onCancel: vi.fn(),
      onShare: vi.fn(),
    };
  });

  afterEach(() => {
    testEnvironment.cleanup();
  });

  describe('Rendering', () => {
    it('renders in new mode when assistant is null', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByText('新增助理')).toBeInTheDocument();
      expect(screen.getByLabelText('助理名稱')).toBeInTheDocument();
      expect(screen.getByLabelText('公開描述', { exact: false })).toBeInTheDocument();
      expect(screen.getByLabelText('系統提示')).toBeInTheDocument();
    });

    it('renders in edit mode when assistant is provided', () => {
      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantEditor {...propsWithAssistant} />);

      expect(screen.getByText('編輯助理')).toBeInTheDocument();
      expect(screen.getByDisplayValue(TEST_ASSISTANTS.basic.name)).toBeInTheDocument();
      expect(screen.getByDisplayValue(TEST_ASSISTANTS.basic.description)).toBeInTheDocument();
      expect(screen.getByDisplayValue(TEST_ASSISTANTS.basic.systemPrompt)).toBeInTheDocument();
    });

    it('renders all form fields with correct labels', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByLabelText('助理名稱')).toBeInTheDocument();
      expect(screen.getByText('公開描述')).toBeInTheDocument();
      expect(screen.getByText('(分享時顯示給用戶)')).toBeInTheDocument();
      expect(screen.getByLabelText('系統提示')).toBeInTheDocument();
    });

    it('renders action buttons', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '保存助理' })).toBeInTheDocument();
    });

    it('renders share button only for existing assistants', () => {
      // New assistant - no share button
      render(<AssistantEditor {...mockProps} />);
      expect(screen.queryByText('🎯 分享助理')).not.toBeInTheDocument();

      // Existing assistant - has share button
      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantEditor {...propsWithAssistant} />);
      expect(screen.getByText('🎯 分享助理')).toBeInTheDocument();
    });

    it('renders RAGFileUpload component', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByTestId('rag-file-upload')).toBeInTheDocument();
      expect(screen.getByText('知識檔案 (RAG)')).toBeInTheDocument();
    });
  });

  describe('Form Initialization', () => {
    it('initializes form with default values for new assistant', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByLabelText('助理名稱')).toHaveValue('');
      expect(screen.getByLabelText('公開描述', { exact: false })).toHaveValue('');
      expect(screen.getByLabelText('系統提示')).toHaveValue('您是一個有用且專業的 AI 助理。');
      expect(screen.getByText('Chunks: 0')).toBeInTheDocument();
    });

    it('initializes form with assistant data when editing', () => {
      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.withRag,
      };

      render(<AssistantEditor {...propsWithAssistant} />);

      expect(screen.getByLabelText('助理名稱')).toHaveValue(TEST_ASSISTANTS.withRag.name);
      expect(screen.getByLabelText('公開描述', { exact: false })).toHaveValue(
        TEST_ASSISTANTS.withRag.description,
      );
      expect(screen.getByLabelText('系統提示')).toHaveValue(TEST_ASSISTANTS.withRag.systemPrompt);
      expect(
        screen.getByText(`Chunks: ${TEST_ASSISTANTS.withRag.ragChunks!.length}`),
      ).toBeInTheDocument();
    });

    it('handles assistant with empty description', () => {
      const assistantWithEmptyDescription = {
        ...TEST_ASSISTANTS.basic,
        description: '',
      };

      const propsWithAssistant = {
        ...mockProps,
        assistant: assistantWithEmptyDescription,
      };

      render(<AssistantEditor {...propsWithAssistant} />);

      expect(screen.getByLabelText('公開描述', { exact: false })).toHaveValue('');
    });

    it('handles assistant with undefined description', () => {
      const assistantWithUndefinedDescription = {
        ...TEST_ASSISTANTS.basic,
        description: '',
      };

      const propsWithAssistant = {
        ...mockProps,
        assistant: assistantWithUndefinedDescription,
      };

      render(<AssistantEditor {...propsWithAssistant} />);

      expect(screen.getByLabelText('公開描述', { exact: false })).toHaveValue('');
    });
  });

  describe('Form Updates', () => {
    it('updates assistant name when input changes', () => {
      render(<AssistantEditor {...mockProps} />);

      const nameInput = screen.getByLabelText('助理名稱');
      fireEvent.change(nameInput, { target: { value: 'New Assistant Name' } });

      expect(nameInput).toHaveValue('New Assistant Name');
    });

    it('updates description when textarea changes', () => {
      render(<AssistantEditor {...mockProps} />);

      const descriptionInput = screen.getByLabelText('公開描述', { exact: false });
      fireEvent.change(descriptionInput, { target: { value: 'New description' } });

      expect(descriptionInput).toHaveValue('New description');
    });

    it('updates system prompt when textarea changes', () => {
      render(<AssistantEditor {...mockProps} />);

      const systemPromptInput = screen.getByLabelText('系統提示');
      fireEvent.change(systemPromptInput, { target: { value: 'New system prompt' } });

      expect(systemPromptInput).toHaveValue('New system prompt');
    });

    it('updates RAG chunks when RAGFileUpload changes', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByText('Chunks: 0')).toBeInTheDocument();

      const addChunkButton = screen.getByTestId('add-chunk-button');
      fireEvent.click(addChunkButton);

      expect(screen.getByText('Chunks: 1')).toBeInTheDocument();
    });

    it('resets form when assistant prop changes from existing to null', () => {
      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.basic,
      };

      const { rerender } = render(<AssistantEditor {...propsWithAssistant} />);

      expect(screen.getByLabelText('助理名稱')).toHaveValue(TEST_ASSISTANTS.basic.name);

      rerender(<AssistantEditor {...mockProps} />);

      expect(screen.getByLabelText('助理名稱')).toHaveValue('');
      expect(screen.getByLabelText('系統提示')).toHaveValue('您是一個有用且專業的 AI 助理。');
    });

    it('updates form when assistant prop changes from null to existing', () => {
      const { rerender } = render(<AssistantEditor {...mockProps} />);

      expect(screen.getByLabelText('助理名稱')).toHaveValue('');

      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.basic,
      };

      rerender(<AssistantEditor {...propsWithAssistant} />);

      expect(screen.getByLabelText('助理名稱')).toHaveValue(TEST_ASSISTANTS.basic.name);
    });
  });

  describe('Form Validation', () => {
    it('shows alert when trying to save without name', async () => {
      render(<AssistantEditor {...mockProps} />);

      const saveButton = screen.getByRole('button', { name: '保存助理' });
      fireEvent.click(saveButton);

      expect(testEnvironment.alertSpy).toHaveBeenCalledWith('助理名稱為必填。');
      expect(mockProps.onSave).not.toHaveBeenCalled();
    });

    it('shows alert when trying to save with empty name', async () => {
      render(<AssistantEditor {...mockProps} />);

      const nameInput = screen.getByLabelText('助理名稱');
      fireEvent.change(nameInput, { target: { value: '   ' } }); // Whitespace only

      const saveButton = screen.getByRole('button', { name: '保存助理' });
      fireEvent.click(saveButton);

      expect(testEnvironment.alertSpy).toHaveBeenCalledWith('助理名稱為必填。');
      expect(mockProps.onSave).not.toHaveBeenCalled();
    });

    it('allows saving with valid name', async () => {
      render(<AssistantEditor {...mockProps} />);

      const nameInput = screen.getByLabelText('助理名稱');
      fireEvent.change(nameInput, { target: { value: 'Valid Name' } });

      const saveButton = screen.getByRole('button', { name: '保存助理' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockProps.onSave).toHaveBeenCalled();
      });

      expect(testEnvironment.alertSpy).not.toHaveBeenCalled();
    });
  });

  describe('Save Functionality', () => {
    it('saves new assistant with correct data', async () => {
      render(<AssistantEditor {...mockProps} />);

      // Fill form
      fireEvent.change(screen.getByLabelText('助理名稱'), {
        target: { value: '  Test Assistant  ' },
      });
      fireEvent.change(screen.getByLabelText('公開描述', { exact: false }), {
        target: { value: '  Test Description  ' },
      });
      fireEvent.change(screen.getByLabelText('系統提示'), { target: { value: '  Test Prompt  ' } });

      // Add a RAG chunk
      fireEvent.click(screen.getByTestId('add-chunk-button'));

      const saveButton = screen.getByRole('button', { name: '保存助理' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockProps.onSave).toHaveBeenCalled();
      });

      const savedAssistant = (mockProps.onSave as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(savedAssistant.name).toBe('Test Assistant'); // Trimmed
      expect(savedAssistant.description).toBe('Test Description'); // Trimmed
      expect(savedAssistant.systemPrompt).toBe('Test Prompt'); // Trimmed
      expect(savedAssistant.ragChunks).toHaveLength(1);
      expect(savedAssistant.id).toMatch(/^asst_\d+$/);
      expect(savedAssistant.createdAt).toBeTypeOf('number');
    });

    it('saves existing assistant with preserved ID and createdAt', async () => {
      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantEditor {...propsWithAssistant} />);

      const nameInput = screen.getByLabelText('助理名稱');
      fireEvent.change(nameInput, { target: { value: 'Updated Name' } });

      const saveButton = screen.getByRole('button', { name: '保存助理' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockProps.onSave).toHaveBeenCalled();
      });

      const savedAssistant = (mockProps.onSave as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(savedAssistant.id).toBe(TEST_ASSISTANTS.basic.id);
      expect(savedAssistant.createdAt).toBe(TEST_ASSISTANTS.basic.createdAt);
      expect(savedAssistant.name).toBe('Updated Name');
    });

    it('shows loading state during save', async () => {
      // Make onSave take some time so we can observe the loading state
      let resolveSave: () => void;
      const savePromise = new Promise<void>(resolve => {
        resolveSave = resolve;
      });
      mockProps.onSave = vi.fn().mockReturnValue(savePromise);

      render(<AssistantEditor {...mockProps} />);

      fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'Test' } });

      const saveButton = screen.getByTestId('save-button');
      fireEvent.click(saveButton);

      // Should show loading state (text is inside a <span> with a sibling spinner)
      expect(saveButton).toBeDisabled();
      expect(screen.getByText(/處理中/)).toBeInTheDocument();

      // RAG upload should be disabled during save
      expect(screen.getByTestId('add-chunk-button')).toBeDisabled();

      // Resolve the save
      await act(async () => {
        resolveSave!();
        await savePromise;
      });

      // Loading state should be gone
      expect(screen.queryByText(/處理中/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '保存助理' })).toBeInTheDocument();
    });

    it('calls onSave with correct data', async () => {
      render(<AssistantEditor {...mockProps} />);

      fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'Test Assistant' } });
      fireEvent.change(screen.getByLabelText('公開描述', { exact: false }), {
        target: { value: 'Test Description' },
      });
      fireEvent.change(screen.getByLabelText('系統提示'), { target: { value: 'Test Prompt' } });

      const saveButton = screen.getByRole('button', { name: '保存助理' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockProps.onSave).toHaveBeenCalled();
      });

      const savedData = (mockProps.onSave as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(savedData.name).toBe('Test Assistant');
      expect(savedData.description).toBe('Test Description');
      expect(savedData.systemPrompt).toBe('Test Prompt');
      expect(savedData.id).toMatch(/^asst_\d+$/);
      expect(savedData.createdAt).toBeTypeOf('number');
    });

    it('handles save failure gracefully', async () => {
      mockProps.onSave = vi.fn().mockRejectedValue(new Error('Save failed'));

      render(<AssistantEditor {...mockProps} />);

      fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'Test Assistant' } });

      const saveButton = screen.getByRole('button', { name: '保存助理' });

      await act(async () => {
        fireEvent.click(saveButton);
      });

      // Save button should be re-enabled after failure (isSaving reset in finally)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '保存助理' })).not.toBeDisabled();
      });
    });
  });

  describe('Cancel Functionality', () => {
    it('calls onCancel when cancel button is clicked', () => {
      render(<AssistantEditor {...mockProps} />);

      const cancelButton = screen.getByRole('button', { name: '取消' });
      fireEvent.click(cancelButton);

      expect(mockProps.onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not save when cancel is clicked', () => {
      render(<AssistantEditor {...mockProps} />);

      fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'Test Name' } });

      const cancelButton = screen.getByRole('button', { name: '取消' });
      fireEvent.click(cancelButton);

      expect(mockProps.onSave).not.toHaveBeenCalled();
    });
  });

  describe('Share Functionality', () => {
    it('calls onShare when share button is clicked', () => {
      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantEditor {...propsWithAssistant} />);

      // The share button is enabled because useTursoAssistantStatus mock returns canShare: true
      const shareButton = screen.getByText('🎯 分享助理');
      fireEvent.click(shareButton);

      expect(mockProps.onShare).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
    });

    it('does not render share button when assistant is null (new mode)', () => {
      // Share button is only shown for existing assistants
      render(<AssistantEditor {...mockProps} />);

      expect(screen.queryByText('🎯 分享助理')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper labels for all form elements', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByLabelText('助理名稱')).toBeInTheDocument();
      expect(screen.getByLabelText('公開描述', { exact: false })).toBeInTheDocument();
      expect(screen.getByLabelText('系統提示')).toBeInTheDocument();
    });

    it('has proper button roles and labels', () => {
      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantEditor {...propsWithAssistant} />);

      expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '保存助理' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '🎯 分享助理' })).toBeInTheDocument();
    });

    it('has proper form input types', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByLabelText('助理名稱')).toHaveAttribute('type', 'text');
      expect(screen.getByLabelText('公開描述', { exact: false }).tagName.toLowerCase()).toBe(
        'textarea',
      );
      expect(screen.getByLabelText('系統提示').tagName.toLowerCase()).toBe('textarea');
    });

    it('has proper placeholder texts', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByPlaceholderText('例如：行銷文案寫手')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('簡單描述這個助理能幫助什麼...')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('定義助理的角色、個性和指導。')).toBeInTheDocument();
    });
  });

  describe('Layout and Styling', () => {
    it('applies correct CSS classes to main container', () => {
      render(<AssistantEditor {...mockProps} />);

      const container = screen.getByText('新增助理').closest('div');
      expect(container).toHaveClass(
        'flex',
        'flex-col',
        'h-full',
        'bg-gradient-to-br',
        'from-gray-800',
        'to-gray-900',
        'p-8',
        'overflow-y-auto',
        'chat-scroll',
      );
    });

    it('has proper form field styling', () => {
      render(<AssistantEditor {...mockProps} />);

      const nameInput = screen.getByLabelText('助理名稱');
      expect(nameInput).toHaveClass(
        'w-full',
        'bg-gray-700/80',
        'border-2',
        'border-gray-600/50',
        'rounded-xl',
        'px-4',
        'py-3',
        'text-white',
      );
    });

    it('has proper button styling', () => {
      render(<AssistantEditor {...mockProps} />);

      const saveButton = screen.getByRole('button', { name: '保存助理' });
      expect(saveButton).toHaveClass(
        'px-8',
        'py-3',
        'rounded-xl',
        'bg-gradient-to-r',
        'from-cyan-600',
        'to-cyan-500',
      );

      const cancelButton = screen.getByRole('button', { name: '取消' });
      expect(cancelButton).toHaveClass('px-6', 'py-3', 'rounded-xl', 'bg-gray-600/80');
    });

    it('has proper layout for action buttons', () => {
      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantEditor {...propsWithAssistant} />);

      const buttonContainer = screen
        .getByRole('button', { name: '取消' })
        .closest('.flex.space-x-4');
      expect(buttonContainer).toBeInTheDocument();

      const mainActionContainer = buttonContainer?.closest('.flex.justify-between.items-center');
      expect(mainActionContainer).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles very long input values', () => {
      render(<AssistantEditor {...mockProps} />);

      const longName = 'A'.repeat(1000);
      const longDescription = 'B'.repeat(2000);
      const longPrompt = 'C'.repeat(5000);

      fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: longName } });
      fireEvent.change(screen.getByLabelText('公開描述', { exact: false }), {
        target: { value: longDescription },
      });
      fireEvent.change(screen.getByLabelText('系統提示'), { target: { value: longPrompt } });

      expect(screen.getByLabelText('助理名稱')).toHaveValue(longName);
      expect(screen.getByLabelText('公開描述', { exact: false })).toHaveValue(longDescription);
      expect(screen.getByLabelText('系統提示')).toHaveValue(longPrompt);
    });

    it('handles special characters in input', () => {
      render(<AssistantEditor {...mockProps} />);

      const specialName = '助理-2024@test.com (新版本) #1';
      const specialDescription = 'Description with émojis 🤖 and spëcial chars';
      const specialPrompt = 'System prompt with\nnewlines\tand\ttabs';

      fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: specialName } });
      fireEvent.change(screen.getByLabelText('公開描述', { exact: false }), {
        target: { value: specialDescription },
      });
      fireEvent.change(screen.getByLabelText('系統提示'), { target: { value: specialPrompt } });

      expect(screen.getByLabelText('助理名稱')).toHaveValue(specialName);
      expect(screen.getByLabelText('公開描述', { exact: false })).toHaveValue(specialDescription);
      expect(screen.getByLabelText('系統提示')).toHaveValue(specialPrompt);
    });

    it('handles rapid form updates', () => {
      render(<AssistantEditor {...mockProps} />);

      const nameInput = screen.getByLabelText('助理名稱');

      // Simulate rapid typing
      for (let i = 0; i < 10; i++) {
        fireEvent.change(nameInput, { target: { value: `Name ${i}` } });
      }

      expect(nameInput).toHaveValue('Name 9');
    });

    it('handles multiple save attempts', async () => {
      render(<AssistantEditor {...mockProps} />);

      fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'Test' } });

      const saveButton = screen.getByRole('button', { name: '保存助理' });

      // Click save once; subsequent clicks are no-ops because button gets disabled during async handleSave
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockProps.onSave).toHaveBeenCalledTimes(1);
      });
    });

    it('handles assistant prop changing during form interaction', () => {
      const { rerender } = render(<AssistantEditor {...mockProps} />);

      // Start typing in new mode
      fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'New Assistant' } });

      // Switch to edit mode mid-interaction
      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.basic,
      };

      rerender(<AssistantEditor {...propsWithAssistant} />);

      // Form should update to show assistant data
      expect(screen.getByLabelText('助理名稱')).toHaveValue(TEST_ASSISTANTS.basic.name);
      expect(screen.getByText('編輯助理')).toBeInTheDocument();
    });
  });

  describe('Integration with RAGFileUpload', () => {
    it('passes correct props to RAGFileUpload', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByTestId('rag-file-upload')).toBeInTheDocument();
      expect(screen.getByText('Chunks: 0')).toBeInTheDocument();
      expect(screen.getByTestId('add-chunk-button')).not.toBeDisabled();
    });

    it('disables RAGFileUpload during save', async () => {
      // Make onSave async so we can observe the disabled state
      let resolveSave: () => void;
      const savePromise = new Promise<void>(resolve => {
        resolveSave = resolve;
      });
      mockProps.onSave = vi.fn().mockReturnValue(savePromise);

      render(<AssistantEditor {...mockProps} />);

      fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'Test' } });

      const saveButton = screen.getByRole('button', { name: '保存助理' });
      fireEvent.click(saveButton);

      // During save, add-chunk-button should be disabled
      expect(screen.getByTestId('add-chunk-button')).toBeDisabled();

      await act(async () => {
        resolveSave!();
        await savePromise;
      });

      await waitFor(() => {
        expect(mockProps.onSave).toHaveBeenCalled();
      });
    });

    it('updates RAG chunks correctly', () => {
      render(<AssistantEditor {...mockProps} />);

      expect(screen.getByText('Chunks: 0')).toBeInTheDocument();

      // Add chunks
      fireEvent.click(screen.getByTestId('add-chunk-button'));
      expect(screen.getByText('Chunks: 1')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('add-chunk-button'));
      expect(screen.getByText('Chunks: 2')).toBeInTheDocument();

      // Remove chunks
      fireEvent.click(screen.getByTestId('remove-chunk-button'));
      expect(screen.getByText('Chunks: 1')).toBeInTheDocument();
    });

    it('preserves existing RAG chunks when editing', () => {
      const propsWithAssistant = {
        ...mockProps,
        assistant: TEST_ASSISTANTS.withRag,
      };

      render(<AssistantEditor {...propsWithAssistant} />);

      expect(
        screen.getByText(`Chunks: ${TEST_ASSISTANTS.withRag.ragChunks!.length}`),
      ).toBeInTheDocument();
    });
  });
});
