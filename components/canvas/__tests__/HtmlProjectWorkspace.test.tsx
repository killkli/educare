/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HtmlProjectWorkspace } from '../HtmlProjectWorkspace';
import { useAppContext } from '../../core/useAppContext';
import { htmlProjectStore } from '../../../services/htmlProjectStore';
import { htmlPreviewService } from '../../../services/htmlPreviewService';

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

vi.mock('../PreviewToolbar', () => ({
  PreviewToolbar: ({
    projectId,
    previewVersion,
    isRefreshing,
    onRefresh,
  }: {
    projectId: string;
    previewVersion: number;
    isRefreshing: boolean;
    onRefresh: () => void;
  }) =>
    React.createElement(
      'button',
      {
        'data-testid': 'refresh-preview',
        disabled: isRefreshing,
        onClick: onRefresh,
        type: 'button',
      },
      `Refresh ${projectId} v${previewVersion}`,
    ),
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

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useAppContext).mockReturnValue({
      state: {
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

    fireEvent.click(screen.getByTestId('refresh-preview'));

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
});
