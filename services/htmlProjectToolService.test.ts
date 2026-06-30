import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCall } from './llmAdapter';

const {
  mockAssertProjectOwnership,
  mockListFiles,
  mockListProjectsByAssistant,
  mockResolveProjectForPreview,
  mockSearchFiles,
  mockWriteFiles,
} = vi.hoisted(() => ({
  mockAssertProjectOwnership: vi.fn(),
  mockListFiles: vi.fn(),
  mockListProjectsByAssistant: vi.fn(),
  mockResolveProjectForPreview: vi.fn(),
  mockSearchFiles: vi.fn(),
  mockWriteFiles: vi.fn(),
}));

vi.mock('./htmlProjectStore', () => ({
  htmlProjectStore: {
    assertProjectOwnership: mockAssertProjectOwnership,
    listFiles: mockListFiles,
    listProjectsByAssistant: mockListProjectsByAssistant,
    searchFiles: mockSearchFiles,
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

    mockAssertProjectOwnership.mockResolvedValue({
      id: 'project-1',
      assistantId: 'assistant-1',
      sessionId: 'session-1',
      name: 'Canvas MVP',
      description: 'Project description',
      entryFile: '/index.html',
      previewVersion: 3,
    });
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

  it('lists assistant-scoped projects', async () => {
    mockListProjectsByAssistant.mockResolvedValue([
      {
        id: 'project-2',
        name: 'Landing Page',
        description: 'Marketing page',
        entryFile: '/landing.html',
        updatedAt: 1700000002000,
        previewVersion: 5,
      },
      {
        id: 'project-1',
        name: 'Canvas MVP',
        description: 'Project description',
        entryFile: '/index.html',
        updatedAt: 1700000001000,
        previewVersion: 3,
      },
    ]);

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'listProjects',
        args: {},
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockListProjectsByAssistant).toHaveBeenCalledWith('assistant-1');
    expect(result).toMatchObject({
      toolName: 'listProjects',
      summary: '目前 assistant 共有 2 個 HTML 專案。',
      result: {
        projects: [
          {
            projectId: 'project-2',
            name: 'Landing Page',
            description: 'Marketing page',
            entryFile: '/landing.html',
            updatedAt: 1700000002000,
            previewVersion: 5,
          },
          {
            projectId: 'project-1',
            name: 'Canvas MVP',
            description: 'Project description',
            entryFile: '/index.html',
            updatedAt: 1700000001000,
            previewVersion: 3,
          },
        ],
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '目前 assistant 共有 2 個 HTML 專案。',
        preview: null,
      },
    });
  });

  it('opens an owned project and returns preview metadata', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'openProject',
        args: {
          projectId: 'project-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: null,
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockResolveProjectForPreview).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'openProject',
      summary: '已開啟既有 HTML 專案「Canvas MVP」。',
      result: {
        projectId: 'project-1',
        name: 'Canvas MVP',
        entryFile: '/index.html',
        previewVersion: 3,
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '已開啟既有 HTML 專案「Canvas MVP」。',
        preview: {
          projectId: 'project-1',
          previewVersion: 3,
        },
      },
    });
  });

  it('searches files in the owned project', async () => {
    mockSearchFiles.mockResolvedValue({
      projectId: 'project-1',
      query: 'needle',
      caseSensitive: false,
      scannedFiles: 2,
      truncated: true,
      matches: [
        {
          path: '/index.html',
          kind: 'html',
          line: 1,
          column: 7,
          snippet: '...needle...',
          matchCount: 1,
        },
      ],
      skippedFiles: [{ path: '/assets/logo.bin', reason: 'unsupported-kind' }],
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'searchFiles',
        args: {
          projectId: 'project-1',
          query: 'needle',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-9',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockSearchFiles).toHaveBeenCalledWith('project-1', {
      query: 'needle',
      caseSensitive: undefined,
    });
    expect(result).toMatchObject({
      toolName: 'searchFiles',
      summary: '在 2 個可搜尋檔案中找到 1 個「needle」結果，結果已截斷。',
      result: {
        projectId: 'project-1',
        query: 'needle',
        truncated: true,
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '在 2 個可搜尋檔案中找到 1 個「needle」結果，結果已截斷。',
      },
    });
  });

  it('lists files for the owned project', async () => {
    mockListFiles.mockResolvedValue([
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>Hello</main>',
        encoding: 'utf-8',
        dependencies: [],
        size: 18,
        updatedAt: 1700000001000,
      },
      {
        path: '/styles.css',
        kind: 'css',
        content: 'body { color: red; }',
        encoding: 'utf-8',
        dependencies: [],
        size: 20,
        updatedAt: 1700000001000,
      },
    ]);

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'listFiles',
        args: {
          projectId: 'project-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-9',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockListFiles).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'listFiles',
      summary: '目前專案共有 2 個檔案。',
      result: {
        projectId: 'project-1',
        entryFile: '/index.html',
        previewVersion: 3,
        files: [
          { path: '/index.html', kind: 'html' },
          { path: '/styles.css', kind: 'css' },
        ],
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '目前專案共有 2 個檔案。',
        preview: null,
      },
    });
  });

  it('denies explicit project access when the project belongs to another assistant', async () => {
    mockAssertProjectOwnership.mockRejectedValue(new Error('HTML project project-2 not found.'));

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    await expect(
      executeHtmlProjectToolCall(
        {
          name: 'searchFiles',
          args: {
            projectId: 'project-2',
            query: 'needle',
          },
        },
        {
          assistantId: 'assistant-1',
          activeProjectId: 'project-1',
        },
      ),
    ).rejects.toThrow('HTML project project-2 not found.');

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-2', 'assistant-1');
    expect(mockSearchFiles).not.toHaveBeenCalled();
  });
});
