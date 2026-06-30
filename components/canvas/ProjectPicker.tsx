import React, { useEffect, useState } from 'react';
import { HtmlProject } from '../../types';
import { htmlProjectStore } from '../../services/htmlProjectStore';

interface ProjectPickerProps {
  assistantId: string;
  onOpenProject: (projectId: string) => Promise<void> | void;
}

export function ProjectPicker({
  assistantId,
  onOpenProject,
}: ProjectPickerProps): React.JSX.Element | null {
  const [projects, setProjects] = useState<HtmlProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadProjects = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const nextProjects = await htmlProjectStore.listProjectsByAssistant(assistantId);
        if (!cancelled) {
          setProjects(nextProjects);
        }
      } catch (loadError) {
        console.error('Failed to load assistant HTML projects:', loadError);
        if (!cancelled) {
          setError('無法載入既有 HTML 專案。');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadProjects().catch(loadError => {
      console.error('Failed to initialize assistant HTML project picker:', loadError);
    });

    return () => {
      cancelled = true;
    };
  }, [assistantId]);

  if (isLoading) {
    return (
      <div
        className='mx-4 mt-4 rounded-2xl border border-gray-800 bg-gray-900/70 px-4 py-3 text-sm text-gray-400'
        data-testid='html-project-picker'
      >
        載入既有 HTML 專案中...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className='mx-4 mt-4 rounded-2xl border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200'
        data-testid='html-project-picker'
      >
        {error}
      </div>
    );
  }

  if (projects.length === 0) {
    return null;
  }

  return (
    <section
      className='mx-4 mt-4 rounded-3xl border border-cyan-900/40 bg-gray-950/80 p-4 shadow-lg shadow-cyan-950/20'
      data-testid='html-project-picker'
    >
      <div className='mb-3 flex items-start justify-between gap-4'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300'>
            HTML Canvas
          </p>
          <h3 className='mt-1 text-lg font-semibold text-white'>Open existing HTML project</h3>
          <p className='mt-1 text-sm text-gray-400'>
            這個 assistant 先前建立過 {projects.length} 個 HTML 專案。選一個繼續編輯，新的 session
            不會自動綁定舊 project。
          </p>
        </div>
      </div>

      <div className='grid gap-3 md:grid-cols-2'>
        {projects.map(project => {
          const isOpening = openingProjectId === project.id;
          return (
            <button
              key={project.id}
              type='button'
              onClick={async () => {
                setOpeningProjectId(project.id);
                try {
                  await onOpenProject(project.id);
                } finally {
                  setOpeningProjectId(null);
                }
              }}
              className='rounded-2xl border border-gray-800 bg-gray-900/70 px-4 py-3 text-left transition hover:border-cyan-500/60 hover:bg-gray-900'
            >
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <div className='text-sm font-semibold text-white'>{project.name}</div>
                  <div className='mt-1 text-xs text-gray-400'>{project.entryFile}</div>
                </div>
                <span className='rounded-full bg-cyan-500/15 px-2.5 py-1 text-[11px] font-medium text-cyan-200'>
                  v{project.previewVersion}
                </span>
              </div>
              {project.description && (
                <p className='mt-3 line-clamp-2 text-sm text-gray-300'>{project.description}</p>
              )}
              <div className='mt-3 flex items-center justify-between text-xs text-gray-500'>
                <span>{new Date(project.updatedAt).toLocaleString('zh-TW')}</span>
                <span className='text-cyan-200'>{isOpening ? '開啟中...' : '開啟專案 →'}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
