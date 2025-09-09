import { ChatMessage, ChatSession, RagChunk } from '../../types';

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
  currentSession: ChatSession;
  disabled?: boolean;
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
    tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
  ) => Promise<void>;
  hideHeader?: boolean;
  sharedMode?: boolean;
  assistantDescription?: string;
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
