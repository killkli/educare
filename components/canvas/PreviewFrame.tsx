import React from 'react';
import { HtmlProjectPreviewArtifact } from '../../types';

interface PreviewFrameProps {
  preview: HtmlProjectPreviewArtifact | null;
}

export function PreviewFrame({ preview }: PreviewFrameProps): React.JSX.Element {
  if (!preview) {
    return (
      <div className='flex h-full items-center justify-center rounded-2xl border border-dashed border-gray-700 bg-gray-900/70 p-6 text-center text-sm text-gray-400'>
        尚未建立專案預覽。請先要求助理建立或更新 HTML project。
      </div>
    );
  }

  if (!preview.previewReady || !preview.url) {
    return (
      <div className='rounded-2xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-100'>
        <p className='font-semibold'>Preview error</p>
        <p className='mt-2 text-red-200'>{preview.error || 'Unknown preview error.'}</p>
        {preview.warnings.length > 0 && (
          <ul className='mt-3 list-disc space-y-1 pl-5 text-xs text-red-200/90'>
            {preview.warnings.map(warning => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col gap-3'>
      {preview.warnings.length > 0 && (
        <div className='rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100'>
          {preview.warnings.join(' · ')}
        </div>
      )}
      <iframe
        title='HTML project preview'
        src={preview.url}
        sandbox='allow-scripts allow-forms allow-modals'
        className='min-h-[420px] flex-1 rounded-2xl border border-gray-700 bg-white'
      />
    </div>
  );
}
