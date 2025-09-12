import React, { useState, useEffect, useRef } from 'react';
import { ChatContainerProps } from './types';
import { useAppContext } from '../core/useAppContext';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import WelcomeMessage from './WelcomeMessage';
import ThinkingIndicator from './ThinkingIndicator';
import StreamingResponse from './StreamingResponse';
import { generateEmbedding, cosineSimilarity, rerankChunks } from '../../services/embeddingService';
import { ragCacheManager } from '../../services/ragCacheManager';
import { searchSimilarChunks } from '../../services/tursoService';
import { streamChat } from '../../services/llmService';
import { getRagSettingsService } from '../../services/ragSettingsService';
import { RagSettingsModal } from '../settings';
import { ChatMessage, RagChunk } from '../../types';

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
}) => {
  const { actions } = useAppContext();
  const [input, setInput] = useState('');
  const [streamingResponse, setStreamingResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [currentSession, setCurrentSession] = useState(session);
  const [showRagSettings, setShowRagSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    setCurrentSession(session);
  }, [session]);

  useEffect(() => {
    scrollToBottom();
  }, [currentSession.messages, streamingResponse, isThinking]);

  const findRelevantContext = async (message: string): Promise<string> => {
    try {
      console.log(`🎯 [RAG QUERY] Starting cached context search for query: "${message}"`);
      setStatusText('🔍 檢查查詢緩存...');

      // 取得 RAG 設定
      const ragSettings = getRagSettingsService();
      const vectorSearchLimit = ragSettings.getVectorSearchLimit();
      const enableReranking = ragSettings.isRerankingEnabled();
      const rerankLimit = ragSettings.getRerankLimit();
      const minSimilarity = ragSettings.getMinSimilarity();

      console.log(
        `⚙️ [RAG SETTINGS] Vector search: ${vectorSearchLimit}, Rerank: ${enableReranking ? rerankLimit : 'disabled'}, Min similarity: ${minSimilarity}`,
      );

      // Use cached RAG manager for the query
      const cacheResult = await ragCacheManager.performCachedRagQuery(
        message,
        assistantId,
        ragChunks,
        {
          similarityThreshold: 0.9, // High threshold for cache hits
          rerankLimit,
          enableReranking,
          enableCache: true,
        },
      );

      const { results, fromCache, queryTime, cacheStats } = cacheResult;

      if (fromCache && cacheStats) {
        setStatusText(`✨ 緩存命中！相似度: ${(cacheStats.similarity || 0).toFixed(3)}`);
        console.log(
          `🎯 [CACHE HIT] Query "${message}" matched "${cacheStats.originalQuery}" with similarity ${(cacheStats.similarity || 0).toFixed(4)} in ${queryTime}ms`,
        );
      } else {
        setStatusText(`💾 完整 RAG 查詢完成 (${queryTime}ms)`);
        console.log(`📊 [CACHE MISS] Performed full RAG query in ${queryTime}ms`);
      }

      // Convert results to context string
      if (results.length === 0) {
        console.log('❌ [RAG QUERY] No relevant context found');
        return '';
      }

      const contextString = results
        .map(chunk => `From ${chunk.fileName}:\n${chunk.content}`)
        .join('\n\n---\n\n');

      console.log(
        `📝 [RAG QUERY] Final context: ${results.length} chunks, ${contextString.length} characters`,
      );
      console.log(`📈 [CACHE STATS] From cache: ${fromCache}, Query time: ${queryTime}ms`);

      return contextString;
    } catch (error) {
      console.error('❌ [RAG QUERY] Error in cached context search:', error);

      // Fallback to original implementation on cache error
      try {
        setStatusText('🔄 緩存錯誤，使用傳統方法...');
        console.log('⚠️ [RAG FALLBACK] Cache failed, falling back to original RAG implementation');

        const queryVector = await generateEmbedding(message, 'query');
        const ragSettings = getRagSettingsService();
        const vectorSearchLimit = ragSettings.getVectorSearchLimit();
        const enableReranking = ragSettings.isRerankingEnabled();
        const rerankLimit = ragSettings.getRerankLimit();
        const minSimilarity = ragSettings.getMinSimilarity();

        // 優先使用 Turso 向量搜尋
        setStatusText('🌐 搜尋知識庫 (Turso)...');
        const tursoResults = await searchSimilarChunks(assistantId, queryVector, vectorSearchLimit);

        if (tursoResults.length > 0) {
          const topChunks = tursoResults.filter(chunk => chunk.similarity > minSimilarity);
          let finalChunks = topChunks;

          if (enableReranking && topChunks.length > 0) {
            setStatusText('🔄 重新排序相關內容...');
            const ragChunks = topChunks.map((chunk, index) => ({
              id: `${chunk.fileName}-${index}`,
              fileName: chunk.fileName,
              content: chunk.content,
              chunkIndex: index,
            }));
            const reRanked = await rerankChunks(message, ragChunks, rerankLimit);
            finalChunks = reRanked.map(chunk => ({
              ...chunk,
              similarity: chunk.relevanceScore || 0,
            }));
          } else {
            finalChunks = topChunks.slice(0, rerankLimit);
          }

          const contextString = finalChunks
            .map(chunk => `From ${chunk.fileName}:\n${chunk.content}`)
            .join('\n\n---\n\n');

          return contextString;
        }

        // IndexedDB fallback
        if (ragChunks.length > 0) {
          setStatusText('📄 搜尋本地知識庫...');
          const scoredChunks = (ragChunks as RagChunk[]).map(chunk => ({
            ...chunk,
            similarity: chunk.vector ? cosineSimilarity(queryVector, chunk.vector) : 0,
          }));

          scoredChunks.sort((a, b) => b.similarity - a.similarity);
          const topChunks = scoredChunks.slice(0, vectorSearchLimit);
          const relevantChunks = topChunks.filter(chunk => chunk.similarity > minSimilarity);

          let finalChunks = relevantChunks;

          if (enableReranking && relevantChunks.length > 0) {
            setStatusText('🔄 重新排序相關內容...');
            const reRanked = await rerankChunks(
              message,
              relevantChunks.filter(c => c.vector),
              rerankLimit,
            );
            finalChunks = reRanked.map(chunk => ({
              ...chunk,
              similarity: chunk.relevanceScore || 0,
            }));
          } else {
            finalChunks = relevantChunks.slice(0, rerankLimit);
          }

          const contextString = finalChunks
            .map(chunk => `From ${chunk.fileName}:\n${chunk.content}`)
            .join('\n\n---\n\n');

          return contextString;
        }

        return '';
      } catch (fallbackError) {
        console.error('❌ [RAG FALLBACK] Fallback also failed:', fallbackError);
        setStatusText('❌ 搜尋知識庫時發生錯誤');
        return '';
      }
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

    // 立即顯示用戶訊息
    const newUserMessage = { role: 'user' as const, content: userMessage };
    const updatedSession = {
      ...currentSession,
      messages: [...currentSession.messages, newUserMessage],
    };
    setCurrentSession(updatedSession);

    try {
      let ragContext = '';
      ragContext = await findRelevantContext(userMessage);

      if (ragContext) {
        setStatusText('🧠 已擷取知識。生成上下文化回答...');
      } else {
        setStatusText('🤖 生成回答...');
      }

      // Prepare chat history with compression support
      let chatHistory: ChatMessage[];
      let enhancedSystemPrompt = systemPrompt;

      // Step 1: Add RAG context to system prompt first (if available)
      if (ragContext) {
        const ragPreamble = `Use the information from the following context to inform your response to the user's question. Provide a natural, conversational answer as if the information is part of your general knowledge, without mentioning the context or documents directly. If the answer is not found in the provided information, state that you don't have the relevant information to answer the question.\n\n<context>\n${ragContext}\n</context>`;
        enhancedSystemPrompt = `${systemPrompt}\n\n${ragPreamble}`;
      }

      // Step 2: Add compressed conversation context (if available)
      if (currentSession.compactContext) {
        const compactedContextPrompt = `\n\n[PREVIOUS CONVERSATION SUMMARY]\n${currentSession.compactContext.content}\n\nThe above is a summary of our previous conversation. Please refer to this context when responding to continue our conversation naturally.\n\n[CURRENT CONVERSATION]`;

        enhancedSystemPrompt = `${enhancedSystemPrompt}${compactedContextPrompt}`;

        // Use only the preserved recent messages for history
        chatHistory = currentSession.messages;

        console.log('📜 [CHAT HISTORY] Using compressed context in system prompt:', {
          compactTokens: currentSession.compactContext.tokenCount,
          compressedRounds: currentSession.compactContext.compressedFromRounds,
          preservedMessages: currentSession.messages.length,
          systemPromptLength: enhancedSystemPrompt.length,
        });
      } else {
        // No compression, use regular message history
        chatHistory = currentSession.messages;
        console.log('📜 [CHAT HISTORY] Using regular history:', {
          messageCount: chatHistory.length,
        });
      }

      await streamChat({
        systemPrompt: enhancedSystemPrompt,
        ragContext: '', // Pass empty since we've already integrated RAG into system prompt
        history: chatHistory,
        message: userMessage,
        onChunk: chunk => {
          if (isThinking) {
            setIsThinking(false); // 第一個 chunk 到達時停止 thinking 動畫
          }
          setStreamingResponse(prev => prev + chunk);
        },
        onComplete: (tokenInfo, fullModelResponse) => {
          setIsLoading(false);
          setIsThinking(false);
          setStatusText('');

          // 創建 AI 回應訊息
          const newAiMessage = { role: 'model' as const, content: fullModelResponse };
          const finalSession = {
            ...updatedSession,
            messages: [...updatedSession.messages, newAiMessage],
            tokenCount:
              (updatedSession.tokenCount || 0) +
              tokenInfo.promptTokenCount +
              tokenInfo.candidatesTokenCount,
          };

          setCurrentSession(finalSession);
          setStreamingResponse('');

          // 通知父組件更新
          onNewMessage(finalSession, userMessage, fullModelResponse, tokenInfo);
        },
      });
    } catch (error) {
      console.error('Error during chat stream:', error);
      setIsLoading(false);
      setIsThinking(false);
      setStatusText('');
      setStreamingResponse(
        `抱歉，發生錯誤。API 返回以下錯誤：\n\n${(error as Error).message}\n\n請檢查您的 API 密鑰和控制檯以取得更多細節。`,
      );
    }
  };

  return (
    <div className='flex flex-col h-full bg-gray-900'>
      {/* Optional Header */}
      {!hideHeader && (
        <div className='p-4 border-b border-gray-700 flex-shrink-0 bg-gray-800'>
          <div className='flex items-center justify-between'>
            <h2 className='text-xl font-semibold text-white'>{assistantName}</h2>
            <div className='flex items-center space-x-3'>
              {sharedMode && (
                <button
                  onClick={async () => {
                    // Create new session for shared mode
                    await actions.createNewSession(assistantId);
                    // Reset local state for new conversation
                    setCurrentSession({ ...currentSession, messages: [], tokenCount: 0 });
                    setStreamingResponse('');
                    setIsThinking(false);
                    setStatusText('');
                    setInput('');
                  }}
                  className='flex items-center space-x-2 px-3 py-1.5 rounded-md transition-colors text-sm font-medium bg-purple-700 hover:bg-purple-600 text-purple-100 hover:text-white'
                  title='開啟新對話'
                >
                  <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M12 4v16m8-8H4'
                    />
                  </svg>
                  <span>新對話</span>
                </button>
              )}
              <button
                onClick={() => setShowRagSettings(true)}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-md transition-colors text-sm font-medium ${sharedMode ? 'bg-blue-700 hover:bg-blue-600 text-blue-100 hover:text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white'}`}
                title={sharedMode ? '全域 RAG 搜尋設定' : 'RAG 搜尋設定'}
              >
                <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                  />
                </svg>
                <span>RAG 設定</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <main className='flex-1 overflow-y-auto chat-scroll' role='main' aria-label='聊天對話'>
        <div className='max-w-4xl mx-auto px-4 py-6'>
          {/* Welcome Message for Empty Chat */}
          {currentSession.messages.length === 0 && !streamingResponse && !isThinking && (
            <WelcomeMessage
              assistantName={assistantName}
              assistantDescription={assistantDescription}
              sharedMode={sharedMode}
            />
          )}
          {/* Message List */}
          <div className='space-y-8'>
            {currentSession.messages.map((msg, index) => (
              <MessageBubble
                key={index}
                message={msg}
                index={index}
                assistantName={assistantName}
              />
            ))}

            {/* Thinking Placeholder */}
            {isThinking && !streamingResponse && <ThinkingIndicator />}

            {/* Streaming Response */}
            {streamingResponse && <StreamingResponse content={streamingResponse} />}
          </div>
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        isLoading={isLoading}
        statusText={statusText}
        currentSession={currentSession}
        disabled={false}
      />

      {/* RAG Settings Modal */}
      <RagSettingsModal isOpen={showRagSettings} onClose={() => setShowRagSettings(false)} />
    </div>
  );
};

export default ChatContainer;
