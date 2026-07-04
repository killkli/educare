import React from 'react';
import { ChatInputProps } from './types';

const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  isLoading,
  statusText,
  disabled = false,
  isWorkspaceOpen = false,
  isRunning = false,
  onStop,
}) => {
  const [isComposing, setIsComposing] = React.useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter (without Shift) sends; Shift+Enter inserts a newline
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isComposing) {
      e.preventDefault();
      onSend();
    }
  };

  // 輸入法組合開始事件
  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  // 輸入法組合結束事件
  const handleCompositionEnd = () => {
    setIsComposing(false);
  };

  return (
    <div className='border-t border-gray-700/30 bg-gradient-to-r from-gray-800/90 to-gray-850/90 backdrop-blur-sm p-3 md:p-6'>
      <div className={isWorkspaceOpen ? 'mx-auto max-w-4xl' : 'max-w-none'}>
        {/* Status Text */}
        {statusText && (
          <div className='mb-4 p-3 bg-gray-700/30 rounded-lg border border-gray-600/30 backdrop-blur-sm'>
            <div className='flex items-center gap-3'>
              <div className='relative'>
                <div className='w-3 h-3 bg-cyan-400 rounded-full animate-pulse'></div>
                <div className='absolute inset-0 w-3 h-3 bg-cyan-400 rounded-full animate-ping opacity-75'></div>
              </div>
              <span className='text-sm text-cyan-300 font-medium'>{statusText}</span>
            </div>
          </div>
        )}

        {/* Input Row */}
        <div className='flex gap-2 md:gap-4 items-end'>
          <div className='flex-1 relative'>
            <textarea
              value={value}
              onChange={e => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              placeholder='輸入您的訊息...'
              rows={1}
              className='w-full bg-gray-700/60 border-2 border-gray-600/40 rounded-2xl px-4 md:px-6 py-3 md:py-4 resize-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/60 focus:bg-gray-700/80 text-white placeholder-gray-400 max-h-32 shadow-lg backdrop-blur-sm transition-all duration-300 hover:border-gray-500/60 focus:outline-none text-sm md:text-base disabled:opacity-60 disabled:cursor-not-allowed'
              disabled={isLoading || disabled || isRunning}
              aria-label='輸入訊息'
              aria-describedby='input-help'
              aria-multiline='true'
              role='textbox'
              style={{
                minHeight: '48px',
                height: Math.min(value.split('\n').length * 20 + 28, 120) + 'px',
              }}
            />
            {/* Character counter */}
            <div className='absolute bottom-2 right-4 flex items-center gap-2'>
              {value.length > 100 && (
                <div className='bg-gray-800/80 px-2 py-1 rounded-full text-xs text-gray-400'>
                  {value.length}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onSend}
            disabled={isLoading || !value.trim() || disabled || isRunning}
            className={`relative ${
              isLoading || !value.trim() || disabled || isRunning
                ? 'bg-gray-600/50 cursor-not-allowed'
                : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 hover:scale-105 hover:shadow-xl hover:shadow-cyan-500/30'
            } text-white rounded-2xl px-4 md:px-8 py-3 md:py-4 font-medium md:font-semibold transition-all duration-300 flex items-center justify-center min-w-[80px] md:min-w-[100px] shadow-lg border border-gray-600/30 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-gray-800 text-sm md:text-base ${
              isRunning ? 'hidden' : ''
            }`}
            aria-label={isLoading ? '正在傳送訊息' : '傳送訊息'}
            type='submit'
          >
            {isLoading ? (
              <>
                <div className='w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin' />
                <div className='absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-pulse'></div>
              </>
            ) : (
              <>
                <svg
                  className='w-4 h-4 md:w-5 md:h-5 mr-1 md:mr-2'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 19l9 2-9-18-9 18 9-2zm0 0v-8'
                  />
                </svg>
                <span className='hidden sm:inline md:inline'>傳送</span>
              </>
            )}
          </button>
          {isRunning && (
            <button
              onClick={() => onStop?.()}
              className='relative bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 hover:scale-105 hover:shadow-xl hover:shadow-rose-500/30 text-white rounded-2xl px-4 md:px-8 py-3 md:py-4 font-medium md:font-semibold transition-all duration-300 flex items-center justify-center min-w-[80px] md:min-w-[100px] shadow-lg border border-rose-400/40 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 focus:ring-offset-gray-800 text-sm md:text-base'
              aria-label='停止 Agent 執行'
              title='停止 Agent 執行'
              type='button'
            >
              <svg
                className='w-4 h-4 md:w-5 md:h-5 mr-1 md:mr-2'
                fill='currentColor'
                viewBox='0 0 24 24'
                aria-hidden='true'
              >
                <rect x='6' y='6' width='12' height='12' rx='1.5' />
              </svg>
              <span className='hidden sm:inline md:inline'>停止</span>
            </button>
          )}
        </div>

        {/* G5: Agent 執行中提示 */}
        {isRunning && (
          <div
            className='mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200'
            role='status'
            aria-live='polite'
          >
            <span className='inline-block h-2 w-2 animate-pulse rounded-full bg-rose-400' />
            <span>Agent 執行中,可按停止結束目前回合。</span>
          </div>
        )}

        {/* Footer Info */}
        <div className='flex justify-center items-center mt-2 md:mt-4' id='input-help'>
          <div
            className='flex items-center gap-1 md:gap-3 text-xs text-gray-400'
            role='region'
            aria-label='輸入說明'
          >
            <div className='flex items-center gap-2 bg-gray-700/30 px-2 py-1 md:px-3 md:py-1.5 rounded-full border border-gray-600/30'>
              <kbd
                className='px-2 py-1 bg-gray-600/50 rounded text-xs font-medium'
                aria-label='Enter 鍵'
              >
                Enter
              </kbd>
              <span>傳送</span>
            </div>
            <div className='flex items-center gap-2 bg-gray-700/30 px-2 py-1 md:px-3 md:py-1.5 rounded-full border border-gray-600/30'>
              <kbd
                className='px-2 py-1 bg-gray-600/50 rounded text-xs font-medium'
                aria-label='Shift 加 Enter 鍵'
              >
                Shift + Enter
              </kbd>
              <span>換行</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
