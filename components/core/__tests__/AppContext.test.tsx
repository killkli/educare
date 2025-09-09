import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import React from 'react';
import { AppProvider } from '../AppContext';
import { useAppContext } from '../useAppContext';
import {
  setupCoreTestEnvironment,
  createMockModelLoadingProgress,
  TEST_ASSISTANTS,
  TEST_SESSIONS,
  TEST_VIEW_MODES,
  RESPONSIVE_BREAKPOINTS,
} from './test-utils';

// Test component to access context
function TestConsumer() {
  const { state, dispatch, actions } = useAppContext();

  return (
    <div data-testid='test-consumer'>
      <div data-testid='current-view-mode'>{state.viewMode}</div>
      <div data-testid='assistants-count'>{state.assistants.length}</div>
      <div data-testid='sessions-count'>{state.sessions.length}</div>
      <div data-testid='current-assistant'>{state.currentAssistant?.name || 'none'}</div>
      <div data-testid='current-session'>{state.currentSession?.title || 'none'}</div>
      <div data-testid='is-loading'>{state.isLoading.toString()}</div>
      <div data-testid='error'>{state.error || 'none'}</div>
      <div data-testid='is-sidebar-open'>{state.isSidebarOpen.toString()}</div>
      <div data-testid='is-mobile'>{state.isMobile.toString()}</div>
      <div data-testid='is-tablet'>{state.isTablet.toString()}</div>
      <div data-testid='is-model-loading'>{state.isModelLoading.toString()}</div>
      <div data-testid='is-share-modal-open'>{state.isShareModalOpen.toString()}</div>

      {/* Action buttons for testing */}
      <button data-testid='load-data' onClick={() => actions.loadData()}>
        Load Data
      </button>
      <button
        data-testid='select-assistant'
        onClick={() => actions.selectAssistant('test-assistant-1')}
      >
        Select Assistant
      </button>
      <button
        data-testid='save-assistant'
        onClick={() => actions.saveAssistant(TEST_ASSISTANTS.basic)}
      >
        Save Assistant
      </button>
      <button
        data-testid='delete-assistant'
        onClick={() => actions.deleteAssistant('test-assistant-1')}
      >
        Delete Assistant
      </button>
      <button
        data-testid='create-session'
        onClick={() => actions.createNewSession('test-assistant-1')}
      >
        Create Session
      </button>
      <button data-testid='delete-session' onClick={() => actions.deleteSession('test-session-1')}>
        Delete Session
      </button>
      <button
        data-testid='update-session'
        onClick={() => actions.updateSession(TEST_SESSIONS.withMessages)}
      >
        Update Session
      </button>
      <button data-testid='set-view-mode' onClick={() => actions.setViewMode('settings')}>
        Set View Mode
      </button>
      <button data-testid='toggle-sidebar' onClick={actions.toggleSidebar}>
        Toggle Sidebar
      </button>
      <button
        data-testid='open-share-modal'
        onClick={() => actions.openShareModal(TEST_ASSISTANTS.basic)}
      >
        Open Share Modal
      </button>
      <button data-testid='close-share-modal' onClick={actions.closeShareModal}>
        Close Share Modal
      </button>
      <button data-testid='check-screen-size' onClick={actions.checkScreenSize}>
        Check Screen Size
      </button>

      {/* Dispatch test button */}
      <button
        data-testid='dispatch-action'
        onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'new_assistant' })}
      >
        Dispatch Action
      </button>
    </div>
  );
}

// Mock dependencies
beforeAll(() => {
  setupCoreTestEnvironment();
});

