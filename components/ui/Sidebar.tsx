import React, { useEffect } from 'react';
import { SidebarProps } from './types';
import Button from './Button';

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  children,
  isMobile = false,
  isTablet = false,
}) => {
  useEffect(() => {
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && (isMobile || isTablet)) {
        onClose();
      }
    };

    if (isOpen && (isMobile || isTablet)) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      if (!(isMobile || isTablet)) {
        document.body.style.overflow = 'unset';
      }
    };
  }, [isOpen, onClose, isMobile, isTablet]);

  // Backdrop click handler for mobile/tablet
  const handleBackdropClick = () => {
    if (isMobile || isTablet) {
      onClose();
    }
  };

  return (
    <>
      {/* Mobile/Tablet Backdrop */}
      {isOpen && (isMobile || isTablet) && (
        <div
          className='fixed inset-0 bg-black/50 backdrop-blur-sm z-40'
          onClick={handleBackdropClick}
          aria-hidden='true'
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-full w-72 bg-gray-900/95 backdrop-blur-md border-r border-gray-700/50 z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } ${!isMobile && !isTablet ? 'lg:translate-x-0' : ''}`}
        role='navigation'
        aria-label='側邊欄選單'
      >
        {/* Close button for mobile/tablet */}
        {(isMobile || isTablet) && isOpen && (
          <div className='flex items-center justify-end mb-6 p-4'>
            <Button variant='ghost' onClick={onClose} aria-label='關閉選單'>
              <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </Button>
          </div>
        )}

        {/* Sidebar content */}
        <div className='flex-1 overflow-hidden'>{children}</div>
      </aside>
    </>
  );
};

export default Sidebar;
