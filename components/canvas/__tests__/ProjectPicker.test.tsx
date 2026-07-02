/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPicker } from '../ProjectPicker';
import { htmlProjectStore } from '../../../services/htmlProjectStore';
import { htmlProjectZipService } from '../../../services/htmlProjectZipService';

vi.mock('../../../services/htmlProjectStore', () => ({
  htmlProjectStore: {
    listProjectsByAssistant: vi.fn(),
  },
}));

vi.mock('../../../services/htmlProjectZipService', () => ({
  htmlProjectZipService: {
    downloadProjectZip: vi.fn(),
  },
}));

const TEST_PROJECT = {
  id: 'project-1',
  assistantId: 'assistant-1',
  sessionId: 'session-1',
  name: 'Landing Page',
  description: 'Marketing microsite',
  entryFile: '/index.html',
  status: 'ready' as const,
  previewVersion: 2,
  assetPaths: [],
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
};

describe('ProjectPicker', () => {
  const onCreateProject = vi.fn();
  const onOpenProject = vi.fn();
  const onRenameProject = vi.fn();
  const onUploadProjectFiles = vi.fn();
  const onImportProjectZip = vi.fn();
  const onDeleteProject = vi.fn();
  const promptSpy = vi.spyOn(window, 'prompt');

  beforeEach(() => {
    vi.clearAllMocks();
    promptSpy.mockReturnValue('  Renamed Landing Page  ');
    vi.mocked(htmlProjectStore.listProjectsByAssistant).mockResolvedValue([{ ...TEST_PROJECT }]);
    vi.mocked(htmlProjectZipService.downloadProjectZip).mockResolvedValue({
      fileCount: 1,
      fileName: 'landing-page.zip',
      projectId: TEST_PROJECT.id,
      projectName: TEST_PROJECT.name,
    });
  });

  const renderPicker = () =>
    render(
      <ProjectPicker
        assistantId='assistant-1'
        activeProjectId='project-1'
        onCreateProject={onCreateProject}
        onOpenProject={onOpenProject}
        onRenameProject={onRenameProject}
        onUploadProjectFiles={onUploadProjectFiles}
        onImportProjectZip={onImportProjectZip}
        onDeleteProject={onDeleteProject}
      />,
    );

  const openModal = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'HTML Projects' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Landing Page')).toBeInTheDocument();
    });
  };

  it('renames an existing project from the modal list', async () => {
    renderPicker();

    await openModal();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(promptSpy).toHaveBeenCalledWith('請輸入新的專案名稱', 'Landing Page');
    await waitFor(() => {
      expect(onRenameProject).toHaveBeenCalledWith('project-1', '  Renamed Landing Page  ');
    });
  });

  it('triggers file upload for both files and folders and forwards the selected files', async () => {
    renderPicker();

    await openModal();

    const fileInput = document.body.querySelector(
      'input[type="file"][multiple]:not([webkitdirectory])',
    ) as HTMLInputElement;
    const folderInput = document.body.querySelector(
      'input[type="file"][webkitdirectory]',
    ) as HTMLInputElement;

    const fileInputClickSpy = vi.spyOn(fileInput, 'click');
    const folderInputClickSpy = vi.spyOn(folderInput, 'click');

    fireEvent.click(screen.getByRole('button', { name: 'Upload files' }));
    expect(fileInputClickSpy).toHaveBeenCalledTimes(1);
    expect(folderInputClickSpy).not.toHaveBeenCalled();

    const uploadedFile = new File(['<main>Upload</main>'], 'index.html', { type: 'text/html' });
    fireEvent.change(fileInput, { target: { files: [uploadedFile] } });

    await waitFor(() => {
      expect(onUploadProjectFiles).toHaveBeenCalledWith('project-1', [uploadedFile]);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Upload folder' }));
    expect(folderInputClickSpy).toHaveBeenCalledTimes(1);

    const folderFile = new File(['body { color: red; }'], 'app.css', { type: 'text/css' });
    fireEvent.change(folderInput, { target: { files: [folderFile] } });

    await waitFor(() => {
      expect(onUploadProjectFiles).toHaveBeenCalledWith('project-1', [folderFile]);
    });
  });

  it('triggers zip import and forwards the selected archive file', async () => {
    renderPicker();

    await openModal();

    const zipInput = document.body.querySelector(
      'input[type="file"][accept=".zip,application/zip"]',
    ) as HTMLInputElement;
    const zipInputClickSpy = vi.spyOn(zipInput, 'click');

    fireEvent.click(screen.getByRole('button', { name: 'Import ZIP' }));
    expect(zipInputClickSpy).toHaveBeenCalledTimes(1);

    const zipFile = new File(['zip-binary'], 'landing-page.zip', { type: 'application/zip' });
    fireEvent.change(zipInput, { target: { files: [zipFile] } });

    await waitFor(() => {
      expect(onImportProjectZip).toHaveBeenCalledWith(zipFile);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
