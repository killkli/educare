/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HtmlProjectWorkspace } from '../HtmlProjectWorkspace';
import { useAppContext } from '../../core/useAppContext';
import { htmlProjectStore } from '../../../services/htmlProjectStore';
import { htmlPreviewService } from '../../../services/htmlPreviewService';
import { htmlProjectZipService } from '../../../services/htmlProjectZipService';

vi.mock('../../core/useAppContext', () => ({
  useAppContext: vi.fn(),
}));

vi.mock('../../../services/htmlProjectStore', () => ({
  htmlProjectStore: {
    getProject: vi.fn(),
    listFiles: vi.fn(),
  },
}));

vi.mock('../../../services/htmlPreviewService', () => ({
  htmlPreviewService: {
    resolveProjectForPreview: vi.fn(),
  },
}));

vi.mock('../../../services/htmlProjectZipService', () => ({
  htmlProjectZipService: {
    downloadProjectZip: vi.fn(),
  },
}));

vi.mock('../PreviewFrame', () => ({
  PreviewFrame: ({ preview }: { preview?: { url?: string | null } | null }) =>
    React.createElement('div', { 'data-testid': 'preview-frame' }, preview?.url ?? 'no-preview'),
}));

vi.mock('../FileTree', () => ({
  FileTree: ({ files, entryFile }: { files: Array<{ path: string }>; entryFile: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'file-tree' },
      `${entryFile}:${files.map(file => file.path).join(',')}`,
    ),
}));

