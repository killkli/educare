import React, { useState, useRef, useEffect } from 'react';
import { ChatSession, RagChunk } from '../types';
import { UserIcon, GeminiIcon } from './Icons';
import { streamChat } from '../services/geminiService';
import { generateEmbedding, cosineSimilarity } from '../services/embeddingService';
import { searchSimilarChunks } from '../services/tursoService';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

interface ChatWindowProps {
  session: ChatSession;
  assistantName: string;
  systemPrompt: string;
  assistantId: string;
  ragChunks: RagChunk[]; // 保留作為後備，但主要使用 Turso 搜尋
  onNewMessage: (
    session: ChatSession,
    userMessage: string,
    modelResponse: string,
    tokenInfo: { promptTokenCount: number; candidatesTokenCount: number }
  ) => Promise<void>;
  hideHeader?: boolean; // 新增選項，在分享模式下隱藏標題
  sharedMode?: boolean; // 分享模式
  assistantDescription?: string; // Assistant 描述
}

const ChatWindow: React.FC<ChatWindowProps> = ({
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
      const tursoResults = await searchSimilarChunks(assistantId, queryVector, 5);

      if (tursoResults.length > 0) {
        // 使用 Turso 搜尋結果
        setStatusText(`✅ 處理 ${tursoResults.length} 個相關文件...`);
        console.log(`✅ [RAG QUERY] Using TURSO results - Found ${tursoResults.length} chunks`);
        const relevantChunks = tursoResults.filter(chunk => chunk.similarity > 0.5);
        console.log(
          `📊 [RAG QUERY] Filtered to ${relevantChunks.length} chunks with similarity > 0.5`
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
          `🔍 [RAG QUERY] Using INDEXEDDB fallback - Processing ${ragChunks.length} local chunks`
        );

        const scoredChunks = ragChunks.map(chunk => ({
          ...chunk,
          similarity: cosineSimilarity(queryVector, chunk.vector),
        }));

        scoredChunks.sort((a, b) => b.similarity - a.similarity);
        const topChunks = scoredChunks.slice(0, 5);
        const relevantChunks = topChunks.filter(chunk => chunk.similarity > 0.5);

        console.log(
          `📊 [RAG QUERY] IndexedDB filtered to ${relevantChunks.length} chunks with similarity > 0.5`
        );

        const contextString = relevantChunks
          .map(chunk => `From ${chunk.fileName}:\n${chunk.content}`)
          .join('\n\n---\n\n');

        console.log(`📝 [RAG QUERY] Final context length: ${contextString.length} characters`);
        return contextString;
      }

      console.log(
        '❌ [RAG QUERY] No context found - neither Turso nor IndexedDB had relevant data'
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

      await streamChat({
        systemPrompt,
        ragContext,
        history: currentSession.messages,
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
        `抱歉，發生錯誤。API 返回以下錯誤：\n\n${(error as Error).message}\n\n請檢查您的 API 密鑰和控制檯以取得更多細節。`
      );
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessageContent = (content: string) => {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // 自定義 code 區塊樣式
          code({
            inline,
            className,
            children,
            ...props
          }: {
            inline?: boolean;
            className?: string;
            children: React.ReactNode;
            [key: string]: unknown;
          }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            if (!inline) {
              // 多行代碼塊
              return (
                <div className='bg-gray-900 rounded-md my-2 overflow-hidden'>
                  <div className='flex justify-between items-center px-4 py-2 bg-gray-700 text-xs'>
                    <span className='text-gray-300'>{language || 'code'}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(String(children))}
                      className='text-gray-400 hover:text-white transition-colors'
                    >
                      複製
                    </button>
                  </div>
                  <pre className='p-4 text-sm overflow-x-auto'>
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                </div>
              );
            } else {
              // 內聯代碼
              return (
                <code
                  className='bg-gray-700 text-cyan-300 px-1.5 py-0.5 rounded text-sm font-mono'
                  {...props}
                >
                  {children}
                </code>
              );
            }
          },
          // 自定義其他元素樣式
          h1: ({ children }) => <h1 className='text-xl font-bold mb-2 text-white'>{children}</h1>,
          h2: ({ children }) => (
            <h2 className='text-lg font-semibold mb-2 text-white'>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className='text-base font-medium mb-1 text-white'>{children}</h3>
          ),
          p: ({ children }) => <p className='mb-2 leading-relaxed'>{children}</p>,
          ul: ({ children }) => (
            <ul className='list-disc list-inside mb-2 space-y-1'>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className='list-decimal list-inside mb-2 space-y-1'>{children}</ol>
          ),
          li: ({ children }) => <li className='text-sm'>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className='border-l-4 border-cyan-500 pl-4 my-2 bg-gray-800/50 py-2 rounded-r'>
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target='_blank'
              rel='noopener noreferrer'
              className='text-cyan-400 hover:text-cyan-300 underline'
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className='font-semibold text-white'>{children}</strong>
          ),
          em: ({ children }) => <em className='italic'>{children}</em>,
          table: ({ children }) => (
            <div className='overflow-x-auto my-2'>
              <table className='min-w-full border-collapse border border-gray-600'>
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className='border border-gray-600 px-4 py-2 bg-gray-700 font-semibold text-left'>
              {children}
            </th>
          ),
          td: ({ children }) => <td className='border border-gray-600 px-4 py-2'>{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    );
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
      <div className='flex-1 overflow-y-auto'>
        <div className='max-w-4xl mx-auto px-4 py-6'>
          {/* Welcome Message for Empty Chat */}
          {currentSession.messages.length === 0 && !streamingResponse && !isThinking && (
            <div className='text-center py-12'>
              <div className='w-20 h-20 bg-cyan-600 rounded-full flex items-center justify-center mx-auto mb-6'>
                <GeminiIcon className='w-10 h-10 text-white' />
              </div>
              <h3 className='text-2xl font-semibold text-white mb-3'>{assistantName}</h3>
              {assistantDescription && (
                <p className='text-gray-300 mb-6 max-w-2xl mx-auto leading-relaxed'>
                  {assistantDescription}
                </p>
              )}
              {sharedMode && (
                <div className='inline-flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-full text-sm text-gray-400 mb-6'>
                  <span>💡</span>
                  <span>分享的 AI 助理 - 您的對話不會永久儲存</span>
                </div>
              )}
              <p className='text-gray-400 text-lg'>
                {assistantDescription ? '讓我們開始聊天吧！' : '問我任何問題，我會幫助您！'}
              </p>
            </div>
          )}

          {/* Message List */}
          <div className='space-y-6'>
            {currentSession.messages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'user' ? (
                  /* User Message - Right Side */
                  <div className='flex flex-row-reverse gap-3 max-w-3xl'>
                    <div className='flex-shrink-0'>
                      <div className='w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-full flex items-center justify-center shadow-lg'>
                        <UserIcon className='w-5 h-5 text-white' />
                      </div>
                    </div>
                    <div className='flex flex-col items-end'>
                      <div className='bg-gradient-to-br from-blue-500 to-cyan-600 text-white px-4 py-3 rounded-2xl rounded-br-md shadow-lg max-w-md'>
                        <div className='text-sm leading-relaxed'>
                          {renderMessageContent(msg.content)}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Assistant Message - Left Side */
                  <div className='flex gap-3 max-w-4xl'>
                    <div className='flex-shrink-0'>
                      <div className='w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-600 rounded-full flex items-center justify-center shadow-lg border-2 border-gray-600'>
                        <GeminiIcon className='w-5 h-5 text-cyan-400' />
                      </div>
                    </div>
                    <div className='flex flex-col'>
                      <div className='bg-gray-800 text-gray-100 px-4 py-3 rounded-2xl rounded-bl-md shadow-lg'>
                        <div className='text-sm leading-relaxed'>
                          {renderMessageContent(msg.content)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Thinking Placeholder */}
            {isThinking && !streamingResponse && (
              <div className='flex justify-start'>
                <div className='flex gap-3 max-w-4xl'>
                  <div className='flex-shrink-0'>
                    <div className='w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-600 rounded-full flex items-center justify-center shadow-lg border-2 border-gray-600'>
                      <GeminiIcon className='w-5 h-5 text-cyan-400' />
                    </div>
                  </div>
                  <div className='flex flex-col'>
                    <div className='bg-gray-800 text-gray-100 px-4 py-3 rounded-2xl rounded-bl-md shadow-lg'>
                      <div className='flex items-center space-x-2'>
                        <div className='flex space-x-1'>
                          <div
                            className='w-2 h-2 bg-cyan-400 rounded-full animate-bounce'
                            style={{ animationDelay: '0ms' }}
                          ></div>
                          <div
                            className='w-2 h-2 bg-cyan-400 rounded-full animate-bounce'
                            style={{ animationDelay: '150ms' }}
                          ></div>
                          <div
                            className='w-2 h-2 bg-cyan-400 rounded-full animate-bounce'
                            style={{ animationDelay: '300ms' }}
                          ></div>
                        </div>
                        <span className='text-gray-400 text-sm'>思考中...</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Streaming Response */}
            {streamingResponse && (
              <div className='flex justify-start'>
                <div className='flex gap-3 max-w-4xl'>
                  <div className='flex-shrink-0'>
                    <div className='w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-600 rounded-full flex items-center justify-center shadow-lg border-2 border-gray-600'>
                      <GeminiIcon className='w-5 h-5 text-cyan-400' />
                    </div>
                  </div>
                  <div className='flex flex-col'>
                    <div className='bg-gray-800 text-gray-100 px-4 py-3 rounded-2xl rounded-bl-md shadow-lg'>
                      <div className='text-sm leading-relaxed'>
                        {renderMessageContent(streamingResponse)}
                        <span className='inline-block w-1 h-4 bg-cyan-400 ml-1 animate-pulse'></span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className='border-t border-gray-700/50 bg-gradient-to-r from-gray-800 to-gray-850 p-6'>
        <div className='max-w-4xl mx-auto'>
          {/* Status Text */}
          {statusText && (
            <div className='mb-3 text-sm text-cyan-400 animate-pulse flex items-center gap-2'>
              <div className='w-2 h-2 bg-cyan-400 rounded-full animate-pulse'></div>
              {statusText}
            </div>
          )}

          {/* Input Row */}
          <div className='flex gap-4 items-end'>
            <div className='flex-1 relative'>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder='輸入您的訊息...'
                rows={1}
                className='w-full bg-gray-700/80 border border-gray-600/50 rounded-3xl px-5 py-4 resize-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-gray-700 text-white placeholder-gray-400 max-h-32 shadow-inner backdrop-blur-sm transition-all duration-200'
                disabled={isLoading}
                style={{
                  minHeight: '56px',
                  height: Math.min(input.split('\n').length * 24 + 32, 128) + 'px',
                }}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className={`${
                isLoading || !input.trim()
                  ? 'bg-gray-600 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 hover:scale-105 hover:shadow-lg hover:shadow-cyan-500/25'
              } text-white rounded-full px-8 py-4 font-semibold transition-all duration-200 flex items-center justify-center min-w-[100px] shadow-lg`}
            >
              {isLoading ? (
                <div className='w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin' />
              ) : (
                <span>傳送</span>
              )}
            </button>
          </div>

          {/* Footer Info */}
          <div className='flex justify-between items-center text-xs text-gray-400 mt-4'>
            <span className='flex items-center gap-2'>
              <kbd className='px-2 py-1 bg-gray-700 rounded text-xs'>Enter</kbd>
              <span>傳送</span>
              <span className='text-gray-500'>•</span>
              <kbd className='px-2 py-1 bg-gray-700 rounded text-xs'>Shift + Enter</kbd>
              <span>換行</span>
            </span>
            {currentSession.tokenCount > 0 && (
              <span className='bg-gray-700/50 px-3 py-1 rounded-full'>
                {currentSession.tokenCount} 代幣
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;
