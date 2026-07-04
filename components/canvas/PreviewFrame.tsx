import React, { useEffect, useRef } from 'react';
import { HtmlProjectPreviewArtifact } from '../../types';
import {
  isHarnessMessage,
  previewRuntimeDiagnostics,
} from '../../services/previewRuntimeDiagnostics';

interface PreviewFrameProps {
  preview: HtmlProjectPreviewArtifact | null;
}

export function PreviewFrame({ preview }: PreviewFrameProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const projectId = preview?.projectId;
  const previewVersion = preview?.previewVersion;
  const isMounted = Boolean(preview?.previewReady && preview?.url);

  useEffect(() => {
    if (!isMounted || projectId === undefined || previewVersion === undefined) {
      return;
    }

    const expected = { projectId, previewVersion };

    const handleMessage = (event: MessageEvent) => {
      const source = iframeRef.current?.contentWindow ?? null;
      if (event.source !== source) {
        return;
      }
      if (!isHarnessMessage(event.data, expected, { expectedSource: source })) {
        return;
      }
      const data = event.data;
      if (data.type === 'ready') {
        previewRuntimeDiagnostics.recordReadyAck(projectId, previewVersion);
      } else if (data.type === 'runtime-errors') {
        previewRuntimeDiagnostics.recordRuntimeErrors(projectId, previewVersion, data.errors);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [isMounted, projectId, previewVersion]);

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
    <div className='flex h-full min-h-0 flex-col gap-3 overflow-hidden'>
      {preview.warnings.length > 0 && (
        <div className='rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100'>
          {preview.warnings.join(' · ')}
        </div>
      )}
      <iframe
        ref={iframeRef}
        title='HTML project preview'
        src={preview.url}
        sandbox='allow-scripts allow-forms allow-modals'
        className='h-full min-h-[320px] w-full flex-1 rounded-2xl border border-gray-700 bg-white'
      />
    </div>
  );
}
