import React, { useState, useEffect, useCallback } from 'react';
import { Assistant, ChatSession } from './types';
import * as db from './services/db';
import AssistantEditor from './components/AssistantEditor';
import ChatWindow from './components/ChatWindow';
import MigrationPanel from './components/MigrationPanel';
import SharedAssistant from './components/SharedAssistant';
import ApiKeySetup from './components/ApiKeySetup';
import { PlusIcon, ChatIcon, TrashIcon, EditIcon, SettingsIcon } from './components/Icons';
import { canWriteToTurso } from './services/tursoService';
import { providerManager, initializeProviders } from './services/providerRegistry';
import ProviderSettings from './components/ProviderSettings';
import { preloadEmbeddingModel, isEmbeddingModelLoaded } from './services/embeddingService';
import { ModelLoadingOverlay } from './components/ModelLoadingOverlay';
import { ShareModal } from './components/ShareModal';
import { CustomSelect } from './components/CustomSelect';

type ViewMode =
  | 'chat'
  | 'edit_assistant'
  | 'new_assistant'
  | 'settings'
  | 'api_setup'
  | 'provider_settings';

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
  const [isTablet, setIsTablet] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelLoadingProgress, setModelLoadingProgress] = useState<{
    status: string;
    progress: number;
    name?: string;
  } | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [assistantToShare, setAssistantToShare] = useState<Assistant | null>(null);

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
      // Initialize providers asynchronously
      initializeProviders().catch(error => {
        console.error('❌ Failed to initialize providers:', error);
      });

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
      const tablet = window.innerWidth >= 768 && window.innerWidth < 1024;
      setIsMobile(mobile);
      setIsTablet(tablet);
      if (mobile) {
        setIsSidebarOpen(false); // 移動端預設關閉側邊欄
      } else if (tablet) {
        setIsSidebarOpen(false); // 平板端預設關閉側邊欄
      } else {
        setIsSidebarOpen(true); // 桌面端預設開啟側邊欄
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

  const handleQuickShare = (assistant: Assistant) => {
    setAssistantToShare(assistant);
    setShareModalOpen(true);
  };

  return (
    <div className='flex h-screen font-sans bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 relative'>
      {/* Sidebar Overlay for Mobile and Tablet */}
      {(isMobile || isTablet) && isSidebarOpen && (
        <div
          className='fixed inset-0 bg-black/50 z-40 lg:hidden'
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed left-0 top-0 h-full z-50 ${
          isMobile || isTablet ? 'w-80' : 'w-72'
        } bg-gray-900/95 backdrop-blur-sm flex flex-col p-6 border-r border-gray-700/50 shadow-2xl transition-transform duration-300 ease-in-out`}
      >
        {(isMobile || isTablet) && (
          <div className='flex items-center justify-end mb-6'>
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
          </div>
        )}
        {/* Assistant Selection and Actions */}
        <div className='mb-6 px-2' role='navigation' aria-label='助理選擇'>
          <label className='block text-sm font-bold text-gray-300 uppercase tracking-wider mb-2'>
            選擇助理
          </label>

          <CustomSelect
            assistants={assistants}
            selectedAssistant={currentAssistant}
            onSelect={handleSelectAssistant}
            placeholder='請選擇一個助理'
          />

          <div className='flex justify-end gap-1 mt-2'>
            <button
              onClick={() => setViewMode('new_assistant')}
              className='p-1.5 text-gray-400 hover:text-cyan-400 rounded-md hover:bg-cyan-500/20 transition-colors'
              title='新增助理'
              aria-label='新增助理'
            >
              <PlusIcon className='w-4 h-4' />
            </button>
            {currentAssistant && (
              <>
                <button
                  onClick={() => handleQuickShare(currentAssistant)}
                  className='p-1.5 text-gray-400 hover:text-blue-400 rounded-md hover:bg-blue-500/20 transition-colors'
                  title='分享助理'
                  aria-label='分享助理'
                >
                  <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z'
                    />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    setViewMode('edit_assistant');
                    setCurrentAssistant(currentAssistant);
                  }}
                  className='p-1.5 text-gray-400 hover:text-cyan-400 rounded-md hover:bg-cyan-500/20 transition-colors'
                  title='編輯助理'
                  aria-label='編輯助理'
                >
                  <EditIcon className='w-4 h-4' />
                </button>
                <button
                  onClick={() => handleDeleteAssistant(currentAssistant.id)}
                  className='p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/20 transition-colors'
                  title='刪除助理'
                  aria-label='刪除助理'
                >
                  <TrashIcon className='w-4 h-4' />
                </button>
              </>
            )}
          </div>
        </div>

        {currentAssistant && (
          <div
            className='flex-1 overflow-y-auto chat-scroll'
            role='navigation'
            aria-label='聊天記錄'
          >
            <h2 className='text-sm font-bold text-gray-300 uppercase tracking-wider mb-3 px-2'>
              聊天記錄
            </h2>
            <button
              onClick={() => handleNewSession(currentAssistant.id)}
              className='w-full flex items-center justify-center p-2.5 mb-3 bg-gray-700/50 hover:bg-gray-600/60 text-gray-200 hover:text-white rounded-lg text-sm font-medium border border-gray-600/30 hover:border-gray-500/50 transition-colors'
            >
              <PlusIcon className='w-4 h-4 mr-2' /> 新增聊天
            </button>
            <div className='space-y-2'>
              {sessions.map(sess => (
                <div
                  key={sess.id}
                  className={`group flex items-center p-3 rounded-lg cursor-pointer transition-colors ${
                    currentSession?.id === sess.id
                      ? 'bg-cyan-600/20 border border-cyan-500/30 text-white'
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
                  <div className='flex-1 min-w-0'>
                    <div className='truncate font-medium text-white'>{sess.title}</div>
                    <div className='text-xs text-gray-400 mt-1'>
                      {new Date(sess.updatedAt || sess.createdAt).toLocaleString('zh-TW', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handleDeleteSession(sess.id);
                    }}
                    className='opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/20 transition-all duration-200 ml-2'
                    title='刪除聊天'
                  >
                    <TrashIcon className='w-4 h-4' />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className='mt-auto pt-4'>
          <div className='border-t border-gray-700/30 pt-3 px-2'>
            <button
              onClick={() => setViewMode('settings')}
              className='flex items-center p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-gray-700/50 transition-colors text-xs'
            >
              <SettingsIcon className='w-4 h-4 mr-2' />
              <span>設定</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main
        className={`flex-1 bg-gradient-to-br from-gray-800 to-gray-900 backdrop-blur-sm flex flex-col min-w-0 relative transition-all duration-300 ease-in-out ${
          isSidebarOpen && !isMobile && !isTablet ? 'ml-72' : ''
        }`}
      >
        {/* Top Bar with Hamburger Menu */}
        {(isMobile || isTablet) && !isSidebarOpen && (
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
                      : viewMode === 'provider_settings'
                        ? 'AI 服務商'
                        : '專業助理'}
            </h2>
          </div>
        )}

        {/* Content Area */}
        <div className='flex-1'>
          {viewMode === 'new_assistant' && (
            <AssistantEditor
              assistant={null}
              onSave={handleSaveAssistant}
              onCancel={() => {
                if (assistants.length > 0) {
                  setViewMode('chat');
                }
              }}
              onShare={handleQuickShare}
            />
          )}
          {viewMode === 'edit_assistant' && currentAssistant && (
            <AssistantEditor
              assistant={currentAssistant}
              onSave={handleSaveAssistant}
              onCancel={() => setViewMode('chat')}
              onShare={handleQuickShare}
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

              {/* 服務狀態 */}
              <div className='mb-6 bg-gray-700 rounded-lg p-4'>
                <h3 className='text-lg font-semibold text-white mb-4'>服務狀態</h3>
                <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-4'>
                  <div
                    className={`p-3 rounded-md border-2 ${
                      providerManager.getAvailableProviders().length > 0
                        ? 'border-green-500 bg-green-800 bg-opacity-20'
                        : 'border-yellow-500 bg-yellow-800 bg-opacity-20'
                    }`}
                  >
                    <div className='flex items-center mb-2'>
                      <span className='text-lg mr-2'>
                        {providerManager.getAvailableProviders().length > 0 ? '✅' : '⚠️'}
                      </span>
                      <span className='font-medium text-white'>AI 服務商</span>
                    </div>
                    <p
                      className={`text-sm ${
                        providerManager.getAvailableProviders().length > 0
                          ? 'text-green-200'
                          : 'text-yellow-200'
                      }`}
                    >
                      {providerManager.getAvailableProviders().length > 0
                        ? `${providerManager.getAvailableProviders().length} 個服務商可用`
                        : '需要配置 AI 服務商'}
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
                <div className='flex gap-3'>
                  <button
                    onClick={() => setViewMode('provider_settings')}
                    className='flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
                  >
                    AI 服務商設定
                  </button>
                  <button
                    onClick={() => setViewMode('api_setup')}
                    className='flex-1 px-6 py-3 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
                  >
                    資料庫設定
                  </button>
                </div>
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
          {viewMode === 'provider_settings' && (
            <div className='bg-gray-800 absolute inset-0 overflow-y-auto'>
              <ProviderSettings onClose={() => setViewMode('settings')} />
            </div>
          )}
          {isLoading && (
            <div className='flex flex-col items-center justify-center h-full text-gray-400 p-8'>
              <div className='relative mb-6'>
                <div className='w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin'></div>
                <div className='absolute inset-0 w-16 h-16 border-4 border-cyan-300/20 rounded-full'></div>
              </div>
              <div className='text-center max-w-md'>
                <p className='text-lg font-medium text-white mb-2'>載入助理中...</p>
                <p className='text-sm text-gray-400 mb-4'>正在從資料庫讀取您的助理資料</p>
                <div className='flex justify-center items-center space-x-1 mb-4'>
                  <div className='w-2 h-2 bg-cyan-500 rounded-full animate-bounce'></div>
                  <div
                    className='w-2 h-2 bg-cyan-500 rounded-full animate-bounce'
                    style={{ animationDelay: '0.1s' }}
                  ></div>
                  <div
                    className='w-2 h-2 bg-cyan-500 rounded-full animate-bounce'
                    style={{ animationDelay: '0.2s' }}
                  ></div>
                </div>
                <div className='text-xs text-gray-500'>
                  <div>正在執行以下步驟：</div>
                  <div className='mt-2 space-y-1'>
                    <div className='flex items-center justify-center gap-2'>
                      <div className='w-1.5 h-1.5 bg-green-500 rounded-full'></div>
                      <span>連接資料庫</span>
                    </div>
                    <div className='flex items-center justify-center gap-2'>
                      <div className='w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse'></div>
                      <span>載入助理資料</span>
                    </div>
                    <div className='flex items-center justify-center gap-2'>
                      <div className='w-1.5 h-1.5 bg-gray-500 rounded-full'></div>
                      <span>初始化介面</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {!currentAssistant &&
            !isLoading &&
            viewMode !== 'new_assistant' &&
            viewMode !== 'settings' &&
            viewMode !== 'provider_settings' && (
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

      {/* Share Modal */}
      {assistantToShare && (
        <ShareModal
          isOpen={shareModalOpen}
          onClose={() => {
            setShareModalOpen(false);
            setAssistantToShare(null);
          }}
          assistant={assistantToShare}
        />
      )}
    </div>
  );
};

export default App;
