import React from 'react';
import { WelcomeMessageProps } from './types';
import { GeminiIcon } from '../ui/Icons';

const WelcomeMessage: React.FC<WelcomeMessageProps> = ({
  assistantName,
  assistantDescription,
  sharedMode = false,
}) => {
  return (
    <div data-testid='welcome-message' className='text-center py-12'>
      <div className='w-20 h-20 bg-cyan-600 rounded-full flex items-center justify-center mx-auto mb-6'>
        <GeminiIcon className='w-10 h-10 text-white' />
      </div>
      <h3 className='text-2xl font-semibold text-white mb-3'>{assistantName}</h3>
      {assistantDescription && (
        <p className='text-gray-300 mb-6 max-w-2xl mx-auto leading-relaxed'>
          {assistantDescription}
        </p>
      )}
      {sharedMode && (
        <div className='inline-flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-full text-sm text-gray-400 mb-6'>
          <span>💡</span>
          <span>分享的 AI 助理 - 您的對話不會永久儲存</span>
        </div>
      )}
      <p className='text-gray-400 text-lg'>
        {assistantDescription ? '讓我們開始聊天吧！' : '問我任何問題，我會幫助您！'}
      </p>
    </div>
  );
};

export default WelcomeMessage;
