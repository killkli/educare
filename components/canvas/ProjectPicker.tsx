import React, { useEffect, useState } from 'react';
import { HtmlProject } from '../../types';
import { htmlProjectStore } from '../../services/htmlProjectStore';
import { htmlProjectZipService } from '../../services/htmlProjectZipService';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

interface ProjectPickerProps {
  assistantId: string;
  activeProjectId?: string | null;
  onCreateProject: () => Promise<void> | void;
  onOpenProject: (projectId: string) => Promise<void> | void;
  onDeleteProject: (projectId: string) => Promise<void> | void;
  variant?: 'sidebar' | 'sidebar-collapsed';
}

export function ProjectPicker({
  assistantId,
  activeProjectId = null,
  onCreateProject,
  onOpenProject,
  onDeleteProject,
  variant = 'sidebar',
}: ProjectPickerProps): React.JSX.Element {
  const [projects, setProjects] = useState<HtmlProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [downloadingProjectId, setDownloadingProjectId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
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
  }, [assistantId, isModalOpen]);

  const handleCreateProject = async () => {
    setIsCreatingProject(true);
    setError(null);
    try {
      await onCreateProject();
      setIsModalOpen(false);
    } catch (createError) {
      console.error('Failed to create HTML project:', createError);
      setError('無法建立新的 HTML 專案。');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setOpeningProjectId(projectId);
    setError(null);
    try {
      await onOpenProject(projectId);
      setIsModalOpen(false);
    } catch (openError) {
      console.error('Failed to open HTML project:', openError);
      setError('無法開啟所選的 HTML 專案。');
    } finally {
      setOpeningProjectId(null);
    }
  };

  const handleDownloadProject = async (projectId: string) => {
    setDownloadingProjectId(projectId);
    setError(null);
    try {
      await htmlProjectZipService.downloadProjectZip(projectId, assistantId);
    } catch (downloadError) {
      console.error('Failed to download HTML project zip:', downloadError);
      setError('無法下載 HTML 專案 ZIP。');
    } finally {
      setDownloadingProjectId(null);
    }
  };

  const handleDeleteProject = async (project: HtmlProject) => {
    const confirmed = window.confirm(
      `確定要永久刪除 HTML 專案「${project.name}」嗎？此動作無法復原。`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingProjectId(project.id);
    setError(null);
    try {
      await onDeleteProject(project.id);
      setProjects(currentProjects =>
        currentProjects.filter(currentProject => currentProject.id !== project.id),
      );
    } catch (deleteError) {
      console.error('Failed to delete HTML project:', deleteError);
      setError('無法刪除 HTML 專案。');
    } finally {
      setDeletingProjectId(null);
    }
  };

  const isCollapsed = variant === 'sidebar-collapsed';

  return (
    <>
      <section
        className={isCollapsed ? 'mb-4 flex justify-center' : 'mb-4 px-2'}
        data-testid='html-project-picker'
      >
        <Button
          type='button'
          onClick={() => setIsModalOpen(true)}
          size='sm'
          className={
            isCollapsed
              ? 'flex h-11 w-11 items-center justify-center rounded-xl border border-blue-400/50 bg-gradient-to-br from-blue-600 to-cyan-500 px-0 text-white shadow-lg shadow-blue-950/40 hover:from-blue-500 hover:to-cyan-400'
              : 'flex w-full items-center justify-between rounded-xl border border-blue-400/50 bg-gradient-to-r from-blue-600 to-cyan-500 px-3 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-950/40 hover:from-blue-500 hover:to-cyan-400'
          }
          aria-label='HTML Projects'
          title='HTML Projects'
        >
          <span className='flex items-center gap-2'>
            <svg
              className='h-4 w-4 flex-shrink-0'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M3 7.5A1.5 1.5 0 014.5 6h5.379a1.5 1.5 0 011.06.44l1.121 1.12a1.5 1.5 0 001.06.44H19.5A1.5 1.5 0 0121 9.5v9A1.5 1.5 0 0119.5 20h-15A1.5 1.5 0 013 18.5v-11z'
              />
            </svg>
            {!isCollapsed && <span className='tracking-wide'>HTML Projects</span>}
          </span>
          {!isCollapsed && (
            <span className='rounded-full bg-black/20 px-2 py-0.5 text-[11px] text-cyan-50'>
              {isLoading ? '載入中…' : `${projects.length} 個`}
            </span>
          )}
        </Button>
      </section>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          if (isCreatingProject || openingProjectId || downloadingProjectId || deletingProjectId) {
            return;
          }
          setIsModalOpen(false);
        }}
        title='HTML Canvas projects'
        size='fullscreen'
        className='bg-gray-900'
      >
        <div className='space-y-6'>
          <div className='rounded-2xl border border-cyan-900/40 bg-cyan-950/20 p-5'>
            <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
              <div>
                <p className='text-sm font-semibold text-white'>Start new HTML project</p>
                <p className='mt-1 text-sm text-gray-300'>
                  立即建立新的 HTML Canvas workspace，載入預設 starter files 並綁定到目前對話。
                </p>
              </div>
              <Button
                type='button'
                onClick={handleCreateProject}
                loading={isCreatingProject}
                size='sm'
                className='self-start whitespace-nowrap px-5 py-2.5 text-sm'
              >
                Start new project
              </Button>
            </div>
          </div>

          <div>
            <div className='mb-3 flex items-start justify-between gap-3'>
              <div>
                <p className='text-sm font-semibold text-white'>Open existing HTML project</p>
                <p className='mt-1 text-sm text-gray-400'>
                  這些專案都屬於目前 assistant，可直接續編、下載 ZIP 備份，或手動刪除。
                </p>
              </div>
            </div>

            {error && (
              <div className='mb-4 rounded-2xl border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200'>
                {error}
              </div>
            )}

            {isLoading ? (
              <div className='rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-5 text-sm text-gray-400'>
                載入既有 HTML 專案中...
              </div>
            ) : projects.length === 0 ? (
              <div className='rounded-2xl border border-dashed border-gray-700 bg-gray-950/60 px-4 py-5 text-sm text-gray-400'>
                目前還沒有既有 HTML 專案，可以直接建立新的 project。
              </div>
            ) : (
              <div className='grid gap-3 lg:grid-cols-2'>
                {projects.map(project => {
                  const isActive = activeProjectId === project.id;
                  const isOpening = openingProjectId === project.id;
                  const isDownloading = downloadingProjectId === project.id;
                  const isDeleting = deletingProjectId === project.id;
                  const isBusy = isOpening || isDownloading || isDeleting || isCreatingProject;

                  return (
                    <div
                      key={project.id}
                      className={`rounded-2xl border p-4 shadow-sm shadow-black/20 ${
                        isActive
                          ? 'border-cyan-500/40 bg-cyan-950/10'
                          : 'border-gray-800 bg-gray-950/80'
                      }`}
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div>
                          <div className='text-sm font-semibold text-white'>{project.name}</div>
                          <div className='mt-1 text-xs text-gray-400'>{project.entryFile}</div>
                        </div>
                        <div className='flex flex-wrap justify-end gap-2'>
                          {isActive && (
                            <span className='rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-medium text-cyan-100'>
                              目前使用中
                            </span>
                          )}
                          <span className='rounded-full bg-cyan-500/15 px-2.5 py-1 text-[11px] font-medium text-cyan-200'>
                            v{project.previewVersion}
                          </span>
                        </div>
                      </div>

                      {project.description && (
                        <p className='mt-3 line-clamp-2 text-sm text-gray-300'>
                          {project.description}
                        </p>
                      )}

                      <div className='mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500'>
                        <span>{new Date(project.updatedAt).toLocaleString('zh-TW')}</span>
                        <div className='flex flex-wrap items-center gap-2'>
                          <button
                            type='button'
                            onClick={() => handleDeleteProject(project)}
                            disabled={isBusy}
                            className='rounded-lg border border-rose-500/30 px-3 py-1.5 font-medium text-rose-200 transition hover:border-rose-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
                          >
                            {isDeleting ? '刪除中…' : 'Delete project'}
                          </button>
                          <button
                            type='button'
                            onClick={() => handleDownloadProject(project.id)}
                            disabled={isBusy}
                            className='rounded-lg border border-gray-700 px-3 py-1.5 font-medium text-gray-200 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
                          >
                            {isDownloading ? '下載中…' : 'Download ZIP'}
                          </button>
                          <button
                            type='button'
                            onClick={() => handleOpenProject(project.id)}
                            disabled={isBusy}
                            className='rounded-lg border border-cyan-500/40 px-3 py-1.5 font-medium text-cyan-200 transition hover:border-cyan-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60'
                          >
                            {isOpening ? '開啟中…' : 'Open project'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
