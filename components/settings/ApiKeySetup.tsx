import React, { useState, useEffect } from 'react';
import { ApiKeyManager, UserApiKeys } from '../../services/apiKeyManager';
import { CryptoService } from '../../services/cryptoService';

interface ApiKeySetupProps {
  onComplete?: () => void;
  onCancel?: () => void;
  showTitle?: boolean;
}

const ApiKeySetup: React.FC<ApiKeySetupProps> = ({ onComplete, onCancel, showTitle = true }) => {
  const [apiKeys, setApiKeys] = useState<UserApiKeys>({});
  const [errors, setErrors] = useState<Partial<UserApiKeys>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [sharePassword, setSharePassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    // 載入已存在的 API KEY
    setApiKeys(ApiKeyManager.getUserApiKeys());

    // 檢查 URL 中是否有分享的金鑰
    const encryptedKeys = CryptoService.extractKeysFromUrl();
    if (encryptedKeys) {
      setIsImporting(true);
    }
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

  const handleShare = async () => {
    if (!apiKeys.geminiApiKey && !apiKeys.tursoWriteApiKey) {
      alert('沒有可分享的 API 金鑰');
      return;
    }

    setIsSharing(true);
    try {
      // 生成隨機密碼
      const password = CryptoService.generateRandomPassword();

      // 加密 API 金鑰 - Filter out undefined values
      const filteredApiKeys = Object.fromEntries(
        Object.entries(apiKeys).filter(([_, value]) => value !== undefined),
      ) as Record<string, string>;
      const encryptedData = await CryptoService.encryptApiKeys(filteredApiKeys, password);

      // 生成分享 URL
      const url = CryptoService.generateSharingUrl(encryptedData, password);

      setShareUrl(url);
      setSharePassword(password);
      setShowShareModal(true);
    } catch (error) {
      console.error('生成分享連結失敗:', error);
      alert('生成分享連結失敗，請稍後再試');
    } finally {
      setIsSharing(false);
    }
  };

  const handleImportFromUrl = async () => {
    if (!importPassword.trim()) {
      alert('請輸入解密密碼');
      return;
    }

    const encryptedKeys = CryptoService.extractKeysFromUrl();
    if (!encryptedKeys) {
      alert('URL 中沒有找到加密的 API 金鑰');
      return;
    }

    try {
      const decryptedKeys = await CryptoService.decryptApiKeys(encryptedKeys, importPassword);

      // 合併現有的金鑰
      const mergedKeys = { ...apiKeys, ...decryptedKeys };
      setApiKeys(mergedKeys);

      // 清除 URL 參數
      const url = new URL(window.location.href);
      url.searchParams.delete('keys');
      window.history.replaceState({}, document.title, url.toString());

      setIsImporting(false);
      setImportPassword('');

      alert('API 金鑰導入成功！');

      // 自動完成設定並切換到 chat 模式
      onComplete?.();
    } catch (error) {
      console.error('導入失敗:', error);
      alert('導入失敗：' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('已複製到剪貼簿');
    } catch (error) {
      console.error('複製失敗:', error);
      // 備用複製方法
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert('已複製到剪貼簿');
    }
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
            onChange={e =>
              setApiKeys((prev: UserApiKeys) => ({ ...prev, geminiApiKey: e.target.value }))
            }
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
            onChange={e =>
              setApiKeys((prev: UserApiKeys) => ({ ...prev, tursoWriteApiKey: e.target.value }))
            }
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

        {/* 分享和導入區塊 */}
        <div className='border-t border-gray-700 pt-4'>
          <h3 className='text-lg font-semibold text-white mb-4'>🔗 分享與導入</h3>
          <p className='text-sm text-gray-400 mb-4'>
            安全地分享您的 API 金鑰給其他人，或從分享連結導入金鑰。所有數據都會使用 AES-256 加密。
          </p>

          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            {/* 分享區塊 */}
            <div className='bg-gray-700 rounded-lg p-4'>
              <h4 className='font-semibold text-white mb-2'>分享 API 金鑰</h4>
              <p className='text-xs text-gray-400 mb-3'>
                生成加密的分享連結，包含您的 Gemini 和 Turso API 金鑰
              </p>
              <button
                onClick={handleShare}
                disabled={isSharing || (!apiKeys.geminiApiKey && !apiKeys.tursoWriteApiKey)}
                className='w-full px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              >
                {isSharing ? '生成中...' : '生成分享連結'}
              </button>
            </div>

            {/* 導入區塊 */}
            {isImporting && (
              <div className='bg-blue-800 bg-opacity-30 border border-blue-600 rounded-lg p-4'>
                <h4 className='font-semibold text-blue-200 mb-2'>🔑 發現分享的金鑰</h4>
                <p className='text-xs text-blue-200 mb-3'>請輸入解密密碼來導入分享的 API 金鑰</p>
                <input
                  type='password'
                  value={importPassword}
                  onChange={e => setImportPassword(e.target.value)}
                  placeholder='輸入解密密碼'
                  className='w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white text-sm mb-3 focus:ring-cyan-500 focus:border-cyan-500'
                />
                <div className='flex space-x-2'>
                  <button
                    onClick={handleImportFromUrl}
                    disabled={!importPassword.trim()}
                    className='flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm'
                  >
                    導入金鑰
                  </button>
                  <button
                    onClick={() => {
                      setIsImporting(false);
                      setImportPassword('');
                      // 清除 URL 參數
                      const url = new URL(window.location.href);
                      url.searchParams.delete('keys');
                      window.history.replaceState({}, document.title, url.toString());
                    }}
                    className='px-3 py-2 text-gray-400 hover:text-white transition-colors text-sm'
                  >
                    忽略
                  </button>
                </div>
              </div>
            )}
          </div>
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

      {/* 分享模態對話框 */}
      {showShareModal && (
        <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
          <div className='bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4'>
            <h3 className='text-xl font-bold text-white mb-4'>🔗 分享 API 金鑰</h3>

            <div className='space-y-4'>
              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>分享連結</label>
                <div className='flex space-x-2'>
                  <input
                    type='text'
                    value={shareUrl}
                    readOnly
                    className='flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white text-xs font-mono'
                  />
                  <button
                    onClick={() => copyToClipboard(shareUrl)}
                    className='px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors text-xs'
                  >
                    複製
                  </button>
                </div>
              </div>

              <div>
                <label className='block text-sm font-medium text-gray-400 mb-2'>解密密碼</label>
                <div className='flex space-x-2'>
                  <input
                    type='text'
                    value={sharePassword}
                    readOnly
                    className='flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white font-mono'
                  />
                  <button
                    onClick={() => copyToClipboard(sharePassword)}
                    className='px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors text-xs'
                  >
                    複製
                  </button>
                </div>
              </div>

              <div className='bg-yellow-800 bg-opacity-30 border border-yellow-600 rounded-md p-3'>
                <p className='text-yellow-200 text-xs'>
                  ⚠️ <strong>安全提醒</strong>
                  ：請分別傳送連結和密碼給接收者，不要在同一個訊息中包含兩者。
                </p>
              </div>
            </div>

            <div className='flex justify-end mt-6'>
              <button
                onClick={() => {
                  setShowShareModal(false);
                  setShareUrl('');
                  setSharePassword('');
                }}
                className='px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors'
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiKeySetup;
