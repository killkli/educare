import React, { useState, useEffect, useRef } from 'react';
import { ChatContainerProps } from './types';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import WelcomeMessage from './WelcomeMessage';
import ThinkingIndicator from './ThinkingIndicator';
import StreamingResponse from './StreamingResponse';
import { generateEmbedding, cosineSimilarity, rerankChunks } from '../../services/embeddingService';
import { searchSimilarChunks } from '../../services/tursoService';
import { streamChat } from '../../services/llmService';
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
  const [input, setInput] = useState('');
  const [streamingResponse, setStreamingResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
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
  }, [currentSession.messages, streamingResponse, isThinking]);

  const findRelevantContext = async (message: string): Promise<string> => {
    try {
      console.log(`🎯 [RAG QUERY] Starting context search for query: "${message}"`);
      setStatusText('🔍 生成查詢嵌入...');
      const queryVector = await generateEmbedding(message, 'query');

      // 優先使用 Turso 向量搜尋
      setStatusText('🌐 搜尋知識庫 (Turso)...');
      console.log('🔍 [RAG QUERY] Attempting Turso vector search first...');
      const tursoResults = await searchSimilarChunks(assistantId, queryVector, 20);

      if (tursoResults.length > 0) {
        // 使用 Turso 搜尋結果 - 先抓 top 50
        setStatusText(`🔍 取得 ${tursoResults.length} 個候選文件...`);
        console.log(`📊 [RAG QUERY] Using TURSO results - Found ${tursoResults.length} chunks`);
        const topChunks = tursoResults.filter(chunk => chunk.similarity > 0.3);
        console.log(`📊 [RAG QUERY] Filtered to ${topChunks.length} chunks with similarity > 0.3`);

        // Apply re-ranking to get top 5
        setStatusText('🔄 重新排序相關內容...');
        console.log(`🔄 [RAG QUERY] Starting rerank with ${topChunks.length} chunks`);
        // Convert SimilarChunk to RagChunk for reranking
        const ragChunks = topChunks.map((chunk, index) => ({
          id: `${chunk.fileName}-${index}`,
          fileName: chunk.fileName,
          content: chunk.content,
          chunkIndex: index,
        }));
        const reRanked = await rerankChunks(message, ragChunks, 5);
        console.log(`🔄 [RAG QUERY] Re-ranked to ${reRanked.length} top chunks`);

        const contextString = reRanked
          .map(chunk => `From ${chunk.fileName}:\n${chunk.content}`)
          .join('\n\n---\n\n');

        console.log(`📝 [RAG QUERY] Final context length: ${contextString.length} characters`);
        return contextString;
      }

      // 後備：如果 Turso 搜尋失敗，使用本地 ragChunks
      setStatusText('🗄️ 搜尋本地知識庫...');
      console.log('⚠️ [RAG QUERY] Turso search returned no results, falling back to IndexedDB...');
      if (ragChunks.length > 0) {
        setStatusText(`📊 分析 ${ragChunks.length} 個本地文件...`);
        console.log(
          `🔍 [RAG QUERY] Using INDEXEDDB fallback - Processing ${ragChunks.length} local chunks`,
        );

        const scoredChunks = (ragChunks as RagChunk[]).map(chunk => ({
          ...chunk,
          similarity: chunk.vector ? cosineSimilarity(queryVector, chunk.vector) : 0,
        }));

        scoredChunks.sort((a, b) => b.similarity - a.similarity);
        const topChunks = scoredChunks.slice(0, 20); // Get more for re-ranking
        const relevantChunks = topChunks.filter(chunk => chunk.similarity > 0.3); // Lower threshold for re-ranking

        console.log(
          `📊 [RAG QUERY] IndexedDB filtered to ${relevantChunks.length} chunks for re-ranking`,
        );

        // Apply re-ranking
        setStatusText('🔄 重新排序相關內容...');
        const reRanked = await rerankChunks(
          message,
          relevantChunks.filter(c => c.vector),
          5,
        );
        console.log(`🔄 [RAG QUERY] Re-ranked to ${reRanked.length} top chunks`);

        const contextString = reRanked
          .map(chunk => `From ${chunk.fileName}:\n${chunk.content}`)
          .join('\n\n---\n\n');

        console.log(`📝 [RAG QUERY] Final context length: ${contextString.length} characters`);
        return contextString;
      }

      console.log(
        '❌ [RAG QUERY] No context found - neither Turso nor IndexedDB had relevant data',
      );
      return '';
    } catch (error) {
      console.error('❌ [RAG QUERY] Error finding relevant context:', error);
      setStatusText('❌ 搜尋知識庫時發生錯誤');
      return ''; // Return empty context on error
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
          <h2 className='text-xl font-semibold text-white'>{assistantName}</h2>
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
    </div>
  );
};

export default ChatContainer;
