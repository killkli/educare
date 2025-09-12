import { useState, useEffect, useRef } from 'react';
import { SessionManagerProps } from './types';
import { RagChunk } from '../../types';
import { ragCacheManagerV2 } from '../../services/ragCacheManagerV2';
import { ragQueryService } from '../../services/ragQueryService';
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

      // Use modular cached RAG manager with SessionManager's fixed settings
      const cacheResult = await ragCacheManagerV2.performCachedRagQuery(
        message,
        assistantId,
        ragChunks,
        {
          // SessionManager uses fixed settings (original behavior)
          vectorSearchLimit: 50,
          rerankLimit: 5,
          enableReranking: true,
          minSimilarity: 0.3,
          // Cache-specific settings
          similarityThreshold: 0.9, // High threshold for cache hits
          enableCache: true,
        },
      );

      const { results, fromCache, queryTime, cacheStats, ragMetadata } = cacheResult;

      if (fromCache && cacheStats) {
        setStatusText(`✨ 緩存命中！相似度: ${(cacheStats.similarity || 0).toFixed(3)}`);
        console.log(
          `🎯 [SESSION CACHE HIT] Query "${message}" matched "${cacheStats.originalQuery}" with similarity ${(cacheStats.similarity || 0).toFixed(4)} in ${queryTime}ms`,
        );
      } else {
        const source = ragMetadata?.source || 'unknown';
        setStatusText(`💾 完整 RAG 查詢完成 (${queryTime}ms, 來源: ${source})`);
        console.log(
          `📊 [SESSION CACHE MISS] Performed full RAG query in ${queryTime}ms from ${source}`,
        );
        console.log(
          `📈 [SESSION RAG METADATA] Candidates: ${ragMetadata?.totalCandidates}, Filtered: ${ragMetadata?.filteredCandidates}, Final: ${ragMetadata?.finalResults}`,
        );
      }

      // Convert results to context string using the shared utility
      const contextString = ragCacheManagerV2.resultsToContextString(results);

      console.log(
        `📝 [SESSION RAG] Final context: ${results.length} chunks, ${contextString.length} characters`,
      );
      console.log(`📈 [SESSION CACHE STATS] From cache: ${fromCache}, Query time: ${queryTime}ms`);

      return contextString;
    } catch (error) {
      console.error('❌ [SESSION RAG] Error in cached context search:', error);

      // Fallback to core RAG service directly (without cache) on error
      try {
        setStatusText('🔄 緩存錯誤，使用核心 RAG 服務...');
        console.log('⚠️ [SESSION RAG FALLBACK] Cache failed, falling back to core RAG service');

        // Use core RAG service directly with SessionManager's fixed settings
        const ragResult = await ragQueryService.performRagQuery(message, assistantId, ragChunks, {
          vectorSearchLimit: 50,
          rerankLimit: 5,
          enableReranking: true,
          minSimilarity: 0.3,
        });

        const contextString = ragQueryService.resultsToContextString(ragResult.results);

        console.log(
          `📊 [SESSION RAG FALLBACK] Completed from ${ragResult.source} in ${ragResult.queryTime}ms`,
        );
        return contextString;
      } catch (fallbackError) {
        console.error('❌ [SESSION RAG FALLBACK] Core RAG service also failed:', fallbackError);
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
