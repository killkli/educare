import type { ReactNode } from 'react';
import { ChatMessage, ChatSession, RagChunk } from '../../types';
import type { ProviderUsageMetadata } from '../../services/llmAdapter';

export interface ChatTokenInfo {
  promptTokenCount: number;
  candidatesTokenCount: number;
  usage?: ProviderUsageMetadata;
  provider?: string;
  model?: string;
}

export interface MessageBubbleProps {
  message: ChatMessage;
  index: number;
  assistantName?: string;
}

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isLoading: boolean;
  statusText: string;
  disabled?: boolean;
  isWorkspaceOpen?: boolean;
}

export interface SessionManagerProps {
  session: ChatSession;
  onSessionUpdate: (session: ChatSession) => void;
}

export interface ChatContainerProps {
  session: ChatSession;
  assistantName: string;
  systemPrompt: string;
  assistantId: string;
  ragChunks: RagChunk[]; // Keep as any[] for now to maintain compatibility
  onNewMessage: (
    session: ChatSession,
    userMessage: string,
    modelResponse: string,
    tokenInfo: ChatTokenInfo,
  ) => Promise<void>;
  hideHeader?: boolean;
  sharedMode?: boolean;
  assistantDescription?: string;
  isWorkspaceOpen?: boolean;
  headerActions?: ReactNode;
}

export interface WelcomeMessageProps {
  assistantName: string;
  assistantDescription?: string;
  sharedMode?: boolean;
}

export interface ThinkingIndicatorProps {
  assistantName?: string;
}

export interface StreamingResponseProps {
  content: string;
  assistantName?: string;
}
