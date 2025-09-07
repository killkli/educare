import React, { useState, useEffect, useCallback } from 'react';
import { Assistant, ChatSession } from './types';
import * as db from './services/db';
import AssistantEditor from './components/AssistantEditor';
import ChatWindow from './components/ChatWindow';
import MigrationPanel from './components/MigrationPanel';
import SharedAssistant from './components/SharedAssistant';
import ApiKeySetup from './components/ApiKeySetup';
import { PlusIcon, ChatIcon, TrashIcon, EditIcon, SettingsIcon } from './components/Icons';
import { isGeminiAvailable } from './services/geminiService';
import { canWriteToTurso } from './services/tursoService';
import { preloadEmbeddingModel, isEmbeddingModelLoaded } from './services/embeddingService';
import { ModelLoadingOverlay } from './components/ModelLoadingOverlay';

type ViewMode = 'chat' | 'edit_assistant' | 'new_assistant' | 'settings' | 'api_setup';

const App: React.FC = () => {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [currentAssistant, setCurrentAssistant] = useState<Assistant | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [isLoading, setIsLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [isShared, setIsShared] = useState(false);
  const [sharedAssistantId, setSharedAssistantId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelLoadingProgress, setModelLoadingProgress] = useState<{
    status: string;
    progress: number;
    name?: string;
  } | null>(null);

  const handleNewSession = useCallback(async (assistantId: string) => {
    const newSession: ChatSession = {
      id: `session-${Date.now()}`,
      assistantId,
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
      tokenCount: 0,
    };
    await db.saveSession(newSession);
    setSessions(prev => [newSession, ...prev]);
    setCurrentSession(newSession);
  }, []);

  const handleSelectAssistant = useCallback(
    async (assistantId: string) => {
      const asst = await db.getAssistant(assistantId);
      if (asst) {
        setCurrentAssistant(asst);
        const asstSessions = await db.getSessionsForAssistant(asst.id);
        setSessions(asstSessions.sort((a, b) => b.createdAt - a.createdAt));
        if (asstSessions.length > 0) {
          setCurrentSession(asstSessions[0]);
        } else {
          handleNewSession(asst.id);
        }
        setViewMode('chat');
      }
    },
    [handleNewSession],
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const storedAssistants = await db.getAllAssistants();
      setAssistants(storedAssistants.sort((a, b) => b.createdAt - a.createdAt));

      // Check if embedding model is loaded, if not, preload it
      if (!isEmbeddingModelLoaded()) {
        setIsModelLoading(true);
        try {
          await preloadEmbeddingModel(progress => {
            setModelLoadingProgress(progress);
          });
          console.log('✅ Embedding model preloaded successfully');
        } catch (error) {
          console.error('❌ Failed to preload embedding model:', error);
          // Continue anyway - model will load when needed
        } finally {
          setIsModelLoading(false);
          setModelLoadingProgress(null);
        }
      }

      if (storedAssistants.length > 0) {
        handleSelectAssistant(storedAssistants[0].id);
      } else {
        setViewMode('new_assistant');
      }
    } catch (e) {
      setError('無法從資料庫載入資料。');
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [handleSelectAssistant]);

  // Check for shared mode and screen size on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.has('share');
    const assistantId = params.get('share');

    setIsShared(shared);
    setSharedAssistantId(assistantId);

    // 檢測螢幕尺寸
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setIsSidebarOpen(false); // 移動端預設關閉側邊欄
      }
    };

    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  useEffect(() => {
    if (!isShared) {
      loadData();
    }
  }, [loadData, isShared]);

  // If in shared mode, render SharedAssistant
  if (isShared && sharedAssistantId) {
    return <SharedAssistant assistantId={sharedAssistantId} />;
  }

  const handleSaveAssistant = async (assistant: Assistant) => {
    await db.saveAssistant(assistant);
    const storedAssistants = await db.getAllAssistants();
    setAssistants(storedAssistants.sort((a, b) => b.createdAt - a.createdAt));
    if (!currentAssistant || assistant.id === currentAssistant.id || viewMode === 'new_assistant') {
      handleSelectAssistant(assistant.id);
    }
  };

  const handleDeleteAssistant = async (assistantId: string) => {
    if (window.confirm('確定要刪除此助理和所有聊天記錄嗎？')) {
      await db.deleteAssistant(assistantId);
      const updatedAssistants = assistants.filter(a => a.id !== assistantId);
      setAssistants(updatedAssistants);
      if (currentAssistant?.id === assistantId) {
        if (updatedAssistants.length > 0) {
          handleSelectAssistant(updatedAssistants[0].id);
        } else {
          setCurrentAssistant(null);
          setCurrentSession(null);
          setSessions([]);
          setViewMode('new_assistant');
        }
      }
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!currentAssistant) {
      return;
    }
    if (window.confirm('確定要刪除此聊天會話嗎？')) {
      await db.deleteSession(sessionId);
      const asstSessions = await db.getSessionsForAssistant(currentAssistant.id);
      setSessions(asstSessions.sort((a, b) => b.createdAt - a.createdAt));
      if (currentSession?.id === sessionId) {
        setCurrentSession(asstSessions.length > 0 ? asstSessions[0] : null);
        if (asstSessions.length === 0) {
          handleNewSession(currentAssistant.id);
        }
      }
    }
  };

  const handleNewMessage = async (
    session: ChatSession,
    userMessage: string,
    _modelResponse: string,
    _tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
  ) => {
    // ChatWindow 已經包含了完整的訊息，我們只需要更新標題（如果是第一則訊息）
    const updatedSession: ChatSession = {
      ...session,
      title:
        session.title === 'New Chat' && userMessage ? userMessage.substring(0, 40) : session.title,
      updatedAt: Date.now(),
    };

    await db.saveSession(updatedSession);
    setCurrentSession(updatedSession);
    setSessions(prev => prev.map(s => (s.id === updatedSession.id ? updatedSession : s)));
  };

  return (
    <div className='flex h-screen font-sans bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 relative'>
      {/* Mobile Sidebar Overlay */}
      {isMobile && isSidebarOpen && (
        <div
          className='fixed inset-0 bg-black/50 z-40 md:hidden'
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${
          isMobile ? 'fixed left-0 top-0 h-full z-50 w-80' : 'relative w-80 flex-shrink-0'
        } bg-gray-900/95 backdrop-blur-sm flex flex-col p-6 border-r border-gray-700/50 shadow-2xl transition-transform duration-300 ease-in-out`}
      >
        <div className='flex items-center justify-between mb-6'>
          <h1 className='text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent'>
            專業助理
          </h1>
          {isMobile && (
            <button
              onClick={() => setIsSidebarOpen(false)}
              className='p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800/50 transition-colors'
            >
              <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </button>
          )}
        </div>
        <button
          onClick={() => setViewMode('new_assistant')}
          className='w-full flex items-center justify-center p-3 mb-6 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
        >
          <PlusIcon className='w-5 h-5 mr-2' /> 新增助理
        </button>

        {/* Assistants List */}
        <div className='flex-1 overflow-y-auto'>
          <div className='mb-6'>
            <h2 className='text-sm font-bold text-gray-300 uppercase tracking-wider mb-4 px-2'>
              助理
            </h2>
            <div className='space-y-2'>
              {assistants.map(asst => (
                <div
                  key={asst.id}
                  className={`group flex items-center p-3 rounded-lg cursor-pointer transition-all duration-200 ${
                    currentAssistant?.id === asst.id
                      ? 'bg-cyan-600/20 border border-cyan-500/30 text-white shadow-md'
                      : 'bg-gray-800/30 hover:bg-gray-700/50 text-gray-200 hover:text-white border border-transparent hover:border-gray-600/30'
                  }`}
                  onClick={() => handleSelectAssistant(asst.id)}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 flex-shrink-0 ${
                      currentAssistant?.id === asst.id ? 'bg-cyan-500' : 'bg-gray-600'
                    }`}
                  >
                    <svg
                      className='w-4 h-4 text-white'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
                      />
                    </svg>
                  </div>
                  <span className='flex-1 truncate font-medium'>{asst.name}</span>
                  <div className='flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setViewMode('edit_assistant');
                        setCurrentAssistant(asst);
                      }}
                      className='p-1.5 text-gray-400 hover:text-cyan-400 rounded-md hover:bg-gray-600/30 transition-colors'
                      title='編輯助理'
                    >
                      <EditIcon className='w-4 h-4' />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDeleteAssistant(asst.id);
                      }}
                      className='p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/20 transition-colors'
                      title='刪除助理'
                    >
                      <TrashIcon className='w-4 h-4' />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {currentAssistant && (
            <div>
              <h2 className='text-sm font-bold text-gray-300 uppercase tracking-wider mb-4 px-2'>
                聊天記錄
              </h2>
              <button
                onClick={() => handleNewSession(currentAssistant.id)}
                className='w-full flex items-center justify-center p-3 mb-4 bg-gray-700/50 hover:bg-gray-600/60 text-gray-200 hover:text-white rounded-lg text-sm font-medium border border-gray-600/30 hover:border-gray-500/50 transition-all duration-200'
              >
                <PlusIcon className='w-4 h-4 mr-2' /> 新增聊天
              </button>
              <div className='space-y-2'>
                {sessions.map(sess => (
                  <div
                    key={sess.id}
                    className={`group flex items-center p-3 rounded-lg cursor-pointer transition-all duration-200 ${
                      currentSession?.id === sess.id
                        ? 'bg-cyan-600/20 border border-cyan-500/30 text-white shadow-md'
                        : 'bg-gray-800/30 hover:bg-gray-700/50 text-gray-200 hover:text-white border border-transparent hover:border-gray-600/30'
                    }`}
                    onClick={() => setCurrentSession(sess)}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 flex-shrink-0 ${
                        currentSession?.id === sess.id ? 'bg-cyan-500' : 'bg-gray-600'
                      }`}
                    >
                      <ChatIcon className='w-4 h-4 text-white' />
                    </div>
                    <span className='flex-1 truncate font-medium'>{sess.title}</span>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDeleteSession(sess.id);
                      }}
                      className='opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/20 transition-all duration-200'
                      title='刪除聊天'
                    >
                      <TrashIcon className='w-4 h-4' />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className='mt-auto pt-6'>
          <div className='border-t border-gray-700/30 pt-4'>
            <button
              onClick={() => setViewMode('settings')}
              className='w-full flex items-center p-3 text-gray-300 hover:text-white rounded-lg hover:bg-gray-700/50 transition-all duration-200 border border-transparent hover:border-gray-600/30'
            >
              <div className='w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center mr-3 flex-shrink-0'>
                <SettingsIcon className='w-4 h-4 text-white' />
              </div>
              <span className='font-medium'>設定與分享</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className='flex-1 bg-gradient-to-br from-gray-800 to-gray-900 backdrop-blur-sm flex flex-col min-w-0'>
        {/* Top Bar with Hamburger Menu */}
        {isMobile && !isSidebarOpen && (
          <div className='flex items-center p-4 border-b border-gray-700/50 bg-gray-800/80 backdrop-blur-sm'>
            <button
              onClick={() => setIsSidebarOpen(true)}
              className='p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50 transition-colors mr-3'
            >
              <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M4 6h16M4 12h16M4 18h16'
                />
              </svg>
            </button>
            <h2 className='text-lg font-semibold text-white'>
              {viewMode === 'chat' && currentAssistant
                ? currentAssistant.name
                : viewMode === 'new_assistant'
                  ? '新增助理'
                  : viewMode === 'edit_assistant'
                    ? '編輯助理'
                    : viewMode === 'settings'
                      ? '設定'
                      : '專業助理'}
            </h2>
          </div>
        )}

        {/* Content Area */}
        <div className='flex-1 overflow-hidden'>
          {viewMode === 'new_assistant' && (
            <AssistantEditor
              assistant={null}
              onSave={handleSaveAssistant}
              onCancel={() => {
                if (assistants.length > 0) {
                  setViewMode('chat');
                }
              }}
            />
          )}
          {viewMode === 'edit_assistant' && currentAssistant && (
            <AssistantEditor
              assistant={currentAssistant}
              onSave={handleSaveAssistant}
              onCancel={() => setViewMode('chat')}
            />
          )}
          {viewMode === 'chat' && currentAssistant && currentSession && (
            <ChatWindow
              session={currentSession}
              assistantName={currentAssistant.name}
              systemPrompt={currentAssistant.systemPrompt}
              assistantId={currentAssistant.id}
              ragChunks={currentAssistant.ragChunks}
              onNewMessage={handleNewMessage}
            />
          )}
          {viewMode === 'settings' && (
            <div className='p-6 bg-gray-800 h-full overflow-y-auto'>
              <h2 className='text-2xl font-bold mb-6 text-white'>設定</h2>

              {/* API 金鑰設定 */}
              <div className='mb-6 bg-gray-700 rounded-lg p-4'>
                <h3 className='text-lg font-semibold text-white mb-4'>API 金鑰配置</h3>
                <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-4'>
                  <div
                    className={`p-3 rounded-md border-2 ${
                      isGeminiAvailable()
                        ? 'border-green-500 bg-green-800 bg-opacity-20'
                        : 'border-yellow-500 bg-yellow-800 bg-opacity-20'
                    }`}
                  >
                    <div className='flex items-center mb-2'>
                      <span className='text-lg mr-2'>{isGeminiAvailable() ? '✅' : '⚠️'}</span>
                      <span className='font-medium text-white'>Gemini AI</span>
                    </div>
                    <p
                      className={`text-sm ${
                        isGeminiAvailable() ? 'text-green-200' : 'text-yellow-200'
                      }`}
                    >
                      {isGeminiAvailable() ? '可以使用聊天功能' : '需要配置才能聊天'}
                    </p>
                  </div>
                  <div
                    className={`p-3 rounded-md border-2 ${
                      canWriteToTurso()
                        ? 'border-green-500 bg-green-800 bg-opacity-20'
                        : 'border-yellow-500 bg-yellow-800 bg-opacity-20'
                    }`}
                  >
                    <div className='flex items-center mb-2'>
                      <span className='text-lg mr-2'>{canWriteToTurso() ? '✅' : '⚠️'}</span>
                      <span className='font-medium text-white'>Turso 資料庫</span>
                    </div>
                    <p
                      className={`text-sm ${
                        canWriteToTurso() ? 'text-green-200' : 'text-yellow-200'
                      }`}
                    >
                      {canWriteToTurso() ? '可以保存助理和 RAG' : '需要配置才能保存'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setViewMode('api_setup')}
                  className='px-6 py-3 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
                >
                  配置 API 金鑰
                </button>
              </div>

              {/* Turso Migration Panel */}
              <div className='mb-6'>
                <MigrationPanel />
              </div>
            </div>
          )}
          {viewMode === 'api_setup' && (
            <div className='p-6 bg-gray-800 h-full overflow-y-auto'>
              <ApiKeySetup
                onComplete={() => setViewMode('settings')}
                onCancel={() => setViewMode('settings')}
              />
            </div>
          )}
          {isLoading && (
            <div className='flex flex-col items-center justify-center h-full text-gray-400 p-8'>
              <div className='w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4'></div>
              <p className='text-lg font-medium'>載入助理中...</p>
              <p className='text-sm text-gray-500 mt-2'>正在從資料庫讀取您的助理資料</p>
            </div>
          )}
          {!currentAssistant && !isLoading && viewMode !== 'new_assistant' && (
            <div className='flex flex-col items-center justify-center h-full text-gray-400 p-8'>
              <div className='w-20 h-20 bg-gray-700 rounded-full flex items-center justify-center mb-6'>
                <svg
                  className='w-10 h-10 text-gray-500'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'
                  />
                </svg>
              </div>
              <h3 className='text-xl font-semibold text-white mb-2'>歡迎使用專業助理</h3>
              <p className='text-gray-400 mb-6 text-center max-w-md'>
                還沒有任何助理。創建您的第一個 AI 助理開始聊天吧！
              </p>
              <button
                onClick={() => setViewMode('new_assistant')}
                className='px-6 py-3 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
              >
                新增您的第一個助理
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Model Loading Overlay */}
      <ModelLoadingOverlay
        isVisible={isModelLoading}
        progress={modelLoadingProgress || undefined}
      />
    </div>
  );
};

export default App;
