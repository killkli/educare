import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCall } from './llmAdapter';

const { mockWriteFiles, mockResolveProjectForPreview } = vi.hoisted(() => ({
  mockWriteFiles: vi.fn(),
  mockResolveProjectForPreview: vi.fn(),
}));

vi.mock('./htmlProjectStore', () => ({
  htmlProjectStore: {
    writeFiles: mockWriteFiles,
  },
}));

vi.mock('./htmlPreviewService', () => ({
  htmlPreviewService: {
    resolveProjectForPreview: mockResolveProjectForPreview,
  },
}));

describe('executeHtmlProjectToolCall', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockResolveProjectForPreview.mockResolvedValue({
      projectId: 'project-1',
      previewVersion: 3,
      previewReady: true,
      previewUrlType: 'blob',
      url: 'blob:preview-1',
      html: '<html></html>',
      error: null,
    });
  });

  it('accepts a single file object, infers kind from path, and forwards normalized files', async () => {
    mockWriteFiles.mockResolvedValue({
      updated: ['/index.html'],
      previewVersion: 3,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const call: ToolCall = {
      name: 'writeFiles',
      args: {
        projectId: 'project-1',
        files: {
          path: 'index.html',
          content: '<main>Hello</main>',
        },
      },
    };

    const result = await executeHtmlProjectToolCall(call, {
      assistantId: 'assistant-1',
      activeProjectId: 'project-1',
    });

    expect(mockWriteFiles).toHaveBeenCalledWith('project-1', [
      {
        path: 'index.html',
        content: '<main>Hello</main>',
        kind: 'html',
      },
    ]);
    expect(result.toolName).toBe('writeFiles');
    expect(result.result).toEqual({
      projectId: 'project-1',
      updated: ['/index.html'],
      previewVersion: 3,
    });
  });

  it('fails invalid writeFiles input with a clear validation error', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const call: ToolCall = {
      name: 'writeFiles',
      args: {
        projectId: 'project-1',
        files: 'index.html' as unknown as Record<string, unknown>,
      },
    };

    await expect(
      executeHtmlProjectToolCall(call, {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      }),
    ).rejects.toThrow('writeFiles requires a non-empty files array.');

    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });
});
