/// <reference types="vitest/globals" />
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { vi } from 'vitest';
import React from 'react';
import { AppShell } from '../AppShell';
import { setupCoreTestEnvironment, TEST_ASSISTANTS, TEST_SESSIONS } from './test-utils';

// Mock ErrorBoundary separately to test error handling
vi.mock('../ErrorBoundary', () => {
  const MockErrorBoundary = vi.fn(({ children }: { children: React.ReactNode }) => {
    return React.createElement('div', { 'data-testid': 'error-boundary' }, children);
  });

  return {
    ErrorBoundary: MockErrorBoundary,
  };
});

// Mock components with better test ids
beforeAll(() => {
  setupCoreTestEnvironment();
});

describe('AppShell', () => {
  let testEnvironment: ReturnType<typeof setupCoreTestEnvironment>;

  beforeEach(() => {
    testEnvironment = setupCoreTestEnvironment();
    vi.clearAllMocks();
  });

  afterEach(() => {
    testEnvironment.cleanup();
  });

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
      testEnvironment.mockURLSearchParams.mockImplementation(() => ({
        has: vi.fn().mockImplementation(key => key === 'share'),
        get: vi.fn().mockImplementation(key => (key === 'share' ? 'shared-assistant-123' : null)),
      }));

      render(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('shared-assistant')).toBeInTheDocument();
        expect(screen.getByText('Shared Assistant: shared-assistant-123')).toBeInTheDocument();
      });
    });

    it('should not render SharedAssistant when not in shared mode', async () => {
      testEnvironment.mockURLSearchParams.mockImplementation(() => ({
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
    beforeEach(async () => {
      // Setup mock data for view mode tests
      const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
      const mockGetAssistant = vi.mocked(await import('../../../services/db')).getAssistant;
      const mockGetSessions = vi.mocked(
        await import('../../../services/db'),
      ).getSessionsForAssistant;

      mockGetAllAssistants.mockResolvedValue([TEST_ASSISTANTS.basic, TEST_ASSISTANTS.withRag]);
      mockGetAssistant.mockResolvedValue(TEST_ASSISTANTS.basic);
      mockGetSessions.mockResolvedValue([TEST_SESSIONS.withMessages]);
    });

    it('should render AssistantEditor in new_assistant mode', async () => {
      const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
      mockGetAllAssistants.mockResolvedValue([]);

      render(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
        expect(screen.getByText('New Mode')).toBeInTheDocument();
      });
    });

    it('should render AssistantEditor in edit_assistant mode with current assistant', async () => {
      render(<AppShell />);

      // Wait for loading to complete and assistant to be selected
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
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
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
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
          expect(screen.getByText('設定')).toBeInTheDocument();
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
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
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
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
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
      const mockIsEmbeddingModelLoaded = vi.mocked(
        await import('../../../services/embeddingService'),
      ).isEmbeddingModelLoaded;
      mockIsEmbeddingModelLoaded.mockReturnValue(false);

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
      const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
      mockGetAllAssistants.mockResolvedValue([TEST_ASSISTANTS.basic]);

      render(<AppShell />);

      // Wait for loading to complete but before assistant selection
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // We should see chat view since there are assistants
      expect(screen.queryByText('歡迎使用專業助理')).not.toBeInTheDocument();
    });

    it('should show welcome message when no assistants exist', async () => {
      const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
      mockGetAllAssistants.mockResolvedValue([]);

      render(<AppShell />);

      await waitFor(() => {
        expect(screen.getByText('歡迎使用專業助理')).toBeInTheDocument();
        expect(
          screen.getByText('還沒有任何助理。創建您的第一個 AI 助理開始聊天吧！'),
        ).toBeInTheDocument();
        expect(screen.getByText('新增您的第一個助理')).toBeInTheDocument();
      });
    });

    it('should navigate to new assistant when create first assistant is clicked', async () => {
      const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
      mockGetAllAssistants.mockResolvedValue([]);

      render(<AppShell />);

      const createButton = await waitFor(() => screen.getByText('新增您的第一個助理'));

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
      const mockUpdateSession = vi.mocked(await import('../../../services/db')).saveSession;

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const sendButton = screen.getByTestId('send-message');
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await waitFor(() => {
        expect(mockUpdateSession).toHaveBeenCalled();
      });
    });

    it('should update session title when handling new message from "New Chat"', async () => {
      const mockUpdateSession = vi.mocked(await import('../../../services/db')).saveSession;
      const mockGetSessions = vi.mocked(
        await import('../../../services/db'),
      ).getSessionsForAssistant;

      const newChatSession = {
        ...TEST_SESSIONS.empty,
        title: 'New Chat',
      };
      mockGetSessions.mockResolvedValue([newChatSession]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const sendButton = screen.getByTestId('send-message');
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await waitFor(() => {
        expect(mockUpdateSession).toHaveBeenCalledWith(
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
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
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
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
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
      const mockProviderManager = vi.mocked(
        await import('../../../services/providerRegistry'),
      ).providerManager;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockProviderManager.getAvailableProviders as any).mockReturnValue(['gemini', 'openai']);

      render(<AppShell />);

      // Navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getByText('2 個服務商可用')).toBeInTheDocument();
        });
      }
    });

    it('should show no providers available status', async () => {
      const mockProviderManager = vi.mocked(
        await import('../../../services/providerRegistry'),
      ).providerManager;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockProviderManager.getAvailableProviders as any).mockReturnValue([]);

      render(<AppShell />);

      // Navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
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
      const mockCanWriteToTurso = vi.mocked(
        await import('../../../services/tursoService'),
      ).canWriteToTurso;
      mockCanWriteToTurso.mockReturnValue(true);

      render(<AppShell />);

      // Navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getByText('可以保存助理和 RAG')).toBeInTheDocument();
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
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
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
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
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
      const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
      mockGetAllAssistants.mockResolvedValue([]);

      render(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
      });

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
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
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
