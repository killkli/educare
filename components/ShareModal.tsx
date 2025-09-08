import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { Assistant } from '../types';
import { CryptoService } from '../services/cryptoService';
import { ApiKeyManager } from '../services/apiKeyManager';
import { saveAssistantToTurso } from '../services/tursoService';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  assistant: Assistant;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, assistant }) => {
  const [shareUrl, setShareUrl] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [shareWithApiKeys, setShareWithApiKeys] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [shareStatus, setShareStatus] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // 生成分享連結
  const generateShareLink = useCallback(async () => {
    setIsGenerating(true);
    setShareStatus(null);

    try {
      // 將助理儲存到 Turso
      await saveAssistantToTurso({
        id: assistant.id,
        name: assistant.name,
        description: assistant.description || '', // 確保 description 不為 undefined
        systemPrompt: assistant.systemPrompt,
        createdAt: assistant.createdAt || Date.now(), // 確保 createdAt 已設定
      });

      let url = `${window.location.origin}${window.location.pathname}?share=${assistant.id}`;

      if (shareWithApiKeys) {
        if (!sharePassword.trim()) {
          setShareStatus({
            type: 'error',
            message: '分享 API 金鑰時需要設定密碼。',
          });
          setIsGenerating(false);
          return;
        }

        // 獲取當前用戶的 API 金鑰
        const userApiKeys = ApiKeyManager.getUserApiKeys();

        if (!userApiKeys.geminiApiKey && !userApiKeys.tursoWriteApiKey) {
          setShareStatus({
            type: 'error',
            message: '沒有可分享的 API 金鑰。請先在設定中配置您的 API 金鑰。',
          });
          setIsGenerating(false);
          return;
        }

        // 加密 API 金鑰
        const encryptedApiKeys = await CryptoService.encryptApiKeys(userApiKeys, sharePassword);
        url += `&keys=${encryptedApiKeys}`;
      }

      setShareUrl(url);

      // 生成 QR Code
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: {
          dark: '#1f2937',
          light: '#ffffff',
        },
      });
      setQrCodeDataUrl(qrDataUrl);

      setShareStatus({
        type: 'success',
        message: '分享連結生成成功！',
      });
    } catch (error) {
      console.error('生成分享連結失敗:', error.message, error);
      setShareStatus({
        type: 'error',
        message: `生成分享連結失敗，請檢查 Turso 配置並稍後再試。錯誤: ${error.message}`,
      });
    } finally {
      setIsGenerating(false);
    }
  }, [
    assistant.id,
    shareWithApiKeys,
    sharePassword,
    assistant.name,
    assistant.description,
    assistant.systemPrompt,
    assistant.createdAt,
  ]);

  // 複製到剪貼簿
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus({
        type: 'success',
        message: '連結已複製到剪貼簿！',
      });
      setTimeout(() => setShareStatus(null), 3000);
    } catch {
      setShareStatus({
        type: 'error',
        message: '複製失敗，請手動複製連結。',
      });
    }
  };

  // 下載 QR Code
  const handleDownloadQR = () => {
    const link = document.createElement('a');
    link.download = `${assistant.name}-share-qr.png`;
    link.href = qrCodeDataUrl;
    link.click();
  };

  // Modal 打開時自動生成基本分享連結
  useEffect(() => {
    if (isOpen && assistant) {
      generateShareLink();
    }
  }, [isOpen, assistant, generateShareLink]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className='fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4'>
      <div className='bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-8 max-w-2xl w-full shadow-2xl border border-gray-700/50 max-h-[90vh] overflow-y-auto'>
        {/* Header */}
        <div className='flex items-center justify-between mb-6'>
          <div>
            <h2 className='text-2xl font-bold text-white mb-1'>分享助理</h2>
            <p className='text-gray-300'>
              分享 <span className='text-cyan-400 font-medium'>{assistant.name}</span> 給其他人使用
            </p>
          </div>
          <button
            onClick={onClose}
            className='p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50 transition-colors'
          >
            <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        </div>

        {/* QR Code 顯示區域 */}
        {qrCodeDataUrl && (
          <div className='mb-8 text-center'>
            <div className='inline-block bg-white p-4 rounded-2xl shadow-lg'>
              <img src={qrCodeDataUrl} alt='分享 QR Code' className='w-64 h-64 mx-auto' />
            </div>
            <p className='text-gray-400 text-sm mt-3'>掃描 QR Code 或複製下方連結</p>
          </div>
        )}

        {/* 分享連結 */}
        <div className='mb-6'>
          <label className='block text-sm font-medium text-gray-300 mb-2'>分享連結</label>
          <div className='flex gap-2'>
            <input
              type='text'
              value={shareUrl}
              readOnly
              className='flex-1 bg-gray-700/50 border border-gray-600/50 rounded-xl px-4 py-3 text-white text-sm font-mono'
            />
            <button
              onClick={handleCopyLink}
              className='px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl font-medium transition-all duration-200 flex items-center gap-2'
            >
              <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
                />
              </svg>
              複製
            </button>
          </div>
        </div>

        {/* API 金鑰分享選項 */}
        <div className='mb-6 bg-gray-700/30 rounded-xl p-6'>
          <div className='flex items-center space-x-3 mb-4'>
            <input
              type='checkbox'
              id='shareWithApiKeys'
              checked={shareWithApiKeys}
              onChange={e => setShareWithApiKeys(e.target.checked)}
              className='w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500'
            />
            <label htmlFor='shareWithApiKeys' className='text-white font-medium'>
              包含我的 API 金鑰（讓接收者無需配置即可使用）
            </label>
          </div>

          {shareWithApiKeys && (
            <div className='space-y-4'>
              <div>
                <label className='block text-sm text-gray-400 mb-2'>加密密碼</label>
                <div className='flex gap-2'>
                  <input
                    type='text'
                    value={sharePassword}
                    onChange={e => setSharePassword(e.target.value)}
                    className='flex-1 bg-gray-600 border border-gray-500 rounded-lg px-3 py-2 text-white text-sm'
                    placeholder='設定密碼'
                  />
                  <button
                    onClick={() => setSharePassword(CryptoService.generateRandomPassword())}
                    className='px-3 py-2 bg-gray-500 hover:bg-gray-400 text-white rounded-lg text-sm'
                  >
                    重新生成
                  </button>
                </div>
              </div>
              <div className='bg-yellow-900/30 border border-yellow-600/30 rounded-lg p-3'>
                <p className='text-yellow-200 text-xs'>
                  ⚠️ 請將密碼 <code className='bg-yellow-800/50 px-1 rounded'>{sharePassword}</code>{' '}
                  與分享連結分開傳送給接收者
                </p>
              </div>
              <button
                onClick={generateShareLink}
                disabled={isGenerating}
                className='w-full py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-lg font-medium transition-all duration-200 disabled:opacity-50'
              >
                {isGenerating ? '生成中...' : '🔐 重新生成加密分享連結'}
              </button>
            </div>
          )}
        </div>

        {/* 狀態訊息 */}
        {shareStatus && (
          <div
            className={`mb-6 p-4 rounded-xl border ${
              shareStatus.type === 'success'
                ? 'bg-green-900/30 border-green-600/30 text-green-200'
                : shareStatus.type === 'error'
                  ? 'bg-red-900/30 border-red-600/30 text-red-200'
                  : 'bg-blue-900/30 border-blue-600/30 text-blue-200'
            }`}
          >
            <p className='text-sm flex items-center gap-2'>
              <span>
                {shareStatus.type === 'success' && '✅'}
                {shareStatus.type === 'error' && '❌'}
                {shareStatus.type === 'info' && 'ℹ️'}
              </span>
              {shareStatus.message}
            </p>
          </div>
        )}

        {/* 底部按鈕 */}
        <div className='flex gap-3'>
          <button
            onClick={handleDownloadQR}
            disabled={!qrCodeDataUrl}
            className='flex-1 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white rounded-xl font-medium transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2'
          >
            <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
              />
            </svg>
            下載 QR Code
          </button>
          <button
            onClick={onClose}
            className='flex-1 py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-xl font-medium transition-all duration-200'
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};
