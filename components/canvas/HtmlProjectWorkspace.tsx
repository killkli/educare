import React, { useEffect, useMemo, useState } from 'react';
import { HtmlProjectFileDescriptor } from '../../types';
import { useAppContext } from '../core/useAppContext';
import { htmlProjectStore } from '../../services/htmlProjectStore';
import { htmlPreviewService } from '../../services/htmlPreviewService';
import { htmlProjectZipService } from '../../services/htmlProjectZipService';
import { PreviewToolbar } from './PreviewToolbar';
import { PreviewFrame } from './PreviewFrame';
import { FileTree } from './FileTree';

type WorkspaceTab = 'preview' | 'files' | 'activity';

interface HtmlProjectWorkspaceProps {
  projectId: string;
}

export function HtmlProjectWorkspace({ projectId }: HtmlProjectWorkspaceProps): React.JSX.Element {
  const { state, actions } = useAppContext();
  const [files, setFiles] = useState<HtmlProjectFileDescriptor[]>([]);
  const [entryFile, setEntryFile] = useState('/index.html');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('preview');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  const preview = state.projectPreview;

  useEffect(() => {
    let cancelled = false;

    const loadWorkspace = async () => {
      const [project, projectFiles] = await Promise.all([
        htmlProjectStore.getProject(projectId),
        htmlProjectStore.listFiles(projectId),
      ]);

      if (cancelled) {
        return;
      }

      setFiles(projectFiles);
      setEntryFile(project?.entryFile || '/index.html');
    };

    loadWorkspace().catch(error => {
      console.error('Failed to load HTML project workspace:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, preview?.previewVersion]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const nextPreview = await htmlPreviewService.resolveProjectForPreview(projectId);
      actions.setProjectPreview(nextPreview);
      actions.appendProjectActivity(`重新整理預覽：version ${nextPreview.previewVersion}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!state.currentAssistant) {
      actions.appendProjectActivity('無法下載 ZIP：找不到目前 assistant。');
      return;
    }

    setIsDownloadingZip(true);
    try {
      const result = await htmlProjectZipService.downloadProjectZip(
        projectId,
        state.currentAssistant.id,
      );
      actions.appendProjectActivity(
        `已下載 ZIP：${result.fileName}（${result.fileCount} 個檔案）。`,
      );
    } catch (error) {
      console.error('Failed to download HTML project zip:', error);
      actions.appendProjectActivity(`無法下載 ZIP：${(error as Error).message}`);
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const tabs = useMemo(
    () => [
      { id: 'preview' as const, label: 'Preview' },
      { id: 'files' as const, label: 'Files' },
      { id: 'activity' as const, label: 'Activity' },
    ],
    [],
  );

  return (
    <section
      className='flex h-full min-h-0 flex-col border-l border-gray-700/60 bg-gray-950/90'
      data-testid='html-project-workspace'
    >
      <PreviewToolbar
        projectId={projectId}
        previewVersion={preview?.previewVersion || 0}
        previewUrl={preview?.url}
        isRefreshing={isRefreshing}
        isDownloadingZip={isDownloadingZip}
        onRefresh={handleRefresh}
        onDownloadZip={handleDownloadZip}
        onClose={() => actions.setProjectWorkspaceOpen(false)}
      />

      <div className='flex items-center gap-2 border-b border-gray-800 px-4 py-3'>
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type='button'
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                isActive
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className='min-h-0 flex-1 p-4'>
        {activeTab === 'preview' && (
          <div className='h-full min-h-0 overflow-hidden'>
            <PreviewFrame preview={preview} />
          </div>
        )}
        {activeTab === 'files' && (
          <div className='h-full overflow-y-auto pr-1'>
            <FileTree files={files} entryFile={entryFile} />
          </div>
        )}
        {activeTab === 'activity' && (
          <div className='h-full space-y-2 overflow-y-auto pr-1'>
            {state.projectToolActivity.length === 0 ? (
              <p className='text-sm text-gray-400'>尚未收到 project tool activity。</p>
            ) : (
              state.projectToolActivity.map((activity, index) => (
                <div
                  key={`${activity}-${index}`}
                  className='rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-gray-100'
                >
                  {activity}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
