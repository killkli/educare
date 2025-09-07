import React, { useState, useEffect, useCallback } from 'react';
import { Assistant, ChatSession, ChatMessage } from './types';
import * as db from './services/db';
import AssistantEditor from './components/AssistantEditor';
import ChatWindow from './components/ChatWindow';
import MigrationPanel from './components/MigrationPanel';
import SharedAssistant from './components/SharedAssistant';
import ApiKeySetup from './components/ApiKeySetup';
import { PlusIcon, ChatIcon, TrashIcon, EditIcon, SettingsIcon } from './components/Icons';
import { isGeminiAvailable } from './services/geminiService';
import { canWriteToTurso } from './services/tursoService';

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
    [handleNewSession]
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const storedAssistants = await db.getAllAssistants();
      setAssistants(storedAssistants.sort((a, b) => b.createdAt - a.createdAt));

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

  // Check for shared mode on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.has('share');
    const assistantId = params.get('share');

    setIsShared(shared);
    setSharedAssistantId(assistantId);
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
    modelResponse: string,
    tokenInfo: { promptTokenCount: number; candidatesTokenCount: number }
  ) => {
    const newMessages: ChatMessage[] = [
      ...session.messages,
      { role: 'user', content: userMessage },
      { role: 'model', content: modelResponse },
    ];

    const updatedSession: ChatSession = {
      ...session,
      messages: newMessages,
      title: session.messages.length === 0 ? userMessage.substring(0, 40) : session.title,
      tokenCount: session.tokenCount + tokenInfo.promptTokenCount + tokenInfo.candidatesTokenCount,
    };

    await db.saveSession(updatedSession);
    setCurrentSession(updatedSession);
    setSessions(prev => prev.map(s => (s.id === updatedSession.id ? updatedSession : s)));
  };

  return (
    <div className='flex h-screen font-sans'>
      {/* Sidebar */}
      <div className='w-80 bg-gray-900 flex flex-col p-4 border-r border-gray-700'>
        <h1 className='text-xl font-bold text-white mb-4'>專業助理</h1>
        <button
          onClick={() => setViewMode('new_assistant')}
          className='w-full flex items-center justify-center p-2 mb-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md font-semibold'
        >
          <PlusIcon className='w-5 h-5 mr-2' /> 新增助理
        </button>

        {/* Assistants List */}
        <div className='flex-1 overflow-y-auto pr-2'>
          <h2 className='text-xs font-bold text-gray-400 uppercase tracking-wider mb-2'>助理</h2>
          {assistants.map(asst => (
            <div
              key={asst.id}
              className={`group flex items-center p-2 rounded-md cursor-pointer mb-1 ${currentAssistant?.id === asst.id ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
              onClick={() => handleSelectAssistant(asst.id)}
            >
              <span className='flex-1 truncate text-sm'>{asst.name}</span>
              <button
                onClick={e => {
                  e.stopPropagation();
                  setViewMode('edit_assistant');
                  setCurrentAssistant(asst);
                }}
                className='opacity-0 group-hover:opacity-100 text-gray-400 hover:text-white p-1'
              >
                <EditIcon className='w-4 h-4' />
              </button>
              <button
                onClick={e => {
                  e.stopPropagation();
                  handleDeleteAssistant(asst.id);
                }}
                className='opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1'
              >
                <TrashIcon className='w-4 h-4' />
              </button>
            </div>
          ))}

          {currentAssistant && (
            <div className='mt-6'>
              <h2 className='text-xs font-bold text-gray-400 uppercase tracking-wider mb-2'>
                聊天記錄
              </h2>
              <button
                onClick={() => handleNewSession(currentAssistant.id)}
                className='w-full flex items-center p-2 mb-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md text-sm'
              >
                <PlusIcon className='w-4 h-4 mr-2' /> 新增聊天
              </button>
              {sessions.map(sess => (
                <div
                  key={sess.id}
                  className={`group flex items-center p-2 rounded-md cursor-pointer ${currentSession?.id === sess.id ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
                  onClick={() => setCurrentSession(sess)}
                >
                  <ChatIcon className='w-4 h-4 mr-2 text-gray-400' />
                  <span className='flex-1 truncate text-sm'>{sess.title}</span>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handleDeleteSession(sess.id);
                    }}
                    className='opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1'
                  >
                    <TrashIcon className='w-4 h-4' />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className='mt-auto border-t border-gray-700 pt-4'>
          <button
            onClick={() => setViewMode('settings')}
            className='w-full flex items-center p-2 text-gray-400 hover:bg-gray-800 hover:text-white rounded-md text-sm'
          >
            <SettingsIcon className='w-5 h-5 mr-2' /> 設定與分享
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className='flex-1 bg-gray-800'>
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
                className='px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md transition-colors'
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
          <div className='flex items-center justify-center h-full text-gray-400'>載入助理中...</div>
        )}
        {!currentAssistant && !isLoading && viewMode !== 'new_assistant' && (
          <div className='flex items-center justify-center h-full text-gray-400'>
            選擇一個助理或新增一個以開始使用。
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
