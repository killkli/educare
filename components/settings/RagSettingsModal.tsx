import React, { useState, useEffect } from 'react';
import { getRagSettingsService } from '../../services/ragSettingsService';
import { RagSettings } from '../../types';

interface RagSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const RagSettingsModal: React.FC<RagSettingsModalProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState<RagSettings>({
    vectorSearchLimit: 20,
    enableReranking: false,
    rerankLimit: 5,
    minSimilarity: 0.3,
  });
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // 當模態框打開時載入當前設定
      const ragService = getRagSettingsService();
      const currentSettings = ragService.getSettings();
      setSettings(currentSettings);
      setHasChanges(false);
    }
  }, [isOpen]);

  const handleSettingChange = (key: keyof RagSettings, value: number | boolean) => {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      setHasChanges(true);
      return newSettings;
    });
  };

  const handleSave = () => {
    const ragService = getRagSettingsService();
    ragService.updateSettings(settings);
    setHasChanges(false);
    onClose();
  };

  const handleReset = () => {
    const ragService = getRagSettingsService();
    ragService.resetToDefaults();
    setSettings(ragService.getSettings());
    setHasChanges(false);
  };

  const handleCancel = () => {
    setHasChanges(false);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'
      onClick={handleCancel}
    >
      <div
        className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto'
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className='flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-600'>
          <h2 className='text-xl font-semibold text-gray-900 dark:text-white'>🔍 RAG 搜尋設定</h2>
          <button
            onClick={handleCancel}
            className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
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

        {/* Content */}
        <div className='p-6 space-y-6'>
          {/* Vector Search Limit */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              向量搜尋結果數量
            </label>
            <input
              type='number'
              min='1'
              max='100'
              value={settings.vectorSearchLimit}
              onChange={e => handleSettingChange('vectorSearchLimit', parseInt(e.target.value))}
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white'
            />
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              從資料庫中檢索的候選文件數量（建議：10-50）
            </p>
          </div>

          {/* Enable Reranking */}
          <div>
            <div className='flex items-center justify-between'>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
                啟用智慧重新排序
              </label>
              <label className='relative inline-flex items-center cursor-pointer'>
                <input
                  type='checkbox'
                  checked={settings.enableReranking}
                  onChange={e => handleSettingChange('enableReranking', e.target.checked)}
                  className='sr-only peer'
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              使用 AI 模型重新排序搜尋結果以提高相關性（較慢但更準確）
            </p>
          </div>

          {/* Rerank Limit - only show if reranking is enabled */}
          {settings.enableReranking && (
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                重新排序後保留結果數量
              </label>
              <input
                type='number'
                min='1'
                max='20'
                value={settings.rerankLimit}
                onChange={e => handleSettingChange('rerankLimit', parseInt(e.target.value))}
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                重新排序後使用的最終結果數量（建議：3-10）
              </p>
            </div>
          )}

          {/* If reranking is disabled, show alternative setting */}
          {!settings.enableReranking && (
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                直接使用結果數量
              </label>
              <input
                type='number'
                min='1'
                max='20'
                value={settings.rerankLimit}
                onChange={e => handleSettingChange('rerankLimit', parseInt(e.target.value))}
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white'
              />
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                直接從向量搜尋結果中使用的文件數量（建議：3-10）
              </p>
            </div>
          )}

          {/* Minimum Similarity */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              最低相似度閾值 ({settings.minSimilarity.toFixed(2)})
            </label>
            <input
              type='range'
              min='0'
              max='1'
              step='0.05'
              value={settings.minSimilarity}
              onChange={e => handleSettingChange('minSimilarity', parseFloat(e.target.value))}
              className='w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 slider'
            />
            <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1'>
              <span>0.0 (包含所有)</span>
              <span>1.0 (僅完全相符)</span>
            </div>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              只保留相似度高於此閾值的文件（建議：0.2-0.5）
            </p>
          </div>

          {/* Performance Info */}
          <div className='bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg'>
            <div className='flex'>
              <div className='flex-shrink-0'>
                <svg className='h-5 w-5 text-blue-400' fill='currentColor' viewBox='0 0 20 20'>
                  <path
                    fillRule='evenodd'
                    d='M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z'
                    clipRule='evenodd'
                  />
                </svg>
              </div>
              <div className='ml-3'>
                <h3 className='text-sm font-medium text-blue-800 dark:text-blue-200'>效能提示</h3>
                <div className='mt-2 text-sm text-blue-700 dark:text-blue-300'>
                  <ul className='list-disc list-inside space-y-1'>
                    <li>關閉重新排序可顯著提升搜尋速度</li>
                    <li>較高的相似度閾值可減少無關結果</li>
                    <li>建議設定：向量搜尋 20、重新排序 5、閾值 0.3</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-600'>
          <button
            onClick={handleReset}
            className='px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors'
          >
            重設預設值
          </button>
          <div className='flex space-x-3'>
            <button
              onClick={handleCancel}
              className='px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors'
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                hasChanges
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
              }`}
            >
              儲存設定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RagSettingsModal;
