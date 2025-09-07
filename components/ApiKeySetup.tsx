import React, { useState, useEffect } from 'react';
import { ApiKeyManager, UserApiKeys } from '../services/apiKeyManager';

interface ApiKeySetupProps {
  onComplete?: () => void;
  onCancel?: () => void;
  showTitle?: boolean;
}

const ApiKeySetup: React.FC<ApiKeySetupProps> = ({ onComplete, onCancel, showTitle = true }) => {
  const [apiKeys, setApiKeys] = useState<UserApiKeys>({});
  const [errors, setErrors] = useState<Partial<UserApiKeys>>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // 載入已存在的 API KEY
    setApiKeys(ApiKeyManager.getUserApiKeys());
  }, []);

  const validateInputs = (): boolean => {
    const newErrors: Partial<UserApiKeys> = {};

    // 驗證 Gemini API KEY
    if (apiKeys.geminiApiKey && !ApiKeyManager.validateGeminiApiKey(apiKeys.geminiApiKey)) {
      newErrors.geminiApiKey = 'Gemini API KEY 格式不正確（應以 AIzaSy 開頭）';
    }

    // 驗證 Turso API KEY（只需要驗證 API KEY，URL 是共用的）
    if (apiKeys.tursoWriteApiKey && !ApiKeyManager.validateTursoApiKey(apiKeys.tursoWriteApiKey)) {
      newErrors.tursoWriteApiKey = 'Turso API KEY 格式不正確';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateInputs()) {
      return;
    }

    setIsLoading(true);
    try {
      ApiKeyManager.setUserApiKeys(apiKeys);
      onComplete?.();
    } catch (error) {
      console.error('保存 API KEY 時發生錯誤:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setApiKeys({});
    ApiKeyManager.clearUserApiKeys();
  };

  return (
    <div className='bg-gray-800 p-6 rounded-lg max-w-2xl mx-auto'>
      {showTitle && <h2 className='text-2xl font-bold mb-6 text-white'>API 金鑰設定</h2>}

      <div className='space-y-6'>
        {/* 說明文字 */}
        <div className='bg-blue-800 bg-opacity-30 border border-blue-600 rounded-md p-4'>
          <h3 className='text-blue-200 font-semibold mb-2'>🔐 關於 API 金鑰</h3>
          <ul className='text-blue-200 text-sm space-y-1'>
            <li>
              • <strong>Gemini API KEY</strong>：用於 AI 聊天功能
            </li>
            <li>
              • <strong>Turso 寫入權限</strong>：用於建立和分享助理設定與 RAG 知識庫
            </li>
            <li>• 系統內建共用資料庫，所有人都可以讀取分享的助理</li>
            <li>• 所有金鑰僅儲存在您的瀏覽器本地，不會上傳到伺服器</li>
            <li>• 您可以隨時修改或清除這些設定</li>
          </ul>
        </div>

        {/* Gemini API KEY */}
        <div>
          <label htmlFor='geminiApiKey' className='block text-sm font-medium text-gray-400 mb-2'>
            Gemini API KEY
            <span className='text-xs text-gray-500 ml-2'>(選填 - 用於 AI 聊天)</span>
          </label>
          <input
            type='password'
            id='geminiApiKey'
            value={apiKeys.geminiApiKey || ''}
            onChange={e => setApiKeys(prev => ({ ...prev, geminiApiKey: e.target.value }))}
            className='w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-cyan-500 focus:border-cyan-500'
            placeholder='AIzaSy...'
          />
          {errors.geminiApiKey && (
            <p className='text-red-400 text-sm mt-1'>{errors.geminiApiKey}</p>
          )}
          <p className='text-xs text-gray-500 mt-1'>
            從{' '}
            <a
              href='https://aistudio.google.com/app/apikey'
              target='_blank'
              rel='noopener noreferrer'
              className='text-cyan-400 hover:underline'
            >
              Google AI Studio
            </a>{' '}
            獲取
          </p>
        </div>

        <div className='border-t border-gray-700 pt-4'>
          <h3 className='text-lg font-semibold text-white mb-4'>Turso 寫入權限配置</h3>
          <p className='text-sm text-gray-400 mb-4'>
            用於建立和分享助理設定與 RAG 知識庫。系統使用共用資料庫，您只需提供具有寫入權限的 API
            Token。
          </p>
        </div>

        <div>
          <label htmlFor='tursoApiKey' className='block text-sm font-medium text-gray-400 mb-2'>
            Turso 寫入權限 API Token
            <span className='text-xs text-gray-500 ml-2'>(選填 - 用於建立助理)</span>
          </label>
          <textarea
            id='tursoApiKey'
            value={apiKeys.tursoWriteApiKey || ''}
            onChange={e => setApiKeys(prev => ({ ...prev, tursoWriteApiKey: e.target.value }))}
            rows={3}
            className='w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-cyan-500 focus:border-cyan-500 font-mono text-xs'
            placeholder='eyJhbGciOiJFZERTQSI...'
          />
          {errors.tursoWriteApiKey && (
            <p className='text-red-400 text-sm mt-1'>{errors.tursoWriteApiKey}</p>
          )}
          <p className='text-xs text-gray-500 mt-1'>
            從{' '}
            <a
              href='https://app.turso.tech/'
              target='_blank'
              rel='noopener noreferrer'
              className='text-cyan-400 hover:underline'
            >
              Turso Dashboard
            </a>{' '}
            獲取具有寫入權限的 API Token。無需提供 URL，系統使用共用資料庫。
          </p>
        </div>

        <div className='flex justify-between items-center pt-4 border-t border-gray-700'>
          <button
            onClick={handleClear}
            className='px-4 py-2 text-gray-400 hover:text-white transition-colors'
            disabled={isLoading}
          >
            清除所有設定
          </button>

          <div className='flex space-x-3'>
            {onCancel && (
              <button
                onClick={onCancel}
                className='px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white transition-colors'
                disabled={isLoading}
              >
                取消
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={isLoading}
              className='px-6 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-colors disabled:opacity-50'
            >
              {isLoading ? '儲存中...' : '儲存設定'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeySetup;
