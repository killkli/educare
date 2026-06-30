import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ModalProps } from './types';

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  size = 'default',
}) => {
  useEffect(() => {
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
      {/* Backdrop */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        aria-hidden='true'
      />

      {/* Modal */}
      <div
        className={`relative flex w-full flex-col overflow-hidden rounded-2xl bg-gray-800 shadow-2xl ${size === 'fullscreen' ? 'h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)]' : 'max-h-[90vh] max-w-lg'} ${className}`}
        role='dialog'
        aria-modal='true'
        aria-labelledby={title ? 'modal-title' : undefined}
      >
        {/* Header */}
        {title && (
          <div className='flex items-center justify-between border-b border-gray-700 p-6'>
            <h2 id='modal-title' className='text-xl font-semibold text-white'>
              {title}
            </h2>
            <button
              onClick={onClose}
              className='rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700/50 hover:text-white'
              aria-label='關閉對話框'
            >
              <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div className='flex-1 overflow-y-auto p-6'>{children}</div>
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