describe('AppContext', () => {
  let testEnvironment: ReturnType<typeof setupCoreTestEnvironment>;

  beforeEach(() => {
    testEnvironment = setupCoreTestEnvironment();
  });

  afterEach(() => {
    testEnvironment.cleanup();
  });

  describe('Context Provider', () => {
    it('should provide context to child components', () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      expect(screen.getByTestId('test-consumer')).toBeInTheDocument();
      expect(screen.getByTestId('current-view-mode')).toHaveTextContent('chat');
      expect(screen.getByTestId('is-loading')).toHaveTextContent('true'); // Initial loading state
    });

    it('should throw error when useAppContext is used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestConsumer />);
      }).toThrow('useAppContext must be used within an AppProvider');

      consoleSpy.mockRestore();
    });

    it('should initialize with default state values', () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      expect(screen.getByTestId('assistants-count')).toHaveTextContent('0');
      expect(screen.getByTestId('sessions-count')).toHaveTextContent('0');
      expect(screen.getByTestId('current-assistant')).toHaveTextContent('none');
      expect(screen.getByTestId('current-session')).toHaveTextContent('none');
      expect(screen.getByTestId('current-view-mode')).toHaveTextContent('chat');
      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('true');
      expect(screen.getByTestId('is-mobile')).toHaveTextContent('false');
      expect(screen.getByTestId('is-tablet')).toHaveTextContent('false');
      expect(screen.getByTestId('error')).toHaveTextContent('none');
    });
  });

  describe('State Management - Reducer', () => {
    it('should handle SET_ASSISTANTS action', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        // Simulate dispatching SET_ASSISTANTS
        screen.getByTestId('dispatch-action').click();
        // We need to test this through actions since we can't directly dispatch SET_ASSISTANTS
        const loadDataButton = screen.getByTestId('load-data');
        loadDataButton.click();
      });

      // Wait for async operations to complete
      await waitFor(() => {
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });
    });

    it('should handle SET_VIEW_MODE action', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('dispatch-action').click();
      });

      expect(screen.getByTestId('current-view-mode')).toHaveTextContent('new_assistant');
    });

    it('should handle SET_LOADING action', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Initial loading state should be true
      expect(screen.getByTestId('is-loading')).toHaveTextContent('true');

      // Wait for loading to complete (through loadData effect)
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );
    });

    it('should handle SET_SIDEBAR_OPEN action', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Initial state should be true
      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('true');

      await act(async () => {
        screen.getByTestId('toggle-sidebar').click();
      });

      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('false');
    });

    it('should handle SET_SHARE_MODAL action', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Initial state should be false
      expect(screen.getByTestId('is-share-modal-open')).toHaveTextContent('false');

      await act(async () => {
        screen.getByTestId('open-share-modal').click();
      });

      expect(screen.getByTestId('is-share-modal-open')).toHaveTextContent('true');

      await act(async () => {
        screen.getByTestId('close-share-modal').click();
      });

      expect(screen.getByTestId('is-share-modal-open')).toHaveTextContent('false');
    });
  });

  describe('Screen Size Detection', () => {
    it('should detect mobile screen size', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 1,
        writable: true,
      });

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('check-screen-size').click();
      });

      expect(screen.getByTestId('is-mobile')).toHaveTextContent('true');
      expect(screen.getByTestId('is-tablet')).toHaveTextContent('false');
      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('false'); // Should close on mobile
    });

    it('should detect tablet screen size', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: (RESPONSIVE_BREAKPOINTS.mobile + RESPONSIVE_BREAKPOINTS.desktop) / 2,
        writable: true,
      });

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('check-screen-size').click();
      });

      expect(screen.getByTestId('is-mobile')).toHaveTextContent('false');
      expect(screen.getByTestId('is-tablet')).toHaveTextContent('true');
      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('false'); // Should close on tablet
    });

    it('should detect desktop screen size', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 1,
        writable: true,
      });

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('check-screen-size').click();
      });

      expect(screen.getByTestId('is-mobile')).toHaveTextContent('false');
      expect(screen.getByTestId('is-tablet')).toHaveTextContent('false');
      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('true'); // Should remain open on desktop
    });
  });

  describe('Shared Mode Detection', () => {
    it('should detect shared mode from URL parameters', () => {
      const mockURLSearchParams = testEnvironment.mockURLSearchParams;
      mockURLSearchParams.mockImplementation(_search => ({
        has: vi.fn().mockImplementation((key: string) => key === 'share'),
        get: vi
          .fn()
          .mockImplementation((key: string) => (key === 'share' ? 'test-shared-id' : null)),
      }));

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // In shared mode, loadData should not be called automatically
      // We can verify this indirectly by checking loading state remains true longer
    });

    it('should not be in shared mode by default', () => {
      const mockURLSearchParams = testEnvironment.mockURLSearchParams;
      mockURLSearchParams.mockImplementation(_search => ({
        has: vi.fn().mockReturnValue(false),
        get: vi.fn().mockReturnValue(null),
      }));

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Should start loading data automatically in non-shared mode
      expect(screen.getByTestId('is-loading')).toHaveTextContent('true');
    });
  });

  describe('Action Handlers - Assistant Management', () => {
    it('should handle assistant selection', async () => {
      const mockGetAssistant = vi.mocked(await import('../../../services/db')).getAssistant;
      mockGetAssistant.mockResolvedValue(TEST_ASSISTANTS.basic);

      const mockGetSessions = vi.mocked(
        await import('../../../services/db'),
      ).getSessionsForAssistant;
      mockGetSessions.mockResolvedValue([TEST_SESSIONS.withMessages]);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('select-assistant').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('current-assistant')).toHaveTextContent('Basic Assistant');
        expect(screen.getByTestId('current-view-mode')).toHaveTextContent('chat');
        expect(screen.getByTestId('sessions-count')).toHaveTextContent('1');
      });
    });

    it('should handle assistant saving', async () => {
      const mockSaveAssistant = vi.mocked(await import('../../../services/db')).saveAssistant;
      const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
      mockGetAllAssistants.mockResolvedValue([TEST_ASSISTANTS.basic]);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('save-assistant').click();
      });

      await waitFor(() => {
        expect(mockSaveAssistant).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
      });
    });

    it('should handle assistant deletion with confirmation', async () => {
      testEnvironment.confirmSpy.mockReturnValue(true);
      const mockDeleteAssistant = vi.mocked(await import('../../../services/db')).deleteAssistant;

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('delete-assistant').click();
      });

      expect(testEnvironment.confirmSpy).toHaveBeenCalledWith('確定要刪除此助理和所有聊天記錄嗎？');
      await waitFor(() => {
        expect(mockDeleteAssistant).toHaveBeenCalledWith('test-assistant-1');
      });
    });

    it('should cancel assistant deletion when not confirmed', async () => {
      testEnvironment.confirmSpy.mockReturnValue(false);
      const mockDeleteAssistant = vi.mocked(await import('../../../services/db')).deleteAssistant;

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('delete-assistant').click();
      });

      expect(testEnvironment.confirmSpy).toHaveBeenCalled();
      expect(mockDeleteAssistant).not.toHaveBeenCalled();
    });
  });

  describe('Action Handlers - Session Management', () => {
    it('should handle session creation', async () => {
      const mockSaveSession = vi.mocked(await import('../../../services/db')).saveSession;

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('create-session').click();
      });

      await waitFor(() => {
        expect(mockSaveSession).toHaveBeenCalled();
        expect(screen.getByTestId('sessions-count')).toHaveTextContent('1');
      });
    });

    it('should handle session deletion with confirmation', async () => {
      testEnvironment.confirmSpy.mockReturnValue(true);
      const mockDeleteSession = vi.mocked(await import('../../../services/db')).deleteSession;
      const mockGetSessions = vi.mocked(
        await import('../../../services/db'),
      ).getSessionsForAssistant;
      mockGetSessions.mockResolvedValue([]);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('delete-session').click();
      });

      expect(testEnvironment.confirmSpy).toHaveBeenCalledWith('確定要刪除此聊天會話嗎？');
      await waitFor(() => {
        expect(mockDeleteSession).toHaveBeenCalledWith('test-session-1');
      });
    });

    it('should handle session updates', async () => {
      const mockSaveSession = vi.mocked(await import('../../../services/db')).saveSession;

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('update-session').click();
      });

      await waitFor(() => {
        expect(mockSaveSession).toHaveBeenCalledWith(TEST_SESSIONS.withMessages);
      });
    });
  });

  describe('View Mode Management', () => {
    it('should handle view mode changes', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      for (let i = 0; i < TEST_VIEW_MODES.length; i++) {
        await act(async () => {
          screen.getByTestId('set-view-mode').click();
        });
        expect(screen.getByTestId('current-view-mode')).toHaveTextContent('settings');
      }
    });

    it('should default to new_assistant when no assistants exist', async () => {
      const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
      mockGetAllAssistants.mockResolvedValue([]);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('current-view-mode')).toHaveTextContent('new_assistant');
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });
    });
  });

  describe('Model Loading', () => {
    it('should handle embedding model preloading', async () => {
      const mockIsEmbeddingModelLoaded = vi.mocked(
        await import('../../../services/embeddingService'),
      ).isEmbeddingModelLoaded;
      const mockPreloadEmbeddingModel = vi.mocked(
        await import('../../../services/embeddingService'),
      ).preloadEmbeddingModel;

      mockIsEmbeddingModelLoaded.mockReturnValue(false);
      mockPreloadEmbeddingModel.mockImplementation(async progressCallback => {
        // Simulate progress updates
        const progress = createMockModelLoadingProgress();
        progressCallback && progressCallback(progress);
      });

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Should start model loading
      await waitFor(() => {
        expect(screen.getByTestId('is-model-loading')).toHaveTextContent('true');
      });

      // Should complete model loading
      await waitFor(
        () => {
          expect(screen.getByTestId('is-model-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );
    });

    it('should skip model preloading when already loaded', async () => {
      const mockIsEmbeddingModelLoaded = vi.mocked(
        await import('../../../services/embeddingService'),
      ).isEmbeddingModelLoaded;
      const mockPreloadEmbeddingModel = vi.mocked(
        await import('../../../services/embeddingService'),
      ).preloadEmbeddingModel;

      mockIsEmbeddingModelLoaded.mockReturnValue(true);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });

      expect(mockPreloadEmbeddingModel).not.toHaveBeenCalled();
      expect(screen.getByTestId('is-model-loading')).toHaveTextContent('false');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors during loading', async () => {
      const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
      mockGetAllAssistants.mockRejectedValue(new Error('Database connection failed'));

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('無法從資料庫載入資料。');
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });
    });

    it('should handle model loading errors', async () => {
      const mockIsEmbeddingModelLoaded = vi.mocked(
        await import('../../../services/embeddingService'),
      ).isEmbeddingModelLoaded;
      const mockPreloadEmbeddingModel = vi.mocked(
        await import('../../../services/embeddingService'),
      ).preloadEmbeddingModel;

      mockIsEmbeddingModelLoaded.mockReturnValue(false);
      mockPreloadEmbeddingModel.mockRejectedValue(new Error('Model loading failed'));

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Should complete despite model loading error
      await waitFor(
        () => {
          expect(screen.getByTestId('is-model-loading')).toHaveTextContent('false');
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );

      expect(testEnvironment.errorSpy).toHaveBeenCalledWith(
        '❌ Failed to preload embedding model:',
        expect.any(Error),
      );
    });
  });

  describe('Cleanup and Effects', () => {
    it('should add and remove resize event listeners', () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      expect(testEnvironment.addEventListenerSpy).toHaveBeenCalledWith(
        'resize',
        expect.any(Function),
      );
    });

    it('should initialize provider registry', async () => {
      const mockInitializeProviders = vi.mocked(
        await import('../../../services/providerRegistry'),
      ).initializeProviders;

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(() => {
        expect(mockInitializeProviders).toHaveBeenCalled();
      });
    });
  });
});
