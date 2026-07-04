import React, { useState, useEffect, useRef, useContext } from 'react';
import { ChatContainerProps } from './types';
import { AppContext } from '../core/useAppContext';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import WelcomeMessage from './WelcomeMessage';
import ThinkingIndicator from './ThinkingIndicator';
import StreamingResponse from './StreamingResponse';
import { AgentRunController } from '../../services/agentRunController';
import type { AgentRunState } from '../../types';
import { ChatMessage, HtmlProjectWorkspaceUpdate } from '../../types';
import { applyTokenUsageToSession } from '../../services/sessionTokenUsage';

const ChatContainer: React.FC<ChatContainerProps> = ({
  session,
  assistantName,
  systemPrompt,
  assistantId,
  ragChunks,
  onNewMessage,
  hideHeader = false,
  sharedMode = false,
  assistantDescription,
  isWorkspaceOpen = false,
  headerActions,
  agentHarnessEnabled = true,
}) => {
  const actions = useContext(AppContext)?.actions ?? null;
  const [input, setInput] = useState('');
  const [streamingResponse, setStreamingResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [currentSession, setCurrentSession] = useState(session);
  const [runState, setRunState] = useState<AgentRunState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(session);
  const controllerRef = useRef<AgentRunController | null>(null);
  const isThinkingRef = useRef(isThinking);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    setCurrentSession(session);
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    sessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    scrollToBottom();
  }, [currentSession.messages, streamingResponse, isThinking]);

  const handleProjectToolActivity = (update: HtmlProjectWorkspaceUpdate) => {
    const nextProjectId = update.activeProjectId ?? sessionRef.current.activeProjectId ?? null;

    setCurrentSession(prev => {
      const nextSession = {
        ...prev,
        activeProjectId: nextProjectId,
      };
      sessionRef.current = nextSession;
      return nextSession;
    });

    actions?.setActiveProject?.(nextProjectId);
    actions?.setProjectWorkspaceOpen?.(Boolean(nextProjectId));

    if (update.preview) {
      actions?.setProjectPreview?.(update.preview);
    }

    if (update.activityMessage) {
      actions?.appendProjectActivity?.(update.activityMessage);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) {
      return;
    }
    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);
    setIsThinking(true);
    setStreamingResponse('');
    setRunState(null);
    actions?.setAgentRunState?.(null);

    const newUserMessage = { role: 'user' as const, content: userMessage };
    const updatedSession = {
      ...currentSession,
      messages: [...currentSession.messages, newUserMessage],
    };
    sessionRef.current = updatedSession;
    setCurrentSession(updatedSession);

    try {
      setStatusText(ragChunks.length > 0 ? '🔎 搜尋知識庫中...' : '🤖 生成回答...');

      let chatHistory: ChatMessage[];
      let enhancedSystemPrompt = systemPrompt;

      if (currentSession.compactContext) {
        const compactedContextPrompt = `\n\n[PREVIOUS CONVERSATION SUMMARY]\n${currentSession.compactContext.content}\n\nThe above is a summary of our previous conversation. Please refer to this context when responding to continue our conversation naturally.\n\n[CURRENT CONVERSATION]`;

        enhancedSystemPrompt = `${enhancedSystemPrompt}${compactedContextPrompt}`;
        chatHistory = currentSession.messages;

        console.log('📜 [CHAT HISTORY] Using compressed context in system prompt:', {
          compactTokens: currentSession.compactContext.tokenCount,
          compressedRounds: currentSession.compactContext.compressedFromRounds,
          preservedMessages: currentSession.messages.length,
          systemPromptLength: enhancedSystemPrompt.length,
        });
      } else {
        chatHistory = currentSession.messages;
        console.log('📜 [CHAT HISTORY] Using regular history:', {
          messageCount: chatHistory.length,
        });
      }

      // G5/G9: 透過 AgentRunController 統一調度 (单回合 when agentHarnessEnabled=false)
      const controller = new AgentRunController({
        assistantId,
        sessionId: currentSession.id,
        activeProjectId: currentSession.activeProjectId ?? null,
        systemPrompt: enhancedSystemPrompt,
        history: chatHistory,
        message: userMessage,
        knowledgeChunks: ragChunks,
        agentHarnessEnabled,
        sharedMode,
        callbacks: {
          onChunk: chunk => {
            if (isThinkingRef.current) {
              setIsThinking(false);
            }
            setStreamingResponse(prev => prev + chunk);
          },
          onProjectToolActivity: handleProjectToolActivity,
          onStateChange: nextState => {
            setRunState(nextState);
            actions?.setAgentRunState?.(nextState);
          },
          onError: error => {
            console.error('AgentRunController error:', error);
          },
        },
      });
      controllerRef.current = controller;

      const result = await controller.run();
      controllerRef.current = null;

      // Capture final state (in case the controller didn't emit a terminal onStateChange).
      setRunState(result.state);
      actions?.setAgentRunState?.(result.state);

      const tokenInfo = result.tokenInfo;
      const fullModelResponse = result.fullText;

      setIsLoading(false);
      setIsThinking(false);
      setStatusText('');

      const baseSession = sessionRef.current;
      const newAiMessage = { role: 'model' as const, content: fullModelResponse };
      const finalSession = applyTokenUsageToSession(
        {
          ...baseSession,
          messages: [...baseSession.messages, newAiMessage],
        },
        tokenInfo,
      );

      sessionRef.current = finalSession;
      setCurrentSession(finalSession);
      setStreamingResponse('');
      onNewMessage(finalSession, userMessage, fullModelResponse, tokenInfo);
    } catch (error) {
      controllerRef.current = null;
      console.error('Error during chat stream:', error);
      setIsLoading(false);
      setIsThinking(false);
      setStatusText('');
      setRunState(null);
      actions?.setAgentRunState?.(null);
      setStreamingResponse(
        `抱歉，發生錯誤。API 返回以下錯誤：\n\n${(error as Error).message}\n\n請檢查您的 API 密鑰和控制檯以取得更多細節。`,
      );
    }
  };

  const handleStop = () => {
    controllerRef.current?.stop('user-stop');
  };

  const isRunning = runState?.status === 'running';

  return (
    <div className='flex flex-col h-full bg-gray-900'>
      {!hideHeader && (
        <div className='p-2 md:p-4 border-b border-gray-700 flex-shrink-0 bg-gray-800'>
          <div className='flex items-center justify-between'>
            <h2 className='text-base md:text-xl font-medium md:font-semibold text-white truncate mr-2'>
              {assistantName}
            </h2>
            <div className='flex items-center space-x-3'>
              {headerActions}
              {sharedMode && (
                <button
                  onClick={async () => {
                    await actions?.createNewSession?.(assistantId);
                    const resetSession = {
                      ...currentSession,
                      messages: [],
                      tokenCount: 0,
                      tokenUsage: undefined,
                      activeProjectId: null,
                    };
                    setCurrentSession(resetSession);
                    sessionRef.current = resetSession;
                    actions?.clearProjectWorkspace?.();
                    actions?.setAgentRunState?.(null);
                    setRunState(null);
                    setStreamingResponse('');
                    setIsThinking(false);
                    setStatusText('');
                    setInput('');
                  }}
                  className='flex items-center space-x-1 md:space-x-2 px-2 md:px-3 py-1.5 rounded-md transition-colors text-xs md:text-sm font-medium bg-purple-700 hover:bg-purple-600 text-purple-100 hover:text-white'
                  title='開啟新對話'
                >
                  <svg
                    className='w-3 h-3 md:w-4 md:h-4'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M12 4v16m8-8H4'
                    />
                  </svg>
                  <span className='hidden sm:inline'>新對話</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <main className='flex-1 overflow-y-auto chat-scroll' role='main' aria-label='聊天對話'>
        <div
          className={`${isWorkspaceOpen ? 'mx-auto max-w-4xl' : 'max-w-none'} px-3 py-4 md:px-4 md:py-6`}
        >
          {currentSession.messages.length === 0 && !streamingResponse && !isThinking && (
            <WelcomeMessage
              assistantName={assistantName}
              assistantDescription={assistantDescription}
              sharedMode={sharedMode}
            />
          )}
          <div className='space-y-8'>
            {currentSession.messages.map((msg, index) => (
              <MessageBubble
                key={index}
                message={msg}
                index={index}
                assistantName={assistantName}
              />
            ))}

            {isThinking && !streamingResponse && <ThinkingIndicator />}
            {streamingResponse && <StreamingResponse content={streamingResponse} />}
          </div>
          <div ref={messagesEndRef} />
        </div>
      </main>

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        isLoading={isLoading}
        statusText={statusText}
        disabled={false}
        isWorkspaceOpen={isWorkspaceOpen}
        isRunning={isRunning}
        onStop={handleStop}
      />
    </div>
  );
};

export default ChatContainer;
