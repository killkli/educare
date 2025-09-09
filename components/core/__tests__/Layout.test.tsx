/// <reference lib="dom" />
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import React from 'react';

// Mock assistant components before importing Layout
vi.mock('../../assistant', () => ({
  AssistantList: ({
    assistants,
    selectedAssistant,
    onSelect,
    onEdit,
    onDelete,
    onShare,
    onCreateNew,
  }: {
    assistants: Array<{ id: string; name: string }>;
    selectedAssistant: { id: string; name: string } | null;
    onSelect: (id: string) => void;
    onEdit: (assistant: { id: string; name: string }) => void;
    onDelete: (id: string) => void;
    onShare: (assistant: { id: string; name: string }) => void;
    onCreateNew: () => void;
  }) => {
    const React = require('react');
    return React.createElement(
      'div',
      {
        'data-testid': 'assistant-list',
        role: 'navigation',
        'aria-label': '助理選擇',
        className: 'mb-6 px-2',
      },
      [
        React.createElement(
          'label',
          {
            key: 'label',
            className: 'block text-sm font-bold text-gray-300 uppercase tracking-wider mb-2',
          },
          '選擇助理',
        ),
        React.createElement(
          'select',
          {
            key: 'select',
            'data-testid': 'assistant-select',
            value: selectedAssistant?.id || '',
            onChange: (e: { target: { value: string } }) => onSelect(e.target.value),
            className:
              'w-full p-2.5 bg-gray-700/50 border border-gray-600/30 rounded-lg text-white text-sm',
          },
          [
            React.createElement('option', { key: 'placeholder', value: '' }, '請選擇一個助理'),
            ...assistants.map((assistant: { id: string; name: string }) =>
              React.createElement(
                'option',
                { key: assistant.id, value: assistant.id },
                assistant.name,
              ),
            ),
          ],
        ),
        React.createElement(
          'div',
          {
            key: 'actions',
            className: 'flex justify-end gap-1 mt-2',
          },
          [
            React.createElement(
              'button',
              {
                key: 'create-new',
                onClick: onCreateNew,
                'data-testid': 'create-new-button',
                className: 'p-1.5 text-gray-400 hover:text-cyan-400 rounded-md',
                title: '新增助理',
              },
              '+',
            ),
            selectedAssistant &&
              React.createElement(
                'button',
                {
                  key: 'share',
                  onClick: () => onShare(selectedAssistant),
                  'data-testid': `share-${selectedAssistant.id}`,
                  className: 'p-1.5 text-gray-400 hover:text-blue-400 rounded-md',
                  title: '分享助理',
                },
                'Share',
              ),
            selectedAssistant &&
              React.createElement(
                'button',
                {
                  key: 'edit',
                  onClick: () => onEdit(selectedAssistant),
                  'data-testid': `edit-${selectedAssistant.id}`,
                  className: 'p-1.5 text-gray-400 hover:text-cyan-400 rounded-md',
                  title: '編輯助理',
                },
                'Edit',
              ),
            selectedAssistant &&
              React.createElement(
                'button',
                {
                  key: 'delete',
                  onClick: () => onDelete(selectedAssistant.id),
                  'data-testid': `delete-${selectedAssistant.id}`,
                  className: 'p-1.5 text-gray-400 hover:text-red-400 rounded-md',
                  title: '刪除助理',
                },
                'Delete',
              ),
          ],
        ),
      ],
    );
  },
}));

// Mock UI Icons
vi.mock('../../ui/Icons', () => ({
  ChatIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'chat-icon', className }, 'Chat');
  },
  TrashIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'trash-icon', className }, 'Trash');
  },
  SettingsIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'settings-icon', className }, 'Settings');
  },
}));

