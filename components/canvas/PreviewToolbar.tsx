import React from 'react';

interface PreviewToolbarProps {
  projectId: string;
  previewVersion: number;
  previewUrl?: string;
  isRefreshing: boolean;
  isDownloadingZip?: boolean;
  isUploadingFiles?: boolean;
  onRefresh: () => Promise<void> | void;
  onDownloadZip?: () => Promise<void> | void;
  onUploadFiles?: () => Promise<void> | void;
  onClose?: () => void;
}

export function PreviewToolbar({
  projectId,
  previewVersion,
  previewUrl,
  isRefreshing,
  isDownloadingZip = false,
  isUploadingFiles = false,
  onRefresh,
  onDownloadZip,
  onUploadFiles,
  onClose,
}: PreviewToolbarProps): React.JSX.Element {
  return (
    <div className='flex items-center justify-between gap-3 border-b border-gray-700/60 px-4 py-3'>
      <div>
        <p className='text-sm font-semibold text-white'>HTML Preview</p>
        <p className='text-xs text-gray-400'>
          {projectId} · version {previewVersion}
        </p>
      </div>
      <div className='flex items-center gap-2'>
        <button
          type='button'
          onClick={() => onRefresh()}
          disabled={isRefreshing || isDownloadingZip || isUploadingFiles}
          className='rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:border-cyan-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        {previewUrl && (
          <a
            href={previewUrl}
            target='_blank'
            rel='noreferrer noopener'
            title='在新分頁開啟完整預覽'
            aria-disabled={isRefreshing || isDownloadingZip || isUploadingFiles || undefined}
            className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:border-gray-500 hover:text-white ${
              isRefreshing || isDownloadingZip || isUploadingFiles
                ? 'pointer-events-none opacity-60'
                : ''
            }`}
          >
            <svg
              className='h-3.5 w-3.5'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
              aria-hidden='true'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M14 5h5v5M19 5l-7 7M19 13v5a1 1 0 01-1 1H6a1 1 0 01-1-1V6a1 1 0 011-1h5'
              />
            </svg>
            Open tab
          </a>
        )}
        {onUploadFiles && (
          <button
            type='button'
            onClick={() => onUploadFiles()}
            disabled={isRefreshing || isDownloadingZip || isUploadingFiles}
            className='rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-200 transition hover:border-blue-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
          >
            {isUploadingFiles ? 'Uploading…' : 'Upload files'}
          </button>
        )}
        {onDownloadZip && (
          <button
            type='button'
            onClick={() => onDownloadZip()}
            disabled={isRefreshing || isDownloadingZip || isUploadingFiles}
            className='rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
          >
            {isDownloadingZip ? 'Downloading…' : 'Download ZIP'}
          </button>
        )}
        {onClose && (
          <button
            type='button'
            onClick={onClose}
            className='rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:border-gray-500 hover:text-white'
          >
            Hide
          </button>
        )}
      </div>
    </div>
  );
}
