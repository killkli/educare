import React, { useState, useEffect } from 'react';
import { Assistant, ChatSession } from '../types';
import ChatWindow from './ChatWindow';
import { getAssistantFromTurso } from '../services/tursoService';
import { CryptoService } from '../services/cryptoService';
import { ApiKeyManager } from '../services/apiKeyManager';

interface SharedAssistantProps {
  assistantId: string;
}

const SharedAssistant: React.FC<SharedAssistantProps> = ({ assistantId }) => {
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [decryptPassword, setDecryptPassword] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);

  useEffect(() => {
    const loadSharedAssistant = async () => {
      setIsLoading(true);
      try {
        // 檢查 URL 中是否包含加密的 API 金鑰
        const encryptedKeys = CryptoService.extractKeysFromUrl();
        if (encryptedKeys) {
          setShowApiKeyInput(true);
        }

        // 從 Turso 載入分享的 Assistant
        const tursoAssistant = await getAssistantFromTurso(assistantId);

        if (!tursoAssistant) {
          setError('找不到助理或無法分享。');
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
          title: '分享助理聊天',
          messages: [],
          createdAt: Date.now(),
          tokenCount: 0,
        };

        setCurrentSession(tempSession);
      } catch (err) {
        console.error('Failed to load shared assistant:', err);
        setError('無法載入分享的助理。請檢查連結。');
      } finally {
        setIsLoading(false);
      }
    };

    loadSharedAssistant();
  }, [assistantId]);

  const handleDecryptApiKeys = async () => {
    if (!decryptPassword.trim()) {
      alert('請輸入解密密碼');
      return;
    }

    const encryptedKeys = CryptoService.extractKeysFromUrl();
    if (!encryptedKeys) {
      alert('URL 中沒有找到加密的 API 金鑰');
      return;
    }

    setIsDecrypting(true);
    try {
      const decryptedKeys = await CryptoService.decryptApiKeys(encryptedKeys, decryptPassword);

      // 暫時設定這些 API 金鑰（僅在當前會話中生效）
      ApiKeyManager.setUserApiKeys(decryptedKeys);

      setShowApiKeyInput(false);
      setDecryptPassword('');

      // 不清除 URL 參數，因為其他人可能還需要這個連結
      alert('API 金鑰導入成功！現在您可以開始聊天了。');
    } catch (error) {
      console.error('解密失敗:', error);
      alert('解密失敗：' + error.message + '\n請檢查密碼是否正確。');
    } finally {
      setIsDecrypting(false);
    }
  };

  const handleSkipApiKeys = () => {
    setShowApiKeyInput(false);
    // 用戶選擇跳過，但提示需要配置 API 金鑰
    alert('您可以稍後在設定中配置自己的 API 金鑰來使用聊天功能。');
  };

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
          <p className='text-gray-400'>載入分享的助理...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center h-screen bg-gray-900'>
        <div className='text-center max-w-md mx-auto px-6'>
          <div className='text-red-500 text-6xl mb-4'>⚠️</div>
          <h2 className='text-2xl font-bold text-white mb-4'>找不到助理</h2>
          <p className='text-gray-400 mb-6'>{error}</p>
          <p className='text-sm text-gray-500'>請檢查分享連結或聯繫與您分享此助理的人員。</p>
        </div>
      </div>
    );
  }

  if (!assistant || !currentSession) {
    return (
      <div className='flex items-center justify-center h-screen bg-gray-900'>
        <div className='text-center'>
          <p className='text-gray-400'>無法載入助理資料。</p>
        </div>
      </div>
    );
  }

  return (
    <div className='h-screen bg-gray-900 flex flex-col'>
      {/* API 金鑰解密模態對話框 */}
      {showApiKeyInput && (
        <div className='fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50'>
          <div className='bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4'>
            <h3 className='text-xl font-bold text-white mb-4'>🔑 使用分享的 API 金鑰</h3>

            <div className='space-y-4'>
              <div className='bg-blue-800 bg-opacity-30 border border-blue-600 rounded-md p-3'>
                <p className='text-blue-200 text-sm'>
                  📋 <strong>分享者提供了 API 金鑰</strong>
                  <br />
                  輸入解密密碼即可直接開始與 {assistant?.name || '助理'} 聊天，無需自己配置 API
                  金鑰。
                </p>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>解密密碼</label>
                <input
                  type='password'
                  value={decryptPassword}
                  onChange={e => setDecryptPassword(e.target.value)}
                  placeholder='請輸入分享者提供的密碼'
                  className='w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-cyan-500 focus:border-cyan-500'
                  onKeyPress={e => {
                    if (e.key === 'Enter') {
                      handleDecryptApiKeys();
                    }
                  }}
                />
              </div>

              <div className='bg-yellow-800 bg-opacity-30 border border-yellow-600 rounded-md p-3'>
                <p className='text-yellow-200 text-xs'>
                  ⚠️ 如果您沒有收到密碼，您也可以跳過此步驟，稍後使用自己的 API 金鑰配置。
                </p>
              </div>
            </div>

            <div className='flex space-x-3 mt-6'>
              <button
                onClick={handleSkipApiKeys}
                className='flex-1 px-4 py-2 text-gray-400 hover:text-white transition-colors border border-gray-600 rounded-md'
              >
                跳過
              </button>
              <button
                onClick={handleDecryptApiKeys}
                disabled={isDecrypting || !decryptPassword.trim()}
                className='flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              >
                {isDecrypting ? '解密中...' : '使用分享金鑰'}
              </button>
            </div>
          </div>
        </div>
      )}

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
