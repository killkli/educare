import React from 'react';
import { AssistantListProps } from './types';
import { CustomSelect } from '../ui/CustomSelect';
import { PlusIcon, EditIcon, TrashIcon } from '../ui/Icons';

export const AssistantList: React.FC<AssistantListProps> = ({
  assistants,
  selectedAssistant,
  onSelect,
  onEdit,
  onDelete,
  onShare,
  onCreateNew,
  canShare = true, // 預設為可分享
}) => {
  return (
    <div className='mb-6 px-2' role='navigation' aria-label='助理選擇'>
      <label className='block text-sm font-bold text-gray-300 uppercase tracking-wider mb-2'>
        選擇助理
      </label>

      <CustomSelect
        assistants={assistants}
        selectedAssistant={selectedAssistant ?? null}
        onSelect={onSelect}
        placeholder='請選擇一個助理'
      />

      <div className='flex justify-end gap-1 mt-2'>
        <button
          onClick={onCreateNew}
          className='p-1.5 text-gray-400 hover:text-cyan-400 rounded-md hover:bg-cyan-500/20 transition-colors'
          title='新增助理'
          aria-label='新增助理'
        >
          <PlusIcon className='w-4 h-4' />
        </button>
        {selectedAssistant && (
          <>
            <button
              onClick={() => {
                if (canShare) {
                  onShare(selectedAssistant);
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
              onClick={() => onEdit(selectedAssistant)}
              className='p-1.5 text-gray-400 hover:text-cyan-400 rounded-md hover:bg-cyan-500/20 transition-colors'
              title='編輯助理'
              aria-label='編輯助理'
            >
              <EditIcon className='w-4 h-4' />
            </button>
            <button
              onClick={() => onDelete(selectedAssistant.id)}
              className='p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/20 transition-colors'
              title='刪除助理'
              aria-label='刪除助理'
            >
              <TrashIcon className='w-4 h-4' />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
