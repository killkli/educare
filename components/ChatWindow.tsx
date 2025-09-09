import React, { useState, useRef, useEffect } from 'react';
import { ChatSession, RagChunk } from '../types';
import { UserIcon, GeminiIcon } from './ui/Icons';
import { streamChat } from '../services/llmService';
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
    tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
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
  const [isComposing, setIsComposing] = useState(false); // 追蹤輸入法組合狀態
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
        `抱歉，發生錯誤。API 返回以下錯誤：\n\n${(error as Error).message}\n\n請檢查您的 API 密鑰和控制檯以取得更多細節。`,
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 檢查是否正在輸入法組合狀態（如中文拼音輸入）
    // 使用雙重檢查：React 事件的 isComposing 和我們自己的狀態追蹤
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  // 輸入法組合開始事件
  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  // 輸入法組合結束事件
  const handleCompositionEnd = () => {
    setIsComposing(false);
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
      <main className='flex-1 overflow-y-auto chat-scroll' role='main' aria-label='聊天對話'>
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
          <div className='space-y-8'>
            {currentSession.messages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'user' ? (
                  /* User Message - Right Side */
                  <div className='flex flex-row-reverse gap-3 max-w-4xl'>
                    <div className='flex-shrink-0'>
                      <div className='w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg ring-2 ring-cyan-400/20'>
                        <UserIcon className='w-5 h-5 text-white' />
                      </div>
                    </div>
                    <div className='flex flex-col items-end group'>
                      <div className='bg-gradient-to-br from-cyan-500 to-blue-600 text-white px-5 py-3 rounded-2xl rounded-br-md shadow-lg max-w-lg relative'>
                        <div className='text-sm leading-relaxed'>
                          {renderMessageContent(msg.content)}
                        </div>
                        {/* Message actions */}
                        <div className='absolute -left-12 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
                          <button
                            onClick={() => navigator.clipboard.writeText(msg.content)}
                            className='p-2 text-gray-400 hover:text-gray-600 bg-white/90 rounded-lg shadow-md hover:shadow-lg transition-all duration-200'
                            title='複製訊息'
                          >
                            <svg
                              className='w-4 h-4'
                              fill='none'
                              stroke='currentColor'
                              viewBox='0 0 24 24'
                            >
                              <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth={2}
                                d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {/* Timestamp */}
                      <div className='text-xs text-gray-400 mt-2 px-2 opacity-60 group-hover:opacity-100 transition-opacity duration-200 bg-gray-800/30 rounded-full px-3 py-1'>
                        {new Date().toLocaleTimeString('zh-TW', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Assistant Message - Left Side */
                  <div className='flex gap-3 max-w-4xl'>
                    <div className='flex-shrink-0'>
                      <div className='w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-600 rounded-full flex items-center justify-center shadow-lg ring-2 ring-gray-600/30'>
                        <GeminiIcon className='w-5 h-5 text-cyan-400' />
                      </div>
                    </div>
                    <div className='flex flex-col group'>
                      <div className='bg-gray-800/80 backdrop-blur-sm text-gray-100 px-5 py-3 rounded-2xl rounded-bl-md shadow-lg border border-gray-700/50 relative'>
                        <div className='text-sm leading-relaxed'>
                          {renderMessageContent(msg.content)}
                        </div>
                        {/* Message actions */}
                        <div className='absolute -right-12 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
                          <button
                            onClick={() => navigator.clipboard.writeText(msg.content)}
                            className='p-2 text-gray-400 hover:text-gray-600 bg-white/90 rounded-lg shadow-md hover:shadow-lg transition-all duration-200'
                            title='複製回應'
                          >
                            <svg
                              className='w-4 h-4'
                              fill='none'
                              stroke='currentColor'
                              viewBox='0 0 24 24'
                            >
                              <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth={2}
                                d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {/* Timestamp */}
                      <div className='text-xs text-gray-400 mt-2 px-2 opacity-60 group-hover:opacity-100 transition-opacity duration-200 bg-gray-800/30 rounded-full px-3 py-1'>
                        {new Date().toLocaleTimeString('zh-TW', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
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
                    <div className='w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-600 rounded-full flex items-center justify-center shadow-lg ring-2 ring-gray-600/30'>
                      <GeminiIcon className='w-5 h-5 text-cyan-400 animate-pulse' />
                    </div>
                  </div>
                  <div className='flex flex-col'>
                    <div className='bg-gray-800/80 backdrop-blur-sm text-gray-100 px-5 py-4 rounded-2xl rounded-bl-md shadow-lg border border-gray-700/50'>
                      <div className='flex items-center space-x-3'>
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
                        <span className='text-gray-300 text-sm font-medium'>AI 正在思考...</span>
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
                    <div className='w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-600 rounded-full flex items-center justify-center shadow-lg ring-2 ring-cyan-400/30'>
                      <GeminiIcon className='w-5 h-5 text-cyan-400' />
                    </div>
                  </div>
                  <div className='flex flex-col group'>
                    <div className='bg-gray-800/80 backdrop-blur-sm text-gray-100 px-5 py-3 rounded-2xl rounded-bl-md shadow-lg border border-gray-700/50 relative'>
                      <div className='text-sm leading-relaxed'>
                        {renderMessageContent(streamingResponse)}
                        <span className='inline-block w-0.5 h-4 bg-cyan-400 ml-1 animate-pulse'></span>
                      </div>
                      {/* Streaming indicator */}
                      <div className='absolute -top-2 -right-2 w-4 h-4 bg-cyan-500 rounded-full animate-pulse shadow-lg ring-2 ring-cyan-400/30'></div>
                    </div>
                    {/* Real-time timestamp */}
                    <div className='text-xs text-gray-400 mt-1 px-2 opacity-60'>正在輸入...</div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <div className='border-t border-gray-700/30 bg-gradient-to-r from-gray-800/90 to-gray-850/90 backdrop-blur-sm p-6'>
        <div className='max-w-4xl mx-auto'>
          {/* Status Text */}
          {statusText && (
            <div className='mb-4 p-3 bg-gray-700/30 rounded-lg border border-gray-600/30 backdrop-blur-sm'>
              <div className='flex items-center gap-3'>
                <div className='relative'>
                  <div className='w-3 h-3 bg-cyan-400 rounded-full animate-pulse'></div>
                  <div className='absolute inset-0 w-3 h-3 bg-cyan-400 rounded-full animate-ping opacity-75'></div>
                </div>
                <span className='text-sm text-cyan-300 font-medium'>{statusText}</span>
              </div>
            </div>
          )}

          {/* Input Row */}
          <div className='flex gap-4 items-end'>
            <div className='flex-1 relative'>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                placeholder='輸入您的訊息...'
                rows={1}
                className='w-full bg-gray-700/60 border-2 border-gray-600/40 rounded-2xl px-6 py-4 resize-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/60 focus:bg-gray-700/80 text-white placeholder-gray-400 max-h-32 shadow-lg backdrop-blur-sm transition-all duration-300 hover:border-gray-500/60 focus:outline-none'
                disabled={isLoading}
                aria-label='輸入訊息'
                aria-describedby='input-help'
                aria-multiline='true'
                role='textbox'
                style={{
                  minHeight: '56px',
                  height: Math.min(input.split('\n').length * 24 + 32, 128) + 'px',
                }}
              />
              {/* Token counter and character counter */}
              <div className='absolute bottom-2 right-4 flex items-center gap-2'>
                {currentSession.tokenCount > 0 && (
                  <div className='flex items-center gap-1 bg-gray-800/80 px-3 py-1 rounded-full text-xs text-cyan-300 backdrop-blur-sm'>
                    <svg className='w-3 h-3' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'
                      />
                    </svg>
                    <span>{currentSession.tokenCount}</span>
                  </div>
                )}
                {input.length > 100 && (
                  <div className='bg-gray-800/80 px-2 py-1 rounded-full text-xs text-gray-400'>
                    {input.length}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className={`relative ${
                isLoading || !input.trim()
                  ? 'bg-gray-600/50 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 hover:scale-105 hover:shadow-xl hover:shadow-cyan-500/30'
              } text-white rounded-2xl px-8 py-4 font-semibold transition-all duration-300 flex items-center justify-center min-w-[100px] shadow-lg border border-gray-600/30 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-gray-800`}
              aria-label={isLoading ? '正在傳送訊息' : '傳送訊息'}
              type='submit'
            >
              {isLoading ? (
                <>
                  <div className='w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin' />
                  <div className='absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-pulse'></div>
                </>
              ) : (
                <>
                  <svg
                    className='w-5 h-5 mr-2'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M12 19l9 2-9-18-9 18 9-2zm0 0v-8'
                    />
                  </svg>
                  <span>傳送</span>
                </>
              )}
            </button>
          </div>

          {/* Footer Info */}
          <div className='flex justify-center items-center mt-4' id='input-help'>
            <div
              className='flex items-center gap-3 text-xs text-gray-400'
              role='region'
              aria-label='輸入說明'
            >
              <div className='flex items-center gap-2 bg-gray-700/30 px-3 py-1.5 rounded-full border border-gray-600/30'>
                <kbd
                  className='px-2 py-1 bg-gray-600/50 rounded text-xs font-medium'
                  aria-label='Enter 鍵'
                >
                  Enter
                </kbd>
                <span>傳送</span>
              </div>
              <div className='flex items-center gap-2 bg-gray-700/30 px-3 py-1.5 rounded-full border border-gray-600/30'>
                <kbd
                  className='px-2 py-1 bg-gray-600/50 rounded text-xs font-medium'
                  aria-label='Shift 加 Enter 鍵'
                >
                  Shift + Enter
                </kbd>
                <span>換行</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;
