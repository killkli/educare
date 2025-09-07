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
  const [showApiKeySetup, setShowApiKeySetup] = useState(false);

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
    setShowApiKeySetup(true);
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
      <div className='flex items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900'>
        <div className='text-center bg-gray-800/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-700/50 shadow-2xl max-w-md mx-4'>
          <div className='w-16 h-16 mx-auto mb-6 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center'>
            <div className='animate-spin rounded-full h-8 w-8 border-2 border-white border-t-transparent'></div>
          </div>
          <h2 className='text-2xl font-bold text-white mb-2'>載入分享助理</h2>
          <p className='text-gray-300'>正在從雲端獲取助理資料...</p>
          <div className='mt-4 flex items-center justify-center space-x-1'>
            <div className='w-2 h-2 bg-cyan-500 rounded-full animate-pulse'></div>
            <div
              className='w-2 h-2 bg-cyan-500 rounded-full animate-pulse'
              style={{ animationDelay: '0.2s' }}
            ></div>
            <div
              className='w-2 h-2 bg-cyan-500 rounded-full animate-pulse'
              style={{ animationDelay: '0.4s' }}
            ></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4'>
        <div className='text-center max-w-lg mx-auto bg-gray-800/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-700/50 shadow-2xl'>
          <div className='w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-red-500 to-orange-500 rounded-full flex items-center justify-center'>
            <div className='text-white text-3xl'>⚠️</div>
          </div>
          <h2 className='text-2xl font-bold text-white mb-4'>找不到助理</h2>
          <p className='text-gray-300 mb-6 leading-relaxed'>{error}</p>

          {/* 提供解決方案 */}
          <div className='bg-blue-900/30 border border-blue-600/30 rounded-xl p-4 mb-6'>
            <h3 className='text-blue-300 font-semibold mb-2'>💡 可能的解決方案</h3>
            <ul className='text-blue-200 text-sm text-left space-y-1'>
              <li>• 檢查分享連結是否完整</li>
              <li>• 確認助理是否已成功分享到雲端</li>
              <li>• 聯繫分享者重新生成連結</li>
            </ul>
          </div>

          <button
            onClick={() => (window.location.href = '/')}
            className='px-6 py-3 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
          >
            回到首頁
          </button>
        </div>
      </div>
    );
  }

  if (!assistant || !currentSession) {
    return (
      <div className='flex items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900'>
        <div className='text-center bg-gray-800/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-700/50 shadow-2xl max-w-md mx-4'>
          <div className='w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-orange-500 to-red-500 rounded-full flex items-center justify-center'>
            <div className='text-white text-xl'>❌</div>
          </div>
          <h2 className='text-xl font-bold text-white mb-2'>資料載入失敗</h2>
          <p className='text-gray-300 mb-6'>無法載入助理資料，請稍後重試。</p>
          <button
            onClick={() => window.location.reload()}
            className='px-4 py-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-lg font-medium transition-all duration-200'
          >
            重新載入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='h-screen bg-gray-900 flex flex-col'>
      {/* API 金鑰解密模態對話框 */}
      {showApiKeyInput && (
        <div className='fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4'>
          <div className='bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-8 max-w-lg w-full shadow-2xl border border-gray-700/50'>
            <div className='text-center mb-6'>
              <div className='w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center'>
                <div className='text-white text-2xl'>🔑</div>
              </div>
              <h3 className='text-2xl font-bold text-white mb-2'>使用分享的 API 金鑰</h3>
              <p className='text-gray-300 text-sm'>
                分享者已提供 API 金鑰，讓您無需配置即可開始聊天
              </p>
            </div>

            <div className='space-y-6'>
              <div className='bg-gradient-to-r from-blue-900/50 to-cyan-900/50 border border-blue-600/30 rounded-xl p-4'>
                <div className='flex items-start space-x-3'>
                  <div className='text-blue-400 text-xl'>📋</div>
                  <div>
                    <h4 className='text-blue-300 font-semibold mb-1'>分享者提供了 API 金鑰</h4>
                    <p className='text-blue-200 text-sm leading-relaxed'>
                      輸入解密密碼即可直接開始與 <strong>{assistant?.name || '助理'}</strong>{' '}
                      聊天，無需自己配置 API 金鑰。
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-300 mb-3'>🔐 解密密碼</label>
                <input
                  type='password'
                  value={decryptPassword}
                  onChange={e => setDecryptPassword(e.target.value)}
                  placeholder='請輸入分享者提供的密碼'
                  className='w-full bg-gray-700/50 border border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200'
                  onKeyPress={e => {
                    if (e.key === 'Enter') {
                      handleDecryptApiKeys();
                    }
                  }}
                />
              </div>

              <div className='bg-gradient-to-r from-yellow-900/50 to-orange-900/50 border border-yellow-600/30 rounded-xl p-4'>
                <div className='flex items-start space-x-3'>
                  <div className='text-yellow-400 text-lg'>💡</div>
                  <div>
                    <h4 className='text-yellow-300 font-semibold mb-1'>沒有密碼？</h4>
                    <p className='text-yellow-200 text-sm leading-relaxed'>
                      您也可以跳過此步驟，稍後使用自己的 Gemini API 金鑰配置。
                      <br />
                      <a
                        href='https://aistudio.google.com/app/apikey'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-yellow-100 underline hover:text-white transition-colors'
                      >
                        點此獲取免費的 Gemini API 金鑰 →
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className='flex space-x-3 mt-8'>
              <button
                onClick={handleSkipApiKeys}
                className='flex-1 px-6 py-3 text-gray-300 hover:text-white transition-all duration-200 border border-gray-600/50 rounded-xl hover:border-gray-500 hover:bg-gray-700/30 font-medium'
              >
                跳過，稍後配置
              </button>
              <button
                onClick={handleDecryptApiKeys}
                disabled={isDecrypting || !decryptPassword.trim()}
                className='flex-1 px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none'
              >
                {isDecrypting ? (
                  <div className='flex items-center justify-center space-x-2'>
                    <div className='animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></div>
                    <span>解密中...</span>
                  </div>
                ) : (
                  '🚀 使用分享金鑰'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Key 設定指引模態框 */}
      {showApiKeySetup && (
        <div className='fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4'>
          <div className='bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-8 max-w-2xl w-full shadow-2xl border border-gray-700/50 max-h-[90vh] overflow-y-auto'>
            <div className='text-center mb-8'>
              <div className='w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center'>
                <div className='text-white text-3xl'>⚙️</div>
              </div>
              <h3 className='text-3xl font-bold text-white mb-3'>設定 API 金鑰</h3>
              <p className='text-gray-300 text-lg'>配置您的 Gemini API 金鑰以開始與助理聊天</p>
            </div>

            <div className='space-y-6'>
              {/* 步驟 1: 獲取 API Key */}
              <div className='bg-gradient-to-r from-green-900/50 to-emerald-900/50 border border-green-600/30 rounded-xl p-6'>
                <div className='flex items-start space-x-4'>
                  <div className='w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0'>
                    1
                  </div>
                  <div className='flex-1'>
                    <h4 className='text-green-300 font-bold text-lg mb-2'>🔑 獲取免費 API 金鑰</h4>
                    <p className='text-green-200 text-sm mb-4 leading-relaxed'>
                      前往 Google AI Studio 獲取您的免費 Gemini API 金鑰：
                    </p>
                    <a
                      href='https://aistudio.google.com/app/apikey'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-all duration-200 space-x-2'
                    >
                      <span>🚀 前往 Google AI Studio</span>
                      <svg
                        className='w-4 h-4'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='2'
                          d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'
                        ></path>
                      </svg>
                    </a>
                  </div>
                </div>
              </div>

              {/* 步驟 2: 複製金鑰 */}
              <div className='bg-gradient-to-r from-blue-900/50 to-cyan-900/50 border border-blue-600/30 rounded-xl p-6'>
                <div className='flex items-start space-x-4'>
                  <div className='w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0'>
                    2
                  </div>
                  <div className='flex-1'>
                    <h4 className='text-blue-300 font-bold text-lg mb-2'>📋 複製 API 金鑰</h4>
                    <p className='text-blue-200 text-sm mb-3 leading-relaxed'>
                      在 Google AI Studio 中創建新的 API 金鑰並複製它
                    </p>
                    <div className='bg-blue-800/30 rounded-lg p-3 border-l-4 border-blue-500'>
                      <p className='text-blue-100 text-xs font-mono'>AIzaSyExample123456789...</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 步驟 3: 設定金鑰 */}
              <div className='bg-gradient-to-r from-purple-900/50 to-pink-900/50 border border-purple-600/30 rounded-xl p-6'>
                <div className='flex items-start space-x-4'>
                  <div className='w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0'>
                    3
                  </div>
                  <div className='flex-1'>
                    <h4 className='text-purple-300 font-bold text-lg mb-2'>⚙️ 在應用中設定</h4>
                    <p className='text-purple-200 text-sm mb-4 leading-relaxed'>
                      回到主應用，點擊「設定與分享」按鈕，將 API 金鑰貼到設定頁面中
                    </p>
                    <div className='flex flex-wrap gap-2 text-xs'>
                      <span className='px-2 py-1 bg-purple-600/30 text-purple-200 rounded'>
                        主頁面
                      </span>
                      <span className='text-purple-400'>→</span>
                      <span className='px-2 py-1 bg-purple-600/30 text-purple-200 rounded'>
                        設定與分享
                      </span>
                      <span className='text-purple-400'>→</span>
                      <span className='px-2 py-1 bg-purple-600/30 text-purple-200 rounded'>
                        API 設定
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className='mt-8 bg-yellow-900/30 border border-yellow-600/30 rounded-xl p-4'>
              <div className='flex items-start space-x-3'>
                <div className='text-yellow-400 text-lg'>💡</div>
                <div>
                  <h4 className='text-yellow-300 font-semibold mb-1'>小提示</h4>
                  <p className='text-yellow-200 text-sm leading-relaxed'>
                    API
                    金鑰是免費的，每月有慷慨的使用額度。設定完成後，您就可以與所有分享的助理進行聊天了！
                  </p>
                </div>
              </div>
            </div>

            <div className='flex space-x-4 mt-8'>
              <button
                onClick={() => setShowApiKeySetup(false)}
                className='flex-1 px-6 py-3 text-gray-300 hover:text-white transition-all duration-200 border border-gray-600/50 rounded-xl hover:border-gray-500 hover:bg-gray-700/30 font-medium'
              >
                稍後設定
              </button>
              <button
                onClick={() => (window.location.href = '/')}
                className='flex-1 px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
              >
                🏠 前往主頁設定
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
