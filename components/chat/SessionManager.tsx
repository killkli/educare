import { useState, useEffect, useRef } from 'react';
import { ChatTokenInfo, SessionManagerProps } from './types';
import { RagChunk } from '../../types';
import { streamChat } from '../../services/llmService';
import { applyTokenUsageToSession } from '../../services/sessionTokenUsage';

const useSessionManager = ({ session, onSessionUpdate }: SessionManagerProps) => {
  const [currentSession, setCurrentSession] = useState(session);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    setCurrentSession(session);
  }, [session]);

  useEffect(() => {
    scrollToBottom();
  }, [currentSession.messages]);

  const handleSendMessage = async (
    userMessage: string,
    systemPrompt: string,
    assistantId: string,
    ragChunks: RagChunk[],
    setStatusText: (text: string) => void,
    setIsThinking: (thinking: boolean) => void,
    onStreamingChunk: (chunk: string) => void,
    onComplete: (tokenInfo: ChatTokenInfo, fullResponse: string) => void,
    onError: (error: Error) => void,
  ) => {
    const newUserMessage = { role: 'user' as const, content: userMessage };
    const updatedSession = {
      ...currentSession,
      messages: [...currentSession.messages, newUserMessage],
    };
    setCurrentSession(updatedSession);
    onSessionUpdate(updatedSession);

    try {
      setIsThinking(true);
      setStatusText(ragChunks.length > 0 ? '🔎 搜尋知識庫中...' : '🤖 生成回答...');

      await streamChat({
        systemPrompt,
        history: currentSession.messages,
        message: userMessage,
        assistantId,
        sessionId: currentSession.id,
        activeProjectId: currentSession.activeProjectId ?? null,
        knowledgeChunks: ragChunks,
        onChunk: chunk => {
          setIsThinking(false);
          onStreamingChunk(chunk);
        },
        onComplete: (tokenInfo, fullModelResponse) => {
          setIsThinking(false);
          setStatusText('');

          const newAiMessage = { role: 'model' as const, content: fullModelResponse };
          const finalSession = applyTokenUsageToSession(
            {
              ...updatedSession,
              messages: [...updatedSession.messages, newAiMessage],
            },
            tokenInfo,
          );

          setCurrentSession(finalSession);
          onSessionUpdate(finalSession);
          onComplete(tokenInfo, fullModelResponse);
        },
      });
    } catch (error) {
      console.error('Error during chat stream:', error);
      setIsThinking(false);
      setStatusText('');
      onError(error as Error);
    }
  };

  return {
    currentSession,
    handleSendMessage,
    messagesEndRef,
  };
};

export default useSessionManager;
