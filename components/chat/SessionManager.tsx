import { useState, useEffect, useRef } from 'react';
import { SessionManagerProps } from './types';
import { RagChunk } from '../../types';
import { generateEmbedding, cosineSimilarity } from '../../services/embeddingService';
import { searchSimilarChunks } from '../../services/tursoService';
import { streamChat } from '../../services/llmService';

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

  const findRelevantContext = async (
    message: string,
    assistantId: string,
    ragChunks: RagChunk[],
    setStatusText: (text: string) => void,
  ): Promise<string> => {
    try {
      console.log(`🎯 [RAG QUERY] Starting context search for query: "${message}"`);
      setStatusText('🔍 生成查詢嵌入...');
      const queryVector = await generateEmbedding(message, 'query');

      // 優先使用 Turso 向量搜尋
      setStatusText('🌐 搜尋知識庫 (Turso)...');
      console.log('🔍 [RAG QUERY] Attempting Turso vector search first...');
      const tursoResults = await searchSimilarChunks(assistantId, queryVector, 5);

      if (tursoResults.length > 0) {
        // 使用 Turso 搜尋結果
        setStatusText(`✅ 處理 ${tursoResults.length} 個相關文件...`);
        console.log(`✅ [RAG QUERY] Using TURSO results - Found ${tursoResults.length} chunks`);
        const relevantChunks = tursoResults.filter(chunk => chunk.similarity > 0.5);
        console.log(
          `📊 [RAG QUERY] Filtered to ${relevantChunks.length} chunks with similarity > 0.5`,
        );

        const contextString = relevantChunks
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

        const scoredChunks = ragChunks.map(chunk => ({
          ...chunk,
          similarity: cosineSimilarity(queryVector, chunk.vector),
        }));

        scoredChunks.sort((a, b) => b.similarity - a.similarity);
        const topChunks = scoredChunks.slice(0, 5);
        const relevantChunks = topChunks.filter(chunk => chunk.similarity > 0.5);

        console.log(
          `📊 [RAG QUERY] IndexedDB filtered to ${relevantChunks.length} chunks with similarity > 0.5`,
        );

        const contextString = relevantChunks
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

  const handleSendMessage = async (
    userMessage: string,
    systemPrompt: string,
    assistantId: string,
    ragChunks: RagChunk[],
    setStatusText: (text: string) => void,
    setIsThinking: (thinking: boolean) => void,
    onStreamingChunk: (chunk: string) => void,
    onComplete: (
      tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
      fullResponse: string,
    ) => void,
    onError: (error: Error) => void,
  ) => {
    // 立即顯示用戶訊息
    const newUserMessage = { role: 'user' as const, content: userMessage };
    const updatedSession = {
      ...currentSession,
      messages: [...currentSession.messages, newUserMessage],
    };
    setCurrentSession(updatedSession);
    onSessionUpdate(updatedSession);

    try {
      setIsThinking(true);
      let ragContext = '';
      ragContext = await findRelevantContext(userMessage, assistantId, ragChunks, setStatusText);

      if (ragContext) {
        setStatusText('🧠 已擷取知識。生成上下文化回答...');
      } else {
        setStatusText('🤖 生成回答...');
      }

      await streamChat({
        systemPrompt,
        ragContext,
        history: currentSession.messages,
        message: userMessage,
        onChunk: chunk => {
          setIsThinking(false); // 第一個 chunk 到達時停止 thinking 動畫
          onStreamingChunk(chunk);
        },
        onComplete: (tokenInfo, fullModelResponse) => {
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