describe('HtmlProjectWorkspace', () => {
  const mockSetProjectPreview = vi.fn();
  const mockAppendProjectActivity = vi.fn();
  const mockUploadFilesToProjectForCurrentSession = vi.fn();
  const mockSetProjectWorkspaceOpen = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useAppContext).mockReturnValue({
      state: {
        currentAssistant: {
          id: 'assistant-1',
        },
        projectPreview: {
          projectId: 'project-1',
          url: 'blob:preview-1',
          previewVersion: 1,
        },
        projectToolActivity: ['Generated landing page', 'Updated button styles'],
      },
      actions: {
        setProjectPreview: mockSetProjectPreview,
        appendProjectActivity: mockAppendProjectActivity,
        setProjectWorkspaceOpen: mockSetProjectWorkspaceOpen,
        uploadFilesToProjectForCurrentSession: mockUploadFilesToProjectForCurrentSession,
      },
    } as never);

    vi.mocked(htmlProjectStore.getProject).mockResolvedValue({
      id: 'project-1',
      entryFile: '/src/main.html',
    } as never);
    vi.mocked(htmlProjectStore.listFiles).mockResolvedValue([
      { path: '/src/main.html' },
      { path: '/src/styles.css' },
    ] as never);
  });

  it('loads workspace files and passes them to the Files tab', async () => {
    render(<HtmlProjectWorkspace projectId='project-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Files' }));

    await waitFor(() => {
      expect(htmlProjectStore.getProject).toHaveBeenCalledWith('project-1');
      expect(htmlProjectStore.listFiles).toHaveBeenCalledWith('project-1');
      expect(screen.getByTestId('file-tree')).toHaveTextContent(
        '/src/main.html:/src/main.html,/src/styles.css',
      );
    });
  });

  it('renders project tool activity items in the Activity tab', async () => {
    render(<HtmlProjectWorkspace projectId='project-1' />);

    await waitFor(() => {
      expect(htmlProjectStore.getProject).toHaveBeenCalledWith('project-1');
      expect(htmlProjectStore.listFiles).toHaveBeenCalledWith('project-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));

    expect(screen.getByText('Generated landing page')).toBeInTheDocument();
    expect(screen.getByText('Updated button styles')).toBeInTheDocument();
    expect(screen.queryByText('尚未收到 project tool activity。')).not.toBeInTheDocument();
  });

  it('refreshes the preview and logs the new preview version', async () => {
    vi.mocked(htmlPreviewService.resolveProjectForPreview).mockResolvedValue({
      projectId: 'project-1',
      url: 'blob:preview-2',
      previewVersion: 2,
    } as never);

    render(<HtmlProjectWorkspace projectId='project-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(htmlPreviewService.resolveProjectForPreview).toHaveBeenCalledWith('project-1');
      expect(mockSetProjectPreview).toHaveBeenCalledWith({
        projectId: 'project-1',
        url: 'blob:preview-2',
        previewVersion: 2,
      });
      expect(mockAppendProjectActivity).toHaveBeenCalledWith('重新整理預覽：version 2');
    });
  });

  it('uploads files from the workspace toolbar and forwards them to the current session action', async () => {
    render(<HtmlProjectWorkspace projectId='project-1' />);

    const fileInput = document.body.querySelector(
      'input[type="file"][multiple]',
    ) as HTMLInputElement;
    const fileInputClickSpy = vi.spyOn(fileInput, 'click');

    fireEvent.click(screen.getByRole('button', { name: 'Upload files' }));

    expect(fileInputClickSpy).toHaveBeenCalledTimes(1);

    const uploadedFile = new File(['<main>Upload</main>'], 'index.html', { type: 'text/html' });
    fireEvent.change(fileInput, { target: { files: [uploadedFile] } });

    await waitFor(() => {
      expect(mockUploadFilesToProjectForCurrentSession).toHaveBeenCalledWith('project-1', [
        uploadedFile,
      ]);
    });
  });

  it('shows the uploading state while workspace file upload is in progress', async () => {
    let resolveUpload: (() => void) | undefined;
    mockUploadFilesToProjectForCurrentSession.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveUpload = resolve;
        }),
    );

    render(<HtmlProjectWorkspace projectId='project-1' />);

    const fileInput = document.body.querySelector(
      'input[type="file"][multiple]',
    ) as HTMLInputElement;
    const uploadedFile = new File(['<main>Upload</main>'], 'index.html', { type: 'text/html' });

    fireEvent.change(fileInput, { target: { files: [uploadedFile] } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Download ZIP' })).toBeDisabled();
    });

    resolveUpload?.();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Upload files' })).toBeEnabled();
    });
  });

  it('logs a helpful activity item when workspace file upload fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockUploadFilesToProjectForCurrentSession.mockRejectedValue(new Error('Upload failed.'));

    render(<HtmlProjectWorkspace projectId='project-1' />);

    const fileInput = document.body.querySelector(
      'input[type="file"][multiple]',
    ) as HTMLInputElement;
    const uploadedFile = new File(['<main>Upload</main>'], 'index.html', { type: 'text/html' });

    fireEvent.change(fileInput, { target: { files: [uploadedFile] } });

    await waitFor(() => {
      expect(mockAppendProjectActivity).toHaveBeenCalledWith('無法上傳檔案：Upload failed.');
    });
  });

  it('downloads the project zip and logs the exported file details', async () => {
    vi.mocked(htmlProjectZipService.downloadProjectZip).mockResolvedValue({
      fileCount: 3,
      fileName: 'existing-landing-page.zip',
      projectId: 'project-1',
      projectName: 'Existing Landing Page',
    });

    render(<HtmlProjectWorkspace projectId='project-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Download ZIP' }));

    await waitFor(() => {
      expect(htmlProjectZipService.downloadProjectZip).toHaveBeenCalledWith(
        'project-1',
        'assistant-1',
      );
      expect(mockAppendProjectActivity).toHaveBeenCalledWith(
        '已下載 ZIP：existing-landing-page.zip（3 個檔案）。',
      );
    });
  });

  it('logs a helpful activity item when zip export fails', async () => {
    vi.mocked(htmlProjectZipService.downloadProjectZip).mockRejectedValue(
      new Error('HTML project has no files to export.'),
    );

    render(<HtmlProjectWorkspace projectId='project-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Download ZIP' }));

    await waitFor(() => {
      expect(mockAppendProjectActivity).toHaveBeenCalledWith(
        '無法下載 ZIP：HTML project has no files to export.',
      );
    });
  });
});
