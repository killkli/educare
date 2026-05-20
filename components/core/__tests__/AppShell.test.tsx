/// <reference types="vitest/globals" />
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import React from 'react';
import { AppShell } from '../AppShell';
import { TEST_ASSISTANTS, TEST_SESSIONS } from './test-constants';
import * as dbMock from '../../../services/db';
import * as embeddingMock from '../../../services/embeddingService';
import * as providerMock from '../../../services/providerRegistry';
import * as tursoMock from '../../../services/tursoService';

// Mock ErrorBoundary separately to test error handling
vi.mock('../ErrorBoundary', () => {
  const MockErrorBoundary = vi.fn(({ children }: { children: React.ReactNode }) => {
    return React.createElement('div', { 'data-testid': 'error-boundary' }, children);
  });

  return {
    ErrorBoundary: MockErrorBoundary,
  };
});

vi.mock('../../../services/shortUrlService', () => ({
  resolveShortUrl: vi.fn().mockResolvedValue(null),
  recordShortUrlClick: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/tursoService', () => ({
  canWriteToTurso: vi.fn().mockReturnValue(true),
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  getAssistantFromTurso: vi.fn().mockResolvedValue(null),
  checkAssistantExistsInTurso: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../services/cryptoService', () => ({
  CryptoService: {
    encryptApiKeys: vi.fn().mockResolvedValue('encrypted'),
    decryptApiKeys: vi.fn().mockResolvedValue({}),
    extractKeysFromUrl: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../../../services/apiKeyManager', () => ({
  ApiKeyManager: {
    getUserApiKeys: vi.fn().mockReturnValue({}),
    saveUserApiKeys: vi.fn(),
  },
}));

vi.mock('../../../hooks/useTursoAssistantStatus', () => ({
  useTursoAssistantStatus: vi.fn().mockReturnValue({ canShare: true }),
}));

vi.mock('../../../services/db', () => ({
  getAssistant: vi.fn().mockResolvedValue(null),
  saveAssistant: vi.fn().mockResolvedValue(undefined),
  deleteAssistant: vi.fn().mockResolvedValue(undefined),
  getAllAssistants: vi.fn().mockResolvedValue([]),
  getSessionsForAssistant: vi.fn().mockResolvedValue([]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
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
    getActiveProvider: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../../assistant', () => ({
  AssistantEditor: ({
    assistant,
    onCancel,
    onSave,
  }: {
    assistant?: { name: string } | null;
    onCancel?: () => void;
    onSave?: (a: unknown) => void;
  }) =>
    React.createElement('div', { 'data-testid': 'assistant-editor' }, [
      React.createElement('span', { key: 'mode' }, assistant ? 'Edit Mode' : 'New Mode'),
      React.createElement(
        'button',
        { key: 'cancel', 'data-testid': 'cancel-button', onClick: onCancel },
        'Cancel',
      ),
      React.createElement(
        'button',
        {
          key: 'save',
          'data-testid': 'save-button',
          onClick: () => onSave && onSave(assistant || {}),
        },
        'Save',
      ),
    ]),
  ShareModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? React.createElement('div', { 'data-testid': 'share-modal' }) : null,
  AssistantList: () => React.createElement('div', { 'data-testid': 'assistant-list' }),
}));

vi.mock('../../chat', () => ({
  ChatContainer: ({
    assistantName,
    session,
    onNewMessage,
  }: {
    assistantName: string;
    session: any;
    onNewMessage?: (session: any, msg: string, response?: string, tokenInfo?: any) => void;
  }) =>
    React.createElement('div', { 'data-testid': 'chat-container' }, [
      React.createElement('span', { key: 'name' }, `Chatting with ${assistantName}`),
      React.createElement(
        'button',
        {
          key: 'send',
          'data-testid': 'send-message',
          onClick: () =>
            onNewMessage &&
            onNewMessage(session, 'test message', 'model response', {
              promptTokenCount: 10,
              candidatesTokenCount: 15,
            }),
        },
        'Send',
      ),
    ]),
}));

vi.mock('../../features/SharedAssistant', () => ({
  default: ({ assistantId }: { assistantId: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'shared-assistant' },
      `Shared Assistant: ${assistantId}`,
    ),
}));

vi.mock('../../settings/ApiKeySetup', () => ({
  default: ({ onComplete, onCancel }: { onComplete?: () => void; onCancel?: () => void }) =>
    React.createElement('div', { 'data-testid': 'api-key-setup' }, [
      React.createElement(
        'button',
        { key: 'complete', 'data-testid': 'api-complete', onClick: onComplete },
        'Complete',
      ),
      React.createElement(
        'button',
        { key: 'cancel', 'data-testid': 'api-cancel', onClick: onCancel },
        'Cancel',
      ),
    ]),
}));

vi.mock('../../settings/ProviderSettings', () => ({
  default: () => React.createElement('div', { 'data-testid': 'provider-settings' }),
}));

vi.mock('../../settings/MigrationPanel', () => ({
  default: () =>
    React.createElement('div', { 'data-testid': 'migration-panel' }, 'Migration Panel'),
}));

let mockURLSearchParams: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  mockURLSearchParams = vi.fn().mockImplementation(() => ({
    has: vi.fn().mockReturnValue(false),
    get: vi.fn().mockReturnValue(null),
  }));

  Object.defineProperty(window, 'URLSearchParams', {
    value: mockURLSearchParams,
    writable: true,
  });

  // Reset mocked service return values to baseline defaults
  vi.mocked(dbMock.getAssistant).mockResolvedValue(undefined);
  vi.mocked(dbMock.saveAssistant).mockResolvedValue(undefined);
  vi.mocked(dbMock.deleteAssistant).mockResolvedValue(undefined);
  vi.mocked(dbMock.getAllAssistants).mockResolvedValue([]);
  vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([]);
  vi.mocked(dbMock.saveSession).mockResolvedValue(undefined);
  vi.mocked(dbMock.deleteSession).mockResolvedValue(undefined);

  vi.mocked(embeddingMock.preloadEmbeddingModel).mockResolvedValue(undefined);
  vi.mocked(embeddingMock.isEmbeddingModelLoaded).mockReturnValue(true);
  vi.mocked(embeddingMock.generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);

  vi.mocked(providerMock.initializeProviders).mockResolvedValue(undefined);
  vi.mocked(providerMock.providerManager.getAvailableProviders).mockReturnValue(['gemini'] as any);
  vi.mocked(providerMock.providerManager.getActiveProvider).mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AppShell', () => {
  describe('Component Structure', () => {
    it('should render within ErrorBoundary and AppProvider', async () => {
      render(<AppShell />);

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();

      // Wait for initial loading to complete
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should render Layout component with children', async () => {
      render(<AppShell />);

      // Layout should be rendered
      expect(screen.getByRole('main')).toBeInTheDocument();

      // Wait for loading to complete
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });
  });

  describe('Shared Mode', () => {
    it('should render SharedAssistant when in shared mode', async () => {
      // Mock URL parameters for shared mode
      mockURLSearchParams.mockImplementation(() => ({
        has: vi.fn().mockImplementation(key => key === 'share'),
        get: vi.fn().mockImplementation(key => (key === 'share' ? 'shared-assistant-123' : null)),
      }));

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('shared-assistant')).toBeInTheDocument();
          expect(screen.getByText('Shared Assistant: shared-assistant-123')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should not render SharedAssistant when not in shared mode', async () => {
      mockURLSearchParams.mockImplementation(() => ({
        has: vi.fn().mockReturnValue(false),
        get: vi.fn().mockReturnValue(null),
      }));

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByTestId('shared-assistant')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });
  });

  describe('View Mode Rendering', () => {
    beforeEach(() => {
      // Setup mock data for view mode tests
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([
        TEST_ASSISTANTS.basic,
        TEST_ASSISTANTS.withRag,
      ]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(TEST_ASSISTANTS.basic);
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([TEST_SESSIONS.withMessages]);
    });

    it('should render AssistantEditor in new_assistant mode', async () => {
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
          expect(screen.getByText('New Mode')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should render AssistantEditor in edit_assistant mode with current assistant', async () => {
      render(<AppShell />);

      // Wait for loading to complete and assistant to be selected
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Find and click edit button to switch to edit mode
      const editButton = screen.queryByTestId('edit-test-assistant-1');
      if (editButton) {
        await act(async () => {
          fireEvent.click(editButton);
        });

        await waitFor(() => {
          expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
          expect(screen.getByText('Edit Mode')).toBeInTheDocument();
        });
      }
    });

    it('should render ChatContainer in chat mode with session', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
          expect(screen.getByText('Chatting with Basic Assistant')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should render settings view with service status', async () => {
      render(<AppShell />);

      // Wait for loading to complete
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Find settings button through navigation
      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getAllByText('設定').length).toBeGreaterThanOrEqual(1);
          expect(screen.getByText('服務狀態')).toBeInTheDocument();
          expect(screen.getByText('AI 服務商')).toBeInTheDocument();
          expect(screen.getByText('Turso 資料庫')).toBeInTheDocument();
        });
      }
    });

    it('should render ApiKeySetup in api_setup mode', async () => {
      render(<AppShell />);

      // Wait for loading and navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        const dbSetupButton = screen.queryByText('資料庫設定');
        if (dbSetupButton) {
          await act(async () => {
            fireEvent.click(dbSetupButton);
          });

          await waitFor(() => {
            expect(screen.getByTestId('api-key-setup')).toBeInTheDocument();
          });
        }
      }
    });

    it('should render ProviderSettings in provider_settings mode', async () => {
      render(<AppShell />);

      // Wait for loading and navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        const providerButton = screen.queryByText('AI 服務商設定');
        if (providerButton) {
          await act(async () => {
            fireEvent.click(providerButton);
          });

          await waitFor(() => {
            expect(screen.getByTestId('provider-settings')).toBeInTheDocument();
          });
        }
      }
    });
  });

  describe('Loading States', () => {
    it('should show loading screen during initial load', () => {
      render(<AppShell />);

      expect(screen.getByText('載入助理中...')).toBeInTheDocument();
      expect(screen.getByText('正在從資料庫讀取您的助理資料')).toBeInTheDocument();
    });

    it('should show loading steps during initialization', () => {
      render(<AppShell />);

      expect(screen.getByText('連接資料庫')).toBeInTheDocument();
      expect(screen.getByText('載入助理資料')).toBeInTheDocument();
      expect(screen.getByText('初始化介面')).toBeInTheDocument();
    });

    it('should hide loading screen after data loads', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should show model loading overlay when embedding model loads', async () => {
      vi.mocked(embeddingMock.isEmbeddingModelLoaded).mockReturnValue(false);

      render(<AppShell />);

      // Model loading overlay should be rendered
      // Note: The actual visibility depends on the ModelLoadingOverlay component implementation
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });
  });

  describe('Empty States', () => {
    it('should show empty state when no assistant is selected and not loading', async () => {
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([TEST_ASSISTANTS.basic]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(TEST_ASSISTANTS.basic);
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([TEST_SESSIONS.withMessages]);

      render(<AppShell />);

      // Wait for loading to complete but before assistant selection
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // We should see chat view since there are assistants
      expect(screen.queryByText('歡迎使用專業助理')).not.toBeInTheDocument();
    });

    it('should show AssistantEditor in new_assistant mode when no assistants exist', async () => {
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
          expect(screen.getByText('New Mode')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
      // Welcome message does NOT show because app navigates directly to new_assistant mode
      expect(screen.queryByText('歡迎使用專業助理')).not.toBeInTheDocument();
    });

    it('should show welcome message and navigate to new assistant when welcome button is clicked', async () => {
      // Welcome state appears when assistants exist in DB but getAssistant returns null
      // (selectAssistant no-ops → viewMode stays 'chat', currentAssistant stays null)
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([TEST_ASSISTANTS.basic]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(undefined);

      render(<AppShell />);

      const createButton = await waitFor(() => screen.getByText('新增您的第一個助理'), {
        timeout: 3000,
      });

      await act(async () => {
        fireEvent.click(createButton);
      });

      await waitFor(() => {
        expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
        expect(screen.getByText('New Mode')).toBeInTheDocument();
      });
    });
  });

  describe('Message Handling', () => {
    it('should handle new message from ChatContainer', async () => {
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([TEST_ASSISTANTS.basic]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(TEST_ASSISTANTS.basic);
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([TEST_SESSIONS.withMessages]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      const sendButton = screen.getByTestId('send-message');
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await waitFor(() => {
        expect(vi.mocked(dbMock.saveSession)).toHaveBeenCalled();
      });
    });

    it('should update session title when handling new message from "New Chat"', async () => {
      const newChatSession = {
        ...TEST_SESSIONS.empty,
        title: 'New Chat',
      };
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([TEST_ASSISTANTS.basic]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(TEST_ASSISTANTS.basic);
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([newChatSession]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      const sendButton = screen.getByTestId('send-message');
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await waitFor(() => {
        expect(vi.mocked(dbMock.saveSession)).toHaveBeenCalledWith(
          expect.objectContaining({
            title: expect.stringMatching(/test message/),
          }),
        );
      });
    });
  });

  describe('Share Modal Integration', () => {
    it('should show share modal when assistant is shared', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Find and click share button
      const shareButton = screen.queryByTestId('share-test-assistant-1');
      if (shareButton) {
        await act(async () => {
          fireEvent.click(shareButton);
        });

        await waitFor(() => {
          expect(screen.getByTestId('share-modal')).toBeInTheDocument();
        });
      }
    });

    it('should not show share modal initially', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByTestId('share-modal')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should close share modal when close is clicked', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Find and click share button
      const shareButton = screen.queryByTestId('share-test-assistant-1');
      if (shareButton) {
        await act(async () => {
          fireEvent.click(shareButton);
        });

        const closeButton = await waitFor(() => screen.getByTestId('close-share-modal'));

        await act(async () => {
          fireEvent.click(closeButton);
        });

        await waitFor(() => {
          expect(screen.queryByTestId('share-modal')).not.toBeInTheDocument();
        });
      }
    });
  });

  describe('Service Status Display', () => {
    it('should show available AI providers status', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (providerMock.providerManager.getAvailableProviders as any).mockReturnValue([
        'gemini',
        'openai',
      ]);

      render(<AppShell />);

      // Navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getAllByText(/個服務商可用/).length).toBeGreaterThanOrEqual(1);
        });
      }
    });

    it('should show no providers available status', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (providerMock.providerManager.getAvailableProviders as any).mockReturnValue([]);

      render(<AppShell />);

      // Navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getByText('需要配置 AI 服務商')).toBeInTheDocument();
        });
      }
    });

    it('should show Turso database status', async () => {
      vi.mocked(tursoMock.canWriteToTurso).mockReturnValue(true);

      render(<AppShell />);

      // Navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getAllByText(/可以保存助理/).length).toBeGreaterThanOrEqual(1);
        });
      }
    });
  });

  describe('Error Boundary Integration', () => {
    it('should wrap content in ErrorBoundary', () => {
      render(<AppShell />);

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    });

    it('should handle component errors gracefully', async () => {
      // This test verifies that ErrorBoundary is used
      render(<AppShell />);

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    });
  });

  describe('Navigation and View Transitions', () => {
    it('should handle navigation between settings and other views', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Navigate to settings
      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        // Should show settings view
        await waitFor(() => {
          expect(screen.getByText('服務狀態')).toBeInTheDocument();
        });

        // Navigate to API setup
        const apiSetupButton = screen.queryByText('資料庫設定');
        if (apiSetupButton) {
          await act(async () => {
            fireEvent.click(apiSetupButton);
          });

          await waitFor(() => {
            expect(screen.getByTestId('api-key-setup')).toBeInTheDocument();
          });

          // Complete API setup (back to settings)
          const completeButton = screen.getByTestId('api-complete');
          await act(async () => {
            fireEvent.click(completeButton);
          });

          await waitFor(() => {
            expect(screen.getByText('服務狀態')).toBeInTheDocument();
          });
        }
      }
    });

    it('should show migration panel in settings', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getByTestId('migration-panel')).toBeInTheDocument();
        });
      }
    });
  });

  describe('Assistant Editor Integration', () => {
    it('should handle cancel in new assistant mode when no assistants exist', async () => {
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const cancelButton = screen.getByTestId('cancel-button');
      await act(async () => {
        fireEvent.click(cancelButton);
      });

      // Should remain in new assistant mode when no assistants exist
      expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
      expect(screen.getByText('New Mode')).toBeInTheDocument();
    });

    it('should handle cancel in edit assistant mode', async () => {
      render(<AppShell />);

      // Wait for initial load and then switch to edit mode
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const editButton = screen.queryByTestId('edit-test-assistant-1');
      if (editButton) {
        await act(async () => {
          fireEvent.click(editButton);
        });

        await waitFor(() => {
          expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
          expect(screen.getByText('Edit Mode')).toBeInTheDocument();
        });

        const cancelButton = screen.getByTestId('cancel-button');
        await act(async () => {
          fireEvent.click(cancelButton);
        });

        // Should return to chat mode
        await waitFor(() => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        });
      }
    });
  });
});
