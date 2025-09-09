import React from 'react';
import { Assistant, ChatSession } from '../../types';

export type ViewMode =
  | 'chat'
  | 'new_assistant'
  | 'edit_assistant'
  | 'settings'
  | 'api_setup'
  | 'provider_settings';

export interface ModelLoadingProgress {
  status: string;
  progress: number;
  name?: string;
}

export interface AppState {
  assistants: Assistant[];
  currentAssistant: Assistant | null;
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  viewMode: ViewMode;
  isLoading: boolean;
  error: string | null;
  isShared: boolean;
  sharedAssistantId: string | null;
  isSidebarOpen: boolean;
  isMobile: boolean;
  isTablet: boolean;
  isModelLoading: boolean;
  modelLoadingProgress: ModelLoadingProgress | null;
  isShareModalOpen: boolean;
  assistantToShare: Assistant | null;
}

export type AppAction =
  | { type: 'SET_ASSISTANTS'; payload: Assistant[] }
  | { type: 'SET_CURRENT_ASSISTANT'; payload: Assistant | null }
  | { type: 'SET_SESSIONS'; payload: ChatSession[] }
  | { type: 'SET_CURRENT_SESSION'; payload: ChatSession | null }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_SHARED_MODE'; payload: { isShared: boolean; assistantId: string | null } }
  | { type: 'SET_SIDEBAR_OPEN'; payload: boolean }
  | { type: 'SET_SCREEN_SIZE'; payload: { isMobile: boolean; isTablet: boolean } }
  | {
      type: 'SET_MODEL_LOADING';
      payload: { isLoading: boolean; progress?: ModelLoadingProgress | null };
    }
  | { type: 'SET_SHARE_MODAL'; payload: { isOpen: boolean; assistant?: Assistant | null } }
  | { type: 'ADD_SESSION'; payload: ChatSession }
  | { type: 'UPDATE_SESSION'; payload: ChatSession }
  | { type: 'DELETE_SESSION'; payload: string }
  | { type: 'DELETE_ASSISTANT'; payload: string };

export interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  actions: {
    loadData: () => Promise<void>;
    selectAssistant: (assistantId: string) => Promise<void>;
    saveAssistant: (assistant: Assistant) => Promise<void>;
    deleteAssistant: (assistantId: string) => Promise<void>;
    createNewSession: (assistantId: string) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
    updateSession: (session: ChatSession) => Promise<void>;
    setViewMode: (mode: ViewMode) => void;
    toggleSidebar: () => void;
    openShareModal: (assistant: Assistant) => void;
    closeShareModal: () => void;
    checkScreenSize: () => void;
  };
}
