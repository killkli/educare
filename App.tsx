import React, { useState, useEffect, useCallback } from 'react';
import { Assistant, ChatSession, ChatMessage } from './types';
import * as db from './services/db';
import { saveAssistantsToSheet, loadAssistantFromSheet } from './services/googleSheetService';
import AssistantEditor from './components/AssistantEditor';
import ChatWindow from './components/ChatWindow';
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
  const [googleScriptUrl, setGoogleScriptUrl] = useState('');
  const [tempScriptUrl, setTempScriptUrl] = useState('');
  const [shareStatus, setShareStatus] = useState('');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const storedAssistants = await db.getAllAssistants();
      setAssistants(storedAssistants.sort((a, b) => b.createdAt - a.createdAt));
      
      const storedUrl = localStorage.getItem('googleScriptUrl') || '';
      setGoogleScriptUrl(storedUrl);
      setTempScriptUrl(storedUrl);

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
    const handleSharedUrl = async () => {
      const hash = window.location.hash;
      if (hash.startsWith('#/share?')) {
        const params = new URLSearchParams(hash.substring(8));
        const scriptUrl = params.get('scriptUrl');
        const assistantId = params.get('assistantId');

        if (scriptUrl && assistantId) {
          setIsLoading(true);
          setShareStatus('Loading shared assistant...');
          try {
            const loadedAssistant = await loadAssistantFromSheet(decodeURIComponent(scriptUrl), assistantId);
            if (loadedAssistant) {
              await db.saveAssistant(loadedAssistant);
              await loadData(); // Reload all data
              handleSelectAssistant(loadedAssistant.id);
              setShareStatus('Shared assistant loaded successfully!');
            } else {
              setShareStatus('Could not find the shared assistant.');
            }
          } catch(e) {
            console.error(e);
            setShareStatus('Failed to load shared assistant.');
          } finally {
            setIsLoading(false);
            window.location.hash = ''; // Clear hash
            setTimeout(() => setShareStatus(''), 5000);
          }
        }
      }
    };
    
    loadData();
    handleSharedUrl();
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
  
  const handleSaveSettings = () => {
      setGoogleScriptUrl(tempScriptUrl);
      localStorage.setItem('googleScriptUrl', tempScriptUrl);
      setViewMode('chat');
  };
  
  const handleSyncToSheet = async () => {
    if (!googleScriptUrl) {
        alert("Please set your Google Apps Script URL in Settings first.");
        return;
    }
    try {
        await saveAssistantsToSheet(googleScriptUrl, assistants);
        alert("Assistants synced to Google Sheet successfully!");
    } catch(e) {
        alert("Failed to sync assistants. Check the console for errors.");
    }
  };

  const generateShareLink = (assistantId: string) => {
    if (!googleScriptUrl) {
        alert("Please set and save your Google Apps Script URL to generate a share link.");
        return;
    }
    const url = `${window.location.origin}${window.location.pathname}#/share?scriptUrl=${encodeURIComponent(googleScriptUrl)}&assistantId=${assistantId}`;
    navigator.clipboard.writeText(url);
    alert("Share link copied to clipboard!");
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
        {shareStatus && <div className="bg-cyan-600 text-white text-center p-2 text-sm">{shareStatus}</div>}
        {viewMode === 'new_assistant' && <AssistantEditor assistant={null} onSave={handleSaveAssistant} onCancel={() => { if(assistants.length > 0) setViewMode('chat')}} />}
        {viewMode === 'edit_assistant' && currentAssistant && <AssistantEditor assistant={currentAssistant} onSave={handleSaveAssistant} onCancel={() => setViewMode('chat')} />}
        {viewMode === 'chat' && currentAssistant && currentSession && <ChatWindow session={currentSession} assistantName={currentAssistant.name} systemPrompt={currentAssistant.systemPrompt} ragChunks={currentAssistant.ragChunks} onNewMessage={handleNewMessage} />}
        {viewMode === 'settings' && (
            <div className="p-6 bg-gray-800 h-full">
                <h2 className="text-2xl font-bold mb-4 text-white">Settings & Sharing</h2>
                <div className="bg-gray-700 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-2 text-white">Google Sheet Sync</h3>
                    {/* FIX: Escaped curly braces to prevent JSX from interpreting the content as a JavaScript expression. */}
                    <p className="text-sm text-gray-400 mb-4">To sync and share assistants, create a Google Apps Script Web App and paste its URL below. Your script should handle GET requests with `action=load&id=ASSISTANT_ID` and POST requests with `{'{'}action:'save', payload:[...assistants]{'}'}`.</p>
                    <label htmlFor="scriptUrl" className="block text-sm font-medium text-gray-400 mb-1">Google Apps Script URL</label>
                    <input id="scriptUrl" type="text" value={tempScriptUrl} onChange={(e) => setTempScriptUrl(e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded-md px-3 py-2 text-white mb-4" />
                    <div className="flex justify-end space-x-2">
                        <button onClick={() => setViewMode('chat')} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold">Cancel</button>
                        <button onClick={handleSaveSettings} className="px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-bold">Save URL</button>
                    </div>
                    <button onClick={handleSyncToSheet} disabled={!googleScriptUrl} className="mt-4 px-4 py-2 rounded-md bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-semibold">
                        Sync All Assistants to Sheet
                    </button>
                    <div className="mt-6 border-t border-gray-600 pt-4">
                        <h3 className="text-lg font-semibold mb-2 text-white">Generate Share Links</h3>
                        <p className="text-sm text-gray-400 mb-4">Select an assistant to generate a shareable link. Assistants must be synced first.</p>
                        {assistants.map(asst => (
                            <div key={asst.id} className="flex items-center justify-between p-2 bg-gray-800 rounded-md mb-2">
                               <span>{asst.name}</span>
                               <button onClick={() => generateShareLink(asst.id)} className="text-sm px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white">Copy Link</button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}
        {(isLoading && !shareStatus) && <div className="flex items-center justify-center h-full text-gray-400">Loading Assistants...</div>}
        {(!currentAssistant && !isLoading && viewMode !== 'new_assistant') && <div className="flex items-center justify-center h-full text-gray-400">Select an assistant or create a new one to begin.</div>}
      </main>
    </div>
  );
};

export default App;