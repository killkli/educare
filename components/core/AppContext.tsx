import React, { useReducer, useCallback, useEffect } from 'react';
import { Assistant, ChatSession } from '../../types';
import { ProviderType } from '../../services/llmAdapter';
import * as db from '../../services/db';
import { preloadEmbeddingModel, isEmbeddingModelLoaded } from '../../services/embeddingService';
import { initializeProviders, providerManager } from '../../services/providerRegistry';
import { CryptoService } from '../../services/cryptoService';
import { ApiKeyManager } from '../../services/apiKeyManager';
import { getAssistantFromTurso } from '../../services/tursoService';
import { AppContext } from './useAppContext';
import type {
  ViewMode,
  ModelLoadingProgress,
  AppState,
  AppAction,
  AppContextValue,
} from './AppContext.types';

const initialState: AppState = {
  assistants: [],
  currentAssistant: null,
  sessions: [],
  currentSession: null,
  viewMode: 'chat',
  isLoading: true,
  error: null,
  isShared: false,
  sharedAssistantId: null,
  isSidebarOpen: true,
  isMobile: false,
  isTablet: false,
  isModelLoading: false,
  modelLoadingProgress: null,
  isShareModalOpen: false,
  assistantToShare: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ACTIVE_PROVIDER':
      return { ...state };
    case 'SET_ASSISTANTS':
      return { ...state, assistants: action.payload };
    case 'SET_CURRENT_ASSISTANT':
      return { ...state, currentAssistant: action.payload };
    case 'SET_SESSIONS':
      return { ...state, sessions: action.payload };
    case 'SET_CURRENT_SESSION':
      return { ...state, currentSession: action.payload };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_SHARED_MODE':
      return {
        ...state,
        isShared: action.payload.isShared,
        sharedAssistantId: action.payload.assistantId,
      };
    case 'SET_SIDEBAR_OPEN':
      return { ...state, isSidebarOpen: action.payload };
    case 'SET_SCREEN_SIZE':
      return {
        ...state,
        isMobile: action.payload.isMobile,
        isTablet: action.payload.isTablet,
      };
    case 'SET_MODEL_LOADING':
      return {
        ...state,
        isModelLoading: action.payload.isLoading,
        modelLoadingProgress: action.payload.progress || null,
      };
    case 'SET_SHARE_MODAL':
      return {
        ...state,
        isShareModalOpen: action.payload.isOpen,
        assistantToShare: action.payload.assistant || null,
      };
    case 'ADD_SESSION':
      return {
        ...state,
        sessions: [action.payload, ...state.sessions],
        currentSession: action.payload,
      };
    case 'UPDATE_SESSION':
      return {
        ...state,
        sessions: state.sessions.map(s => (s.id === action.payload.id ? action.payload : s)),
        currentSession:
          state.currentSession?.id === action.payload.id ? action.payload : state.currentSession,
      };
    case 'DELETE_SESSION': {
      const remainingSessions = state.sessions.filter(s => s.id !== action.payload);
      return {
        ...state,
        sessions: remainingSessions,
        currentSession:
          state.currentSession?.id === action.payload
            ? remainingSessions.length > 0
              ? remainingSessions[0]
              : null
            : state.currentSession,
      };
    }
    case 'DELETE_ASSISTANT': {
      const remainingAssistants = state.assistants.filter(a => a.id !== action.payload);
      return {
        ...state,
        assistants: remainingAssistants,
        currentAssistant:
          state.currentAssistant?.id === action.payload ? null : state.currentAssistant,
        sessions: state.currentAssistant?.id === action.payload ? [] : state.sessions,
        currentSession: state.currentAssistant?.id === action.payload ? null : state.currentSession,
      };
    }
    default:
      return state;
  }
}

interface AppProviderProps {
  children: React.ReactNode;
}

