import React from 'react';

interface PreviewToolbarProps {
  projectId: string;
  previewVersion: number;
  previewUrl?: string;
  isRefreshing: boolean;
  isDownloadingZip?: boolean;
  onRefresh: () => Promise<void> | void;
  onDownloadZip?: () => Promise<void> | void;
  onClose?: () => void;
}

export function PreviewToolbar({
  projectId,
  previewVersion,
  isRefreshing,
  isDownloadingZip = false,
  onRefresh,
  onDownloadZip,
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
          disabled={isRefreshing || isDownloadingZip}
          className='rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:border-cyan-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        {onDownloadZip && (
          <button
            type='button'
            onClick={() => onDownloadZip()}
            disabled={isRefreshing || isDownloadingZip}
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
