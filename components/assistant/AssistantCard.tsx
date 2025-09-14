import React from 'react';
import { AssistantCardProps } from './types';
import { EditIcon, TrashIcon } from '../ui/Icons';

export const AssistantCard: React.FC<AssistantCardProps> = ({
  assistant,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onShare,
  canShare = true, // 預設為可分享，避免破壞現有功能
}) => {
  return (
    <div
      data-testid={`assistant-card-${assistant.id}`}
      role='button'
      tabIndex={0}
      className={`group p-4 rounded-lg cursor-pointer transition-all duration-200 border ${
        isSelected
          ? 'bg-cyan-600/20 border-cyan-500/30 text-white shadow-md'
          : 'bg-gray-800/30 hover:bg-gray-700/50 text-gray-200 hover:text-white border-transparent hover:border-gray-600/30'
      }`}
      onClick={() => onSelect(assistant.id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelect(assistant.id);
        }
      }}
    >
      <div className='flex items-start justify-between'>
        <div className='flex-1 min-w-0'>
          <h3 className='font-semibold text-white truncate mb-1'>{assistant.name}</h3>
          {assistant.description && (
            <p className='text-sm text-gray-400 line-clamp-2 mb-2'>{assistant.description}</p>
          )}
          <div className='flex items-center text-xs text-gray-500 space-x-4'>
            <span>建立於 {new Date(assistant.createdAt).toLocaleDateString('zh-TW')}</span>
            {assistant.ragChunks && assistant.ragChunks.length > 0 && (
              <span className='px-2 py-1 bg-blue-500/20 text-blue-300 rounded-full'>
                RAG: {assistant.ragChunks.length} 檔案
              </span>
            )}
            {assistant.isShared && (
              <span className='px-2 py-1 bg-green-500/20 text-green-300 rounded-full'>已分享</span>
            )}
          </div>
        </div>

        <div className='flex items-center gap-1 ml-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
          <button
            onClick={e => {
              e.stopPropagation();
              if (canShare) {
                onShare(assistant);
              }
            }}
            disabled={!canShare}
            className={`p-1.5 rounded-md transition-colors ${
              canShare
                ? 'text-gray-400 hover:text-blue-400 hover:bg-blue-500/20 cursor-pointer'
                : 'text-gray-600 cursor-not-allowed opacity-50'
            }`}
            title={canShare ? '分享助理' : '需要先遷移到 Turso 才能分享'}
            aria-label={canShare ? '分享助理' : '需要遷移到 Turso'}
          >
            <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z'
              />
            </svg>
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              onEdit(assistant);
            }}
            className='p-1.5 text-gray-400 hover:text-cyan-400 rounded-md hover:bg-cyan-500/20 transition-colors'
            title='編輯助理'
            aria-label='編輯助理'
          >
            <EditIcon className='w-4 h-4' />
          </button>
          <button
            onClick={e => {
              e.stopPropagation();
              onDelete(assistant.id);
            }}
            className='p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/20 transition-colors'
            title='刪除助理'
            aria-label='刪除助理'
          >
            <TrashIcon className='w-4 h-4' />
          </button>
        </div>
      </div>
    </div>
  );
};