export function AppProvider({ children }: AppProviderProps): React.JSX.Element {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Create new session
  const createNewSession = useCallback(async (assistantId: string) => {
    const newSession: ChatSession = {
      id: `session-${Date.now()}`,
      assistantId,
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
      tokenCount: 0,
    };
    await db.saveSession(newSession);
    dispatch({ type: 'ADD_SESSION', payload: newSession });
  }, []);

  // Select an assistant
  const selectAssistant = useCallback(
    async (assistantId: string, changeView = true) => {
      const assistant = await db.getAssistant(assistantId);
      if (assistant) {
        dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: { ...assistant } });
        const assistantSessions = await db.getSessionsForAssistant(assistant.id);
        const sortedSessions = assistantSessions.sort((a, b) => b.createdAt - a.createdAt);
        dispatch({ type: 'SET_SESSIONS', payload: sortedSessions });

        if (sortedSessions.length > 0) {
          dispatch({ type: 'SET_CURRENT_SESSION', payload: sortedSessions[0] });
        } else {
          await createNewSession(assistant.id);
        }

        if (changeView) {
          dispatch({ type: 'SET_VIEW_MODE', payload: 'chat' });
        }
      }
    },
    [createNewSession],
  );

  // Load data from database
  const loadData = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const storedAssistants = await db.getAllAssistants();
      dispatch({
        type: 'SET_ASSISTANTS',
        payload: storedAssistants.sort((a, b) => b.createdAt - a.createdAt),
      });

      // Initialize providers asynchronously
      initializeProviders().catch(error => {
        console.error('❌ Failed to initialize providers:', error);
      });

      // Preload embedding model if not loaded
      if (!isEmbeddingModelLoaded()) {
        dispatch({ type: 'SET_MODEL_LOADING', payload: { isLoading: true } });
        try {
          await preloadEmbeddingModel(progress => {
            dispatch({
              type: 'SET_MODEL_LOADING',
              payload: { isLoading: true, progress: progress as ModelLoadingProgress },
            });
          });
          console.log('✅ Embedding model preloaded successfully');
        } catch (error) {
          console.error('❌ Failed to preload embedding model:', error);
        } finally {
          dispatch({ type: 'SET_MODEL_LOADING', payload: { isLoading: false, progress: null } });
        }
      }

      if (storedAssistants.length > 0) {
        await selectAssistant(storedAssistants[0].id);
      } else {
        dispatch({ type: 'SET_VIEW_MODE', payload: 'new_assistant' });
      }
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: '無法從資料庫載入資料。' });
      console.error(e);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [selectAssistant]);

  const loadSharedAssistant = useCallback(
    async (assistantId: string) => {
      // Initialize providers first to establish a baseline
      await initializeProviders();

      dispatch({ type: 'SET_LOADING', payload: true });
      try {
        const assistant = await getAssistantFromTurso(assistantId);
        if (assistant) {
          await db.saveAssistant(assistant);
          dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: { ...assistant } });
          dispatch({
            type: 'SET_ASSISTANTS',
            payload: [assistant],
          });
          const assistantSessions = await db.getSessionsForAssistant(assistant.id);
          const sortedSessions = assistantSessions.sort((a, b) => b.createdAt - a.createdAt);
          dispatch({ type: 'SET_SESSIONS', payload: sortedSessions });

          if (sortedSessions.length > 0) {
            dispatch({ type: 'SET_CURRENT_SESSION', payload: sortedSessions[0] });
          } else {
            await createNewSession(assistant.id);
          }

          dispatch({ type: 'SET_VIEW_MODE', payload: 'chat' });

          const params = new URLSearchParams(window.location.search);
          const keys = params.get('keys');
          if (keys) {
            const password = window.prompt('此助理包含已加密的 API 金鑰。請輸入密碼以解密：', '');
            if (password) {
              try {
                const decryptedApiKeys = await CryptoService.decryptApiKeys(keys, password);
                ApiKeyManager.setUserApiKeys(decryptedApiKeys);

                if (decryptedApiKeys.provider) {
                  const providerType = decryptedApiKeys.provider as ProviderType;

                  // 1. Configure provider with specific keys if available
                  const config: { apiKey?: string; baseUrl?: string; model?: string } = {};
                  const keyName = `${providerType}ApiKey` as keyof typeof decryptedApiKeys;
                  const baseUrlName = `${providerType}BaseUrl` as keyof typeof decryptedApiKeys;
                  const apiKey = decryptedApiKeys[keyName];
                  const baseUrl = decryptedApiKeys[baseUrlName];
                  const model = decryptedApiKeys.model;

                  if (apiKey) {
                    config.apiKey = apiKey as string;
                  } else if (baseUrl) {
                    config.baseUrl = baseUrl as string;
                  }

                  // Include model if provided
                  if (model) {
                    config.model = model as string;
                  }

                  if (Object.keys(config).length > 0) {
                    providerManager.updateProviderConfig(providerType, config);
                    providerManager.enableProvider(providerType, true);
                  }

                  // 2. Set the active provider to persist choice
                  providerManager.setActiveProvider(providerType);

                  // 3. Ensure the provider is properly initialized with the new config
                  const provider = providerManager.getProvider(providerType);
                  if (provider) {
                    try {
                      await provider.initialize(config);
                      console.log(
                        `✅ ${providerType} provider initialized successfully with shared keys`,
                      );
                    } catch (error) {
                      console.warn(`⚠️ Failed to initialize ${providerType} provider:`, error);
                    }
                  }

                  // 4. Dispatch an action to notify UI components of the change
                  dispatch({ type: 'SET_ACTIVE_PROVIDER', payload: providerType });

                  // 5. Notify user of success
                  alert(`API 金鑰與 ${providerType} 提供者已成功匯入並啟用！`);
                  const newParams = new URLSearchParams(window.location.search);
                  newParams.delete('keys');
                  window.history.replaceState(
                    {},
                    '',
                    `${window.location.pathname}?${newParams.toString()}`,
                  );
                }
              } catch (error) {
                alert('密碼錯誤或金鑰損毀，無法解密 API 金鑰。');
                console.error('解密失敗:', error);
              }
            }
          }
        } else {
          dispatch({ type: 'SET_ERROR', payload: '找不到分享的助理。' });
        }
      } catch (e) {
        dispatch({ type: 'SET_ERROR', payload: '載入分享的助理時發生錯誤。' });
        console.error(e);
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    },
    [createNewSession],
  );

  // Save assistant
  const saveAssistant = useCallback(
    async (assistant: Assistant) => {
      await db.saveAssistant(assistant);
      const storedAssistants = await db.getAllAssistants();
      dispatch({
        type: 'SET_ASSISTANTS',
        payload: storedAssistants.sort((a, b) => b.createdAt - a.createdAt),
      });

      // If we are creating a new assistant, select it and switch to chat.
      if (state.viewMode === 'new_assistant') {
        await selectAssistant(assistant.id);
      } else {
        // If we are editing, just update the current assistant's data
        // and stay in the current view mode (e.g., 'edit_assistant').
        dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: { ...assistant } });
      }
    },
    [selectAssistant, state.viewMode],
  );

  // Delete assistant
  const deleteAssistant = useCallback(
    async (assistantId: string) => {
      if (window.confirm('確定要刪除此助理和所有聊天記錄嗎？')) {
        await db.deleteAssistant(assistantId);
        dispatch({ type: 'DELETE_ASSISTANT', payload: assistantId });

        const remainingAssistants = state.assistants.filter(a => a.id !== assistantId);
        if (remainingAssistants.length > 0) {
          await selectAssistant(remainingAssistants[0].id);
        } else {
          dispatch({ type: 'SET_VIEW_MODE', payload: 'new_assistant' });
        }
      }
    },
    [state.assistants, selectAssistant],
  );

  // Delete session
  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!state.currentAssistant) {
        return;
      }

      if (window.confirm('確定要刪除此聊天會話嗎？')) {
        await db.deleteSession(sessionId);
        const assistantSessions = await db.getSessionsForAssistant(state.currentAssistant.id);
        const sortedSessions = assistantSessions.sort((a, b) => b.createdAt - a.createdAt);
        dispatch({ type: 'SET_SESSIONS', payload: sortedSessions });

        if (state.currentSession?.id === sessionId) {
          if (sortedSessions.length > 0) {
            dispatch({ type: 'SET_CURRENT_SESSION', payload: sortedSessions[0] });
          } else {
            await createNewSession(state.currentAssistant.id);
          }
        }
      }
    },
    [state.currentAssistant, state.currentSession, createNewSession],
  );

  // Update session
  const updateSession = useCallback(async (session: ChatSession) => {
    await db.saveSession(session);
    dispatch({ type: 'UPDATE_SESSION', payload: session });
  }, []);

  // Set view mode
  const setViewMode = useCallback((mode: ViewMode) => {
    dispatch({ type: 'SET_VIEW_MODE', payload: mode });
  }, []);

  // Toggle sidebar
  const toggleSidebar = useCallback(() => {
    dispatch({ type: 'SET_SIDEBAR_OPEN', payload: !state.isSidebarOpen });
  }, [state.isSidebarOpen]);

  // Open share modal
  const openShareModal = useCallback((assistant: Assistant) => {
    dispatch({ type: 'SET_SHARE_MODAL', payload: { isOpen: true, assistant } });
  }, []);

  // Close share modal
  const closeShareModal = useCallback(() => {
    dispatch({ type: 'SET_SHARE_MODAL', payload: { isOpen: false, assistant: null } });
  }, []);

  // Check screen size
  const checkScreenSize = useCallback(() => {
    const mobile = window.innerWidth < 768;
    const tablet = window.innerWidth >= 768 && window.innerWidth < 1024;
    dispatch({ type: 'SET_SCREEN_SIZE', payload: { isMobile: mobile, isTablet: tablet } });

    if (mobile || tablet) {
      dispatch({ type: 'SET_SIDEBAR_OPEN', payload: false });
    } else {
      dispatch({ type: 'SET_SIDEBAR_OPEN', payload: true });
    }
  }, []);

  // Check for shared mode and screen size on mount
  useEffect(() => {
    // Check for ?share=ID format
    const params = new URLSearchParams(window.location.search);
    const shared = params.has('share');
    const assistantId = params.get('share');

    dispatch({ type: 'SET_SHARED_MODE', payload: { isShared: shared, assistantId } });

    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, [checkScreenSize]);

  // Load data if not in shared mode
  useEffect(() => {
    if (!state.isShared) {
      loadData();
    } else if (state.sharedAssistantId) {
      loadSharedAssistant(state.sharedAssistantId);
    }
  }, [loadData, state.isShared, loadSharedAssistant, state.sharedAssistantId]);

  const contextValue: AppContextValue = {
    state,
    dispatch,
    actions: {
      loadData,
      selectAssistant,
      saveAssistant,
      deleteAssistant,
      createNewSession,
      deleteSession,
      updateSession,
      setViewMode,
      toggleSidebar,
      openShareModal,
      closeShareModal,
      checkScreenSize,
      loadSharedAssistant,
    },
  };

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

export default AppProvider;
