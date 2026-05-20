import React from 'react';

interface ModelLoadingOverlayProps {
  isVisible: boolean;
  progress?: { status: string; progress: number; name?: string };
}

export const ModelLoadingOverlay: React.FC<ModelLoadingOverlayProps> = ({
  isVisible,
  progress,
}) => {
  if (!isVisible) {
    return null;
  }

  return (
    <div className='fixed bottom-6 right-6 z-50 flex pointer-events-none'>
      <div className='bg-gradient-to-br from-gray-800/95 to-gray-900/95 backdrop-blur-md rounded-2xl p-5 w-80 shadow-2xl border border-gray-700/50 pointer-events-auto transition-all duration-300 transform hover:-translate-y-1 hover:shadow-cyan-500/10'>
        <div className='flex items-center space-x-3 mb-4'>
          <div className='w-8 h-8 flex-shrink-0 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20 animate-pulse'>
            <svg className='w-4 h-4 text-white animate-spin' fill='none' viewBox='0 0 24 24'>
              <circle
                className='opacity-25'
                cx='12'
                cy='12'
                r='10'
                stroke='currentColor'
                strokeWidth='4'
              ></circle>
              <path
                className='opacity-75'
                fill='currentColor'
                d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
              ></path>
            </svg>
          </div>
          <div className='min-w-0 flex-1'>
            <h4 className='text-sm font-bold text-white leading-tight truncate'>初始化向量模型</h4>
            <p className='text-xs text-gray-400 leading-normal truncate'>
              首次啟動需在背景載入 AI 向量模型
            </p>
          </div>
        </div>

        {progress && (
          <div className='space-y-2.5'>
            <div className='bg-gray-700/50 rounded-full h-1.5 overflow-hidden'>
              <div
                className='h-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-300 ease-out'
                style={{ width: `${Math.max(5, progress.progress * 100)}%` }}
              />
            </div>

            <div className='text-xs text-gray-400 flex justify-between items-center'>
              <div className='font-medium text-gray-300 truncate max-w-[180px]'>
                {progress.status}
              </div>
              <div className='font-semibold text-cyan-400 flex-shrink-0'>
                {Math.round(progress.progress * 100)}%
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
