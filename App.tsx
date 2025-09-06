import React, { useState, useEffect, useCallback } from 'react';
import { Assistant, ChatSession, ChatMessage } from './types';
import * as db from './services/db';
import AssistantEditor from './components/AssistantEditor';
import ChatWindow from './components/ChatWindow';
import MigrationPanel from './components/MigrationPanel';
import SharedAssistant from './components/SharedAssistant';
import { PlusIcon, ChatIcon, TrashIcon, EditIcon, SettingsIcon } from './components/Icons';

type ViewMode = 'chat' | 'edit_assistant' | 'new_assistant' | 'settings';

const App: React.FC = () => {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [currentAssistant, setCurrentAssistant] = useState<Assistant | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 檢查是否為分享模式
  const isSharedMode = () => {
    const params = new URLSearchParams(window.location.search);
    return params.has('share');
  };

  // 獲取分享的 Assistant ID
  const getSharedAssistantId = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('share');
  };

  // 如果是分享模式，直接渲染 SharedAssistant 組件
  if (isSharedMode()) {
    const assistantId = getSharedAssistantId();
    if (assistantId) {
      return <SharedAssistant assistantId={assistantId} />;
    }
  }

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
      setError('Failed to load data from the database.');
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);


  const handleSelectAssistant = async (assistantId: string) => {
    const asst = await db.getAssistant(assistantId);
    if (asst) {
      setCurrentAssistant(asst);
      const asstSessions = await db.getSessionsForAssistant(asst.id);
      setSessions(asstSessions.sort((a,b)=> b.createdAt - a.createdAt));
      if (asstSessions.length > 0) {
        setCurrentSession(asstSessions[0]);
      } else {
        handleNewSession(asst.id);
      }
      setViewMode('chat');
    }
  };

  const handleSaveAssistant = async (assistant: Assistant) => {
    await db.saveAssistant(assistant);
    const storedAssistants = await db.getAllAssistants();
    setAssistants(storedAssistants.sort((a,b)=> b.createdAt - a.createdAt));
    if (!currentAssistant || assistant.id === currentAssistant.id || viewMode === 'new_assistant') {
      handleSelectAssistant(assistant.id);
    }
  };
  
  const handleDeleteAssistant = async (assistantId: string) => {
    if (window.confirm("Are you sure you want to delete this assistant and all its chats?")) {
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

  const handleNewSession = async (assistantId: string) => {
    const newSession: ChatSession = {
      id: `sess_${Date.now()}`,
      assistantId,
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
      tokenCount: 0,
    };
    await db.saveSession(newSession);
    const asstSessions = await db.getSessionsForAssistant(assistantId);
    setSessions(asstSessions.sort((a,b)=> b.createdAt - a.createdAt));
    setCurrentSession(newSession);
  };
  
  const handleDeleteSession = async (sessionId: string) => {
    if(!currentAssistant) return;
    if (window.confirm("Are you sure you want to delete this chat session?")) {
        await db.deleteSession(sessionId);
        const asstSessions = await db.getSessionsForAssistant(currentAssistant.id);
        setSessions(asstSessions.sort((a,b)=> b.createdAt - a.createdAt));
        if (currentSession?.id === sessionId) {
            setCurrentSession(asstSessions.length > 0 ? asstSessions[0] : null);
            if(asstSessions.length === 0){
                handleNewSession(currentAssistant.id);
            }
        }
    }
  }

  const handleNewMessage = async (session: ChatSession, userMessage: string, modelResponse: string, tokenInfo: {promptTokenCount: number, candidatesTokenCount: number}) => {
      const newMessages: ChatMessage[] = [
          ...session.messages,
          { role: 'user', content: userMessage },
          { role: 'model', content: modelResponse },
      ];

      const updatedSession: ChatSession = {
          ...session,
          messages: newMessages,
          title: session.messages.length === 0 ? userMessage.substring(0, 40) : session.title,
          tokenCount: session.tokenCount + tokenInfo.promptTokenCount + tokenInfo.candidatesTokenCount
      };

      await db.saveSession(updatedSession);
      setCurrentSession(updatedSession);
      setSessions(prev => prev.map(s => s.id === updatedSession.id ? updatedSession : s));
  };
  


  return (
    <div className="flex h-screen font-sans">
      {/* Sidebar */}
      <div className="w-80 bg-gray-900 flex flex-col p-4 border-r border-gray-700">
        <h1 className="text-xl font-bold text-white mb-4">Pro Assistant</h1>
        <button onClick={() => setViewMode('new_assistant')} className="w-full flex items-center justify-center p-2 mb-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md font-semibold">
          <PlusIcon className="w-5 h-5 mr-2" /> New Assistant
        </button>
        
        {/* Assistants List */}
        <div className="flex-1 overflow-y-auto pr-2">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Assistants</h2>
          {assistants.map(asst => (
            <div key={asst.id} className={`group flex items-center p-2 rounded-md cursor-pointer mb-1 ${currentAssistant?.id === asst.id ? 'bg-gray-700' : 'hover:bg-gray-800'}`} onClick={() => handleSelectAssistant(asst.id)}>
              <span className="flex-1 truncate text-sm">{asst.name}</span>
              <button onClick={(e) => {e.stopPropagation(); setViewMode('edit_assistant'); setCurrentAssistant(asst);}} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-white p-1"><EditIcon className="w-4 h-4" /></button>
              <button onClick={(e) => {e.stopPropagation(); handleDeleteAssistant(asst.id);}} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1"><TrashIcon className="w-4 h-4" /></button>
            </div>
          ))}
          
          {currentAssistant && (
            <div className="mt-6">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Chat History</h2>
                <button onClick={() => handleNewSession(currentAssistant.id)} className="w-full flex items-center p-2 mb-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md text-sm">
                    <PlusIcon className="w-4 h-4 mr-2" /> New Chat
                </button>
                {sessions.map(sess => (
                    <div key={sess.id} className={`group flex items-center p-2 rounded-md cursor-pointer ${currentSession?.id === sess.id ? 'bg-gray-700' : 'hover:bg-gray-800'}`} onClick={() => setCurrentSession(sess)}>
                        <ChatIcon className="w-4 h-4 mr-2 text-gray-400"/>
                        <span className="flex-1 truncate text-sm">{sess.title}</span>
                         <button onClick={(e) => {e.stopPropagation(); handleDeleteSession(sess.id);}} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1"><TrashIcon className="w-4 h-4" /></button>
                    </div>
                ))}
            </div>
          )}
        </div>
        
        <div className="mt-auto border-t border-gray-700 pt-4">
             <button onClick={() => setViewMode('settings')} className="w-full flex items-center p-2 text-gray-400 hover:bg-gray-800 hover:text-white rounded-md text-sm">
                <SettingsIcon className="w-5 h-5 mr-2" /> Settings & Sharing
            </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 bg-gray-800">
        {viewMode === 'new_assistant' && <AssistantEditor assistant={null} onSave={handleSaveAssistant} onCancel={() => { if(assistants.length > 0) setViewMode('chat')}} />}
        {viewMode === 'edit_assistant' && currentAssistant && <AssistantEditor assistant={currentAssistant} onSave={handleSaveAssistant} onCancel={() => setViewMode('chat')} />}
        {viewMode === 'chat' && currentAssistant && currentSession && <ChatWindow session={currentSession} assistantName={currentAssistant.name} systemPrompt={currentAssistant.systemPrompt} assistantId={currentAssistant.id} ragChunks={currentAssistant.ragChunks} onNewMessage={handleNewMessage} />}
        {viewMode === 'settings' && (
            <div className="p-6 bg-gray-800 h-full overflow-y-auto">
                <h2 className="text-2xl font-bold mb-6 text-white">Settings</h2>
                
                {/* Turso Migration Panel */}
                <div className="mb-6">
                  <MigrationPanel />
                </div>
            </div>
        )}
        {isLoading && <div className="flex items-center justify-center h-full text-gray-400">Loading Assistants...</div>}
        {(!currentAssistant && !isLoading && viewMode !== 'new_assistant') && <div className="flex items-center justify-center h-full text-gray-400">Select an assistant or create a new one to begin.</div>}
      </main>
    </div>
  );
};

export default App;