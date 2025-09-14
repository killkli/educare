import React, { useState, useEffect } from 'react';
import { Assistant, RagChunk } from '../../types';
import { RAGFileUpload } from './RAGFileUpload';

interface AssistantEditorProps {
  assistant: Assistant | null;
  onSave: (assistant: Assistant) => void;
  onCancel: () => void;
  onShare?: (assistant: Assistant) => void;
}

export const AssistantEditor: React.FC<AssistantEditorProps> = ({
  assistant,
  onSave,
  onCancel,
  onShare,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [ragChunks, setRagChunks] = useState<RagChunk[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (assistant) {
      setName(assistant.name);
      setDescription(assistant.description || '');
      setSystemPrompt(assistant.systemPrompt);
      setRagChunks(assistant.ragChunks || []);
    } else {
      setName('');
      setDescription('');
      setSystemPrompt('您是一個有用且專業的 AI 助理。');
      setRagChunks([]);
    }
  }, [assistant]);

  const handleSave = async () => {
    if (!name.trim()) {
      alert('助理名稱為必填。');
      return;
    }

    setIsSaving(true);
    try {
      const assistantId = assistant?.id || `asst_${Date.now()}`;
      const newAssistant: Assistant = {
        id: assistantId,
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        ragChunks: ragChunks,
        createdAt: assistant?.createdAt || Date.now(),
      };

      // 只保存到本地，不自動上傳到 Turso
      console.log('Assistant saved locally. Use migration settings to sync to Turso if needed.');

      onSave(newAssistant);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRagChunksChange = (newChunks: RagChunk[]) => {
    setRagChunks(newChunks);
  };

  return (
    <div
      data-testid='assistant-editor'
      className='flex flex-col h-full bg-gradient-to-br from-gray-800 to-gray-900 p-8 overflow-y-auto chat-scroll'
    >
      <h2 className='text-3xl font-bold mb-8 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent'>
        {assistant ? '編輯助理' : '新增助理'}
      </h2>

      <div className='mb-6'>
        <label htmlFor='name' className='block text-sm font-semibold text-gray-300 mb-2'>
          助理名稱
        </label>
        <input
          type='text'
          id='name'
          value={name}
          onChange={e => setName(e.target.value)}
          className='w-full bg-gray-700/80 border-2 border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-gray-700 transition-all duration-200 shadow-inner'
          placeholder='例如：行銷文案寫手'
        />
      </div>

      <div className='mb-6'>
        <label htmlFor='description' className='block text-sm font-semibold text-gray-300 mb-2'>
          公開描述
          <span className='text-xs text-gray-500 ml-2'>(分享時顯示給用戶)</span>
        </label>
        <textarea
          id='description'
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className='w-full bg-gray-700/80 border-2 border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-gray-700 transition-all duration-200 shadow-inner resize-none'
          placeholder='簡單描述這個助理能幫助什麼...'
        />
      </div>

      <div className='mb-6'>
        <label htmlFor='systemPrompt' className='block text-sm font-semibold text-gray-300 mb-2'>
          系統提示
        </label>
        <textarea
          id='systemPrompt'
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          rows={8}
          className='w-full bg-gray-700/80 border-2 border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-gray-700 transition-all duration-200 shadow-inner resize-none'
          placeholder='定義助理的角色、個性和指導。'
        />
      </div>

      <RAGFileUpload
        ragChunks={ragChunks}
        onRagChunksChange={handleRagChunksChange}
        disabled={isSaving}
      />

      <div className='mt-auto flex justify-between items-center'>
        {/* Left side - Share section (only show for existing assistants) */}
        <div className='flex-1'>
          {assistant && (
            <div className='space-y-2'>
              <div className='flex items-center space-x-2'>
                <button
                  onClick={() => onShare?.(assistant)}
                  className='px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold flex items-center space-x-2 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
                >
                  <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z'
                    />
                  </svg>
                  <span>🎯 分享助理</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right side - Save and Cancel buttons */}
        <div className='flex space-x-4'>
          <button
            data-testid='cancel-button'
            onClick={onCancel}
            className='px-6 py-3 rounded-xl bg-gray-600/80 hover:bg-gray-500 text-white font-semibold transition-all duration-300 hover:shadow-lg hover:transform hover:-translate-y-0.5'
          >
            取消
          </button>
          <button
            data-testid='save-button'
            onClick={handleSave}
            className='px-8 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white font-bold transition-all duration-300 hover:shadow-xl hover:transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none'
            disabled={isSaving}
          >
            {isSaving ? (
              <span className='flex items-center gap-2'>
                <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                處理中...
              </span>
            ) : (
              '保存助理'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