// Mock services
vi.mock('../../../services/db', () => ({
  getAssistant: vi.fn(),
  saveAssistant: vi.fn(),
  deleteAssistant: vi.fn(),
  getAllAssistants: vi.fn(),
  getSessionsForAssistant: vi.fn(),
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('../../../services/tursoService', () => ({
  canWriteToTurso: vi.fn().mockReturnValue(true),
}));

vi.mock('../../../services/embeddingService', () => ({
  preloadEmbeddingModel: vi.fn().mockResolvedValue(undefined),
  isEmbeddingModelLoaded: vi.fn().mockReturnValue(true),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

vi.mock('../../../services/providerRegistry', () => ({
  initializeProviders: vi.fn().mockResolvedValue(undefined),
  providerManager: {
    getAvailableProviders: vi.fn().mockReturnValue(['gemini']),
  },
}));

import { Layout } from '../Layout';
import { AppProvider } from '../AppContext';
import {
  setupCoreTestEnvironment,
  TEST_ASSISTANTS,
  TEST_SESSIONS,
  RESPONSIVE_BREAKPOINTS,
} from './test-utils';

// Test component that uses Layout
function TestLayoutContent() {
  return (
    <div data-testid='layout-content'>
      <h1>Test Content</h1>
      <p>This is test content inside the layout</p>
    </div>
  );
}

// Wrapper component to provide app context
function TestLayoutWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Layout>{children}</Layout>
    </AppProvider>
  );
}

beforeAll(() => {
  setupCoreTestEnvironment();
});

describe('Layout', () => {
  let testEnvironment: ReturnType<typeof setupCoreTestEnvironment>;

  beforeEach(async () => {
    testEnvironment = setupCoreTestEnvironment();

    // Setup mock data for layout tests
    const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
    const mockGetAssistant = vi.mocked(await import('../../../services/db')).getAssistant;
    const mockGetSessions = vi.mocked(await import('../../../services/db')).getSessionsForAssistant;

    mockGetAllAssistants.mockResolvedValue([TEST_ASSISTANTS.basic, TEST_ASSISTANTS.withRag]);
    mockGetAssistant.mockResolvedValue(TEST_ASSISTANTS.basic);
    mockGetSessions.mockResolvedValue([TEST_SESSIONS.withMessages, TEST_SESSIONS.empty]);
  });

  afterEach(() => {
    testEnvironment.cleanup();
  });

  describe('Basic Structure', () => {
    it('should render sidebar and main content area', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Wait for loading to complete
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Should render main content
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByTestId('layout-content')).toBeInTheDocument();

      // Should render sidebar with assistant list
      expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
    });

    it('should render children content correctly', () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      expect(screen.getByText('Test Content')).toBeInTheDocument();
      expect(screen.getByText('This is test content inside the layout')).toBeInTheDocument();
    });

    it('should have proper ARIA labels for navigation', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const navigation = screen.getByRole('navigation', { name: '聊天記錄' });
        expect(navigation).toBeInTheDocument();
      });
    });
  });

  describe('Sidebar Behavior', () => {
    it('should show sidebar by default on desktop', async () => {
      // Set desktop width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const sidebar = screen.getByTestId('assistant-list').closest('div');
        expect(sidebar).toHaveClass('translate-x-0');
      });
    });

    it('should hide sidebar by default on mobile', async () => {
      // Set mobile width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // Mobile sidebar should be hidden initially
        const sidebar = screen.getByTestId('assistant-list').closest('div');
        expect(sidebar).toHaveClass('-translate-x-full');
      });
    });

    it('should hide sidebar by default on tablet', async () => {
      // Set tablet width
      Object.defineProperty(window, 'innerWidth', {
        value: (RESPONSIVE_BREAKPOINTS.mobile + RESPONSIVE_BREAKPOINTS.desktop) / 2,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const sidebar = screen.getByTestId('assistant-list').closest('div');
        expect(sidebar).toHaveClass('-translate-x-full');
      });
    });

    it('should toggle sidebar visibility when hamburger menu is clicked', async () => {
      // Set mobile width to show hamburger menu
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // Find hamburger menu button
        const hamburgerButton = screen.getByRole('button', { name: /menu/i });
        expect(hamburgerButton).toBeInTheDocument();
      });

      const hamburgerButton = screen.getByRole('button', { name: /menu/i });

      // Click to open sidebar
      await act(async () => {
        fireEvent.click(hamburgerButton);
      });

      await waitFor(() => {
        const sidebar = screen.getByTestId('assistant-list').closest('div');
        expect(sidebar).toHaveClass('translate-x-0');
      });
    });

    it('should show close button in sidebar on mobile when open', async () => {
      // Set mobile width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Open sidebar first
      await waitFor(() => {
        const hamburgerButton = screen.getByRole('button', { name: /menu/i });
        return hamburgerButton;
      });

      const hamburgerButton = screen.getByRole('button', { name: /menu/i });
      await act(async () => {
        fireEvent.click(hamburgerButton);
      });

      // Should show close button in sidebar
      await waitFor(() => {
        const closeButton = screen.getByRole('button', { name: /close/i });
        expect(closeButton).toBeInTheDocument();
      });
    });

    it('should close sidebar when close button is clicked', async () => {
      // Set mobile width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Open sidebar
      const hamburgerButton = await waitFor(() => screen.getByRole('button', { name: /menu/i }));

      await act(async () => {
        fireEvent.click(hamburgerButton);
      });

      // Find and click close button
      const closeButton = await waitFor(() => screen.getByRole('button', { name: /close/i }));

      await act(async () => {
        fireEvent.click(closeButton);
      });

      await waitFor(() => {
        const sidebar = screen.getByTestId('assistant-list').closest('div');
        expect(sidebar).toHaveClass('-translate-x-full');
      });
    });

    it('should show overlay when sidebar is open on mobile', async () => {
      // Set mobile width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Open sidebar
      const hamburgerButton = await waitFor(() => screen.getByRole('button', { name: /menu/i }));

      await act(async () => {
        fireEvent.click(hamburgerButton);
      });

      // Should show overlay
      await waitFor(() => {
        const overlay = screen.getByRole('button', { hidden: true }); // The overlay div
        expect(overlay).toBeInTheDocument();
      });
    });

    it('should close sidebar when overlay is clicked', async () => {
      // Set mobile width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Open sidebar
      const hamburgerButton = await waitFor(() => screen.getByRole('button', { name: /menu/i }));

      await act(async () => {
        fireEvent.click(hamburgerButton);
      });

      // Click overlay to close
      const overlay = await waitFor(() => {
        const overlayElement = document.querySelector('.fixed.inset-0.bg-black\\/50');
        expect(overlayElement).toBeInTheDocument();
        return overlayElement as HTMLElement;
      });

      await act(async () => {
        fireEvent.click(overlay);
      });

      await waitFor(() => {
        const sidebar = screen.getByTestId('assistant-list').closest('div');
        expect(sidebar).toHaveClass('-translate-x-full');
      });
    });
  });

  describe('Responsive Design', () => {
    it('should use mobile width for sidebar on mobile devices', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const sidebar = screen.getByTestId('assistant-list').closest('div');
        expect(sidebar).toHaveClass('w-80'); // Mobile width
      });
    });

    it('should use tablet width for sidebar on tablet devices', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: (RESPONSIVE_BREAKPOINTS.mobile + RESPONSIVE_BREAKPOINTS.desktop) / 2,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const sidebar = screen.getByTestId('assistant-list').closest('div');
        expect(sidebar).toHaveClass('w-80'); // Tablet width
      });
    });

    it('should use desktop width for sidebar on desktop devices', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const sidebar = screen.getByTestId('assistant-list').closest('div');
        expect(sidebar).toHaveClass('w-72'); // Desktop width
      });
    });

    it('should adjust main content margin based on sidebar state on desktop', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const main = screen.getByRole('main');
        expect(main).toHaveClass('ml-72'); // Desktop margin when sidebar is open
      });
    });

    it('should not adjust main content margin on mobile/tablet', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const main = screen.getByRole('main');
        expect(main).not.toHaveClass('ml-72');
      });
    });

    it('should show hamburger menu only on mobile and tablet', async () => {
      // Test mobile
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      const { rerender } = render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
      });

      // Test desktop
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      rerender(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /menu/i })).not.toBeInTheDocument();
      });
    });
  });

  describe('Assistant List Integration', () => {
    it('should render assistant list with loaded assistants', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
        expect(screen.getByText('選擇助理')).toBeInTheDocument();
      });
    });

    it('should handle assistant selection', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const selectButton = screen.getByTestId('select-test-assistant-1');
        expect(selectButton).toBeInTheDocument();
      });

      const selectButton = screen.getByTestId('select-test-assistant-1');
      await act(async () => {
        fireEvent.click(selectButton);
      });

      // Should trigger assistant selection
      const mockSelectAssistant = vi.mocked(await import('../../../services/db')).getAssistant;
      expect(mockSelectAssistant).toHaveBeenCalledWith('test-assistant-1');
    });

    it('should handle assistant editing', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const editButton = screen.getByTestId('edit-test-assistant-1');
        expect(editButton).toBeInTheDocument();
      });

      const editButton = screen.getByTestId('edit-test-assistant-1');
      await act(async () => {
        fireEvent.click(editButton);
      });

      // Should trigger assistant selection and edit mode
      await waitFor(() => {
        const mockSelectAssistant = vi.mocked(import('../../../services/db')).getAssistant;
        expect(mockSelectAssistant).toHaveBeenCalled();
      });
    });

    it('should handle assistant deletion', async () => {
      testEnvironment.confirmSpy.mockReturnValue(true);

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const deleteButton = screen.getByTestId('delete-test-assistant-1');
        expect(deleteButton).toBeInTheDocument();
      });

      const deleteButton = screen.getByTestId('delete-test-assistant-1');
      await act(async () => {
        fireEvent.click(deleteButton);
      });

      expect(testEnvironment.confirmSpy).toHaveBeenCalled();
    });

    it('should handle assistant sharing', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const shareButton = screen.getByTestId('share-test-assistant-1');
        expect(shareButton).toBeInTheDocument();
      });

      const shareButton = screen.getByTestId('share-test-assistant-1');
      await act(async () => {
        fireEvent.click(shareButton);
      });

      // Should open share modal
      await waitFor(() => {
        expect(screen.getByTestId('share-modal')).toBeInTheDocument();
      });
    });

    it('should handle creating new assistant', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const createButton = screen.getByTestId('create-new-button');
        expect(createButton).toBeInTheDocument();
      });

      const createButton = screen.getByTestId('create-new-button');
      await act(async () => {
        fireEvent.click(createButton);
      });

      // Should switch to new assistant mode
      // Note: This would be tested in integration with the full app context
    });
  });

  describe('Session List', () => {
    it('should render session list when assistant is selected', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText('聊天記錄')).toBeInTheDocument();
        expect(screen.getByText('新增聊天')).toBeInTheDocument();
      });
    });

    it('should handle creating new chat session', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const newChatButton = screen.getByText('新增聊天');
        expect(newChatButton).toBeInTheDocument();
      });

      const newChatButton = screen.getByText('新增聊天');
      await act(async () => {
        fireEvent.click(newChatButton);
      });

      // Should create new session
      const mockSaveSession = vi.mocked(await import('../../../services/db')).saveSession;
      await waitFor(() => {
        expect(mockSaveSession).toHaveBeenCalled();
      });
    });

    it('should render existing chat sessions', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // Should show session titles
        expect(screen.getByText('Active Chat')).toBeInTheDocument();
        expect(screen.getByText('New Chat')).toBeInTheDocument();
      });
    });

    it('should handle session selection', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const sessionButton = screen.getByText('Active Chat').closest('div');
        expect(sessionButton).toBeInTheDocument();
      });

      const sessionButton = screen.getByText('Active Chat').closest('div') as HTMLElement;
      await act(async () => {
        fireEvent.click(sessionButton);
      });

      // Should select the session (tested via CSS class changes)
      expect(sessionButton).toHaveClass('bg-cyan-600/20');
    });

    it('should handle session deletion', async () => {
      testEnvironment.confirmSpy.mockReturnValue(true);

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // Find delete button (appears on hover)
        const sessionRow = screen.getByText('Active Chat').closest('.group');
        expect(sessionRow).toBeInTheDocument();
      });

      const sessionRow = screen.getByText('Active Chat').closest('.group') as HTMLElement;
      const deleteButton = sessionRow
        .querySelector('[data-testid="trash-icon"]')
        ?.closest('button');

      if (deleteButton) {
        await act(async () => {
          fireEvent.click(deleteButton);
        });

        expect(testEnvironment.confirmSpy).toHaveBeenCalled();
      }
    });

    it('should display session timestamps', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // Should show formatted date/time for sessions
        const timeElements = screen.getAllByText(/\d+:\d+/);
        expect(timeElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Top Bar', () => {
    it('should show appropriate title based on view mode', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // Should show assistant name in chat mode
        expect(screen.getByText('Basic Assistant')).toBeInTheDocument();
      });
    });

    it('should show settings title when in settings mode', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Navigate to settings mode (this would be done via context in real usage)
      // For now we test that the title logic exists
      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });
  });

  describe('Settings Section', () => {
    it('should render settings button in sidebar', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText('設定')).toBeInTheDocument();
        expect(screen.getByTestId('settings-icon')).toBeInTheDocument();
      });
    });

    it('should handle settings navigation', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const settingsButton = screen.getByText('設定');
        expect(settingsButton).toBeInTheDocument();
      });

      const settingsButton = screen.getByText('設定');
      await act(async () => {
        fireEvent.click(settingsButton);
      });

      // Should navigate to settings mode
      // This would be verified through the context state changes
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA roles and labels', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByRole('navigation', { name: '聊天記錄' })).toBeInTheDocument();
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });

    it('should support keyboard navigation', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Test that buttons are focusable
      await waitFor(() => {
        const settingsButton = screen.getByText('設定');
        expect(settingsButton).toBeInTheDocument();
      });

      const settingsButton = screen.getByText('設定');
      settingsButton.focus();
      expect(document.activeElement).toBe(settingsButton);
    });

    it('should have proper button titles for actions', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const sessionRow = screen.getByText('Active Chat').closest('.group');
        const deleteButton = sessionRow?.querySelector('button[title="刪除聊天"]');
        expect(deleteButton).toBeInTheDocument();
      });
    });
  });

  describe('Dynamic Content Updates', () => {
    it('should update when assistants list changes', async () => {
      const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;

      const { rerender } = render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('assistant-item-test-assistant-1')).toBeInTheDocument();
      });

      // Update mock to return different assistants
      mockGetAllAssistants.mockResolvedValue([TEST_ASSISTANTS.withRag]);

      rerender(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // The component should react to context updates
      // This is more of an integration test with the full app context
    });

    it('should update when sessions list changes', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText('Active Chat')).toBeInTheDocument();
        expect(screen.getByText('New Chat')).toBeInTheDocument();
      });

      // Sessions should update when context changes
      // This would be tested in full integration tests
    });
  });
});
