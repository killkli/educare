import React, { useState, useEffect } from 'react';
import { Assistant, ChatSession } from '../types';
import ChatWindow from './ChatWindow';
import { getAssistantFromTurso } from '../services/tursoService';

interface SharedAssistantProps {
  assistantId: string;
}

const SharedAssistant: React.FC<SharedAssistantProps> = ({ assistantId }) => {
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSharedAssistant = async () => {
      setIsLoading(true);
      try {
        // 從 Turso 載入分享的 Assistant
        const tursoAssistant = await getAssistantFromTurso(assistantId);

        if (!tursoAssistant) {
          setError('Assistant not found or not available for sharing.');
          return;
        }

        // 轉換為本地 Assistant 格式（但不需要 ragChunks，因為會直接從 Turso 查詢）
        const sharedAssistant: Assistant = {
          id: tursoAssistant.id,
          name: tursoAssistant.name,
          description: tursoAssistant.description,
          systemPrompt: tursoAssistant.systemPrompt,
          ragChunks: [], // 空陣列，因為會直接使用 Turso 向量搜尋
          createdAt: tursoAssistant.createdAt,
        };

        setAssistant(sharedAssistant);

        // 創建一個臨時的聊天會話（不會保存到本地）
        const tempSession: ChatSession = {
          id: `shared_${Date.now()}`,
          assistantId: tursoAssistant.id,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          totalTokenCount: 0,
        };

        setCurrentSession(tempSession);
      } catch (err) {
        console.error('Failed to load shared assistant:', err);
        setError('Failed to load the shared assistant. Please check the link.');
      } finally {
        setIsLoading(false);
      }
    };

    loadSharedAssistant();
  }, [assistantId]);

  const handleNewMessage = async (
    updatedSession: ChatSession,
    _userMessage: string,
    _modelResponse: string,
    _tokenInfo: { promptTokenCount: number; candidatesTokenCount: number }
  ) => {
    // ChatWindow 現在會傳遞已經更新好的 session，我們只需要設置它
    setCurrentSession({
      ...updatedSession,
      updatedAt: Date.now(),
    });
  };

  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-screen bg-gray-900'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4'></div>
          <p className='text-gray-400'>Loading shared assistant...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center h-screen bg-gray-900'>
        <div className='text-center max-w-md mx-auto px-6'>
          <div className='text-red-500 text-6xl mb-4'>⚠️</div>
          <h2 className='text-2xl font-bold text-white mb-4'>Assistant Not Found</h2>
          <p className='text-gray-400 mb-6'>{error}</p>
          <p className='text-sm text-gray-500'>
            Please check the sharing link or contact the person who shared this assistant with you.
          </p>
        </div>
      </div>
    );
  }

  if (!assistant || !currentSession) {
    return (
      <div className='flex items-center justify-center h-screen bg-gray-900'>
        <div className='text-center'>
          <p className='text-gray-400'>Unable to load assistant data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className='h-screen bg-gray-900 flex flex-col'>
      {/* Integrated Header + Chat */}
      <ChatWindow
        session={currentSession}
        assistantName={assistant.name}
        systemPrompt={assistant.systemPrompt}
        assistantId={assistant.id}
        ragChunks={assistant.ragChunks}
        onNewMessage={handleNewMessage}
        hideHeader={true}
        sharedMode={true}
        assistantDescription={assistant.description}
      />
    </div>
  );
};

export default SharedAssistant;
