import { useState, useEffect, useRef } from 'react';
import { SessionManagerProps } from './types';
import { RagChunk } from '../../types';
import { generateEmbedding, cosineSimilarity, rerankChunks } from '../../services/embeddingService';
import { ragCacheManager } from '../../services/ragCacheManager';
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
      console.log(`🎯 [SESSION RAG] Starting cached context search for query: "${message}"`);
      setStatusText('🔍 檢查查詢緩存...');

      // Use cached RAG manager for the query
      const cacheResult = await ragCacheManager.performCachedRagQuery(
        message,
        assistantId,
        ragChunks,
        {
          similarityThreshold: 0.9, // High threshold for cache hits
          rerankLimit: 5, // SessionManager uses fixed limit of 5
          enableReranking: true, // Always enabled in SessionManager
          enableCache: true,
        },
      );

      const { results, fromCache, queryTime, cacheStats } = cacheResult;

      if (fromCache && cacheStats) {
        setStatusText(`✨ 緩存命中！相似度: ${(cacheStats.similarity || 0).toFixed(3)}`);
        console.log(
          `🎯 [SESSION CACHE HIT] Query "${message}" matched "${cacheStats.originalQuery}" with similarity ${(cacheStats.similarity || 0).toFixed(4)} in ${queryTime}ms`,
        );
      } else {
        setStatusText(`💾 完整 RAG 查詢完成 (${queryTime}ms)`);
        console.log(`📊 [SESSION CACHE MISS] Performed full RAG query in ${queryTime}ms`);
      }

      // Convert results to context string
      if (results.length === 0) {
        console.log('❌ [SESSION RAG] No relevant context found');
        return '';
      }

      const contextString = results
        .map(chunk => `From ${chunk.fileName}:\n${chunk.content}`)
        .join('\n\n---\n\n');

      console.log(
        `📝 [SESSION RAG] Final context: ${results.length} chunks, ${contextString.length} characters`,
      );
      console.log(`📈 [SESSION CACHE STATS] From cache: ${fromCache}, Query time: ${queryTime}ms`);

      return contextString;
    } catch (error) {
      console.error('❌ [SESSION RAG] Error in cached context search:', error);

      // Fallback to original implementation on cache error
      try {
        setStatusText('🔄 緩存錯誤，使用傳統方法...');
        console.log(
          '⚠️ [SESSION RAG FALLBACK] Cache failed, falling back to original RAG implementation',
        );

        const queryVector = await generateEmbedding(message, 'query');

        // 優先使用 Turso 向量搜尋
        setStatusText('🌐 搜尋知識庫 (Turso)...');
        const tursoResults = await searchSimilarChunks(assistantId, queryVector, 50);

        if (tursoResults.length > 0) {
          setStatusText(`🔍 取得 ${tursoResults.length} 個候選文件...`);
          const topChunks = tursoResults.filter(chunk => chunk.similarity > 0.3);

          // Apply re-ranking to get top 5
          setStatusText('🔄 重新排序相關內容...');
          const ragChunksForRerank = topChunks.map((chunk, index) => ({
            id: `${chunk.fileName}-${index}`,
            fileName: chunk.fileName,
            content: chunk.content,
            chunkIndex: index,
          }));
          const reRanked = await rerankChunks(message, ragChunksForRerank, 5);

          const contextString = reRanked
            .map(chunk => `From ${chunk.fileName}:\n${chunk.content}`)
            .join('\n\n---\n\n');

          return contextString;
        }

        // 後備：如果 Turso 搜尋失敗，使用本地 ragChunks
        setStatusText('📄 搜尋本地知識庫...');
        if (ragChunks.length > 0) {
          const scoredChunks = ragChunks.map(chunk => ({
            ...chunk,
            similarity: chunk.vector ? cosineSimilarity(queryVector, chunk.vector) : 0,
          }));

          scoredChunks.sort((a, b) => b.similarity - a.similarity);
          const topChunks = scoredChunks.slice(0, 5);
          const relevantChunks = topChunks.filter(chunk => chunk.similarity > 0.5);

          const contextString = relevantChunks
            .map(chunk => `From ${chunk.fileName}:\n${chunk.content}`)
            .join('\n\n---\n\n');

          return contextString;
        }

        return '';
      } catch (fallbackError) {
        console.error('❌ [SESSION RAG FALLBACK] Fallback also failed:', fallbackError);
        setStatusText('❌ 搜尋知識庫時發生錯誤');
        return '';
      }
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
