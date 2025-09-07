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
    <div className='fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center'>
      <div className='bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-8 max-w-md mx-4 shadow-2xl border border-gray-700/50'>
        <div className='text-center'>
          <div className='mb-6'>
            <div className='w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center'>
              <svg className='w-8 h-8 text-white animate-spin' fill='none' viewBox='0 0 24 24'>
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
            <h2 className='text-2xl font-bold text-white mb-2'>正在初始化向量模型</h2>
            <p className='text-gray-300 text-sm leading-relaxed'>
              首次啟動需要下載並載入 AI 向量模型
              <br />
              這可能需要幾分鐘時間，請稍候...
            </p>
          </div>

          {progress && (
            <div className='space-y-3'>
              <div className='bg-gray-700/50 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-300 ease-out'
                  style={{ width: `${Math.max(5, progress.progress * 100)}%` }}
                />
              </div>

              <div className='text-sm text-gray-400'>
                <div className='font-medium text-gray-300'>{progress.status}</div>
                {progress.name && (
                  <div className='text-xs text-gray-500 mt-1 truncate'>{progress.name}</div>
                )}
                <div className='text-xs mt-1'>{Math.round(progress.progress * 100)}% 完成</div>
              </div>
            </div>
          )}

          <div className='mt-6 text-xs text-gray-500'>
            <div className='flex items-center justify-center space-x-1'>
              <div className='w-1 h-1 bg-cyan-500 rounded-full animate-pulse'></div>
              <div
                className='w-1 h-1 bg-cyan-500 rounded-full animate-pulse'
                style={{ animationDelay: '0.2s' }}
              ></div>
              <div
                className='w-1 h-1 bg-cyan-500 rounded-full animate-pulse'
                style={{ animationDelay: '0.4s' }}
              ></div>
            </div>
            <div className='mt-2'>模型載入後會自動開始</div>
          </div>
        </div>
      </div>
    </div>
  );
};
