import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCall } from './llmAdapter';

const {
  mockAssertProjectOwnership,
  mockListFiles,
  mockListProjectsByAssistant,
  mockReadFile,
  mockResolveProjectForPreview,
  mockSearchFiles,
  mockWriteFiles,
} = vi.hoisted(() => ({
  mockAssertProjectOwnership: vi.fn(),
  mockListFiles: vi.fn(),
  mockListProjectsByAssistant: vi.fn(),
  mockReadFile: vi.fn(),
  mockResolveProjectForPreview: vi.fn(),
  mockSearchFiles: vi.fn(),
  mockWriteFiles: vi.fn(),
}));

vi.mock('./htmlProjectStore', async importOriginal => {
  const actual = await importOriginal<typeof import('./htmlProjectStore')>();

  return {
    ...actual,
    htmlProjectStore: {
      assertProjectOwnership: mockAssertProjectOwnership,
      listFiles: mockListFiles,
      listProjectsByAssistant: mockListProjectsByAssistant,
      readFile: mockReadFile,
      searchFiles: mockSearchFiles,
      writeFiles: mockWriteFiles,
    },
  };
});

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

  it('returns a structured recoverable result when writeFiles receives an empty files array', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: 'writeFiles requires a non-empty files array.',
      result: {
        ok: false,
        recoverable: true,
        code: 'invalid-write-files-input',
        message: 'writeFiles requires a non-empty files array.',
        guidance:
          'Pass one or more file objects in files[]. Use writeFiles for small complete files only.',
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'writeFiles requires a non-empty files array.',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when writeFiles contains a non-object file entry', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [null],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: 'writeFiles.files[0] must be an object with path and content.',
      result: {
        ok: false,
        recoverable: true,
        code: 'invalid-write-file-entry',
        message: 'writeFiles.files[0] must be an object with path and content.',
        guidance:
          'Pass files as objects like { path, content, kind? } and avoid null or primitive entries.',
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'writeFiles.files[0] must be an object with path and content.',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when writeFiles path validation fails inside the store', async () => {
    const { HtmlProjectPathValidationError } = await import('./htmlProjectStore');
    mockWriteFiles.mockRejectedValue(
      new HtmlProjectPathValidationError(
        '../..',
        'path-resolved-to-root',
        'Project file path must include a file inside the virtual project root: ../..',
      ),
    );
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [
            {
              path: '../..',
              content: '<main>Hello</main>',
            },
          ],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-9',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: 'Project file path must include a file inside the virtual project root: ../..',
      result: {
        ok: false,
        recoverable: true,
        code: 'path-resolved-to-root',
        message: 'Project file path must include a file inside the virtual project root: ../..',
        guidance:
          'Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Do not use host filesystem paths or URLs.',
        details: {
          path: '../..',
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage:
          'Project file path must include a file inside the virtual project root: ../..',
        preview: null,
      },
    });
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when a writeFiles payload exceeds the size limit', async () => {
    const oversizedContent = 'a'.repeat(24 * 1024 + 1);
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [
            {
              path: '/index.html',
              content: oversizedContent,
            },
          ],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: `writeFiles payload for /index.html is too large (${oversizedContent.length} bytes).`,
      result: {
        ok: false,
        recoverable: true,
        code: 'write-file-too-large',
        message: `writeFiles payload for /index.html is too large (${oversizedContent.length} bytes).`,
        guidance:
          'Use writeFiles only for small complete files. For existing files, readFile first and then use replaceInFile for targeted edits.',
        details: {
          path: '/index.html',
          contentBytes: oversizedContent.length,
          maxBytes: 24 * 1024,
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: `writeFiles payload for /index.html is too large (${oversizedContent.length} bytes).`,
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('replaces an exact single match inside an existing text file', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: '<main>Hello</main>',
      encoding: 'utf-8',
      dependencies: [],
      size: 18,
      updatedAt: 1700000001000,
    });
    mockWriteFiles.mockResolvedValue({
      updated: ['/index.html'],
      previewVersion: 4,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          oldText: 'Hello',
          newText: 'Hi',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-9',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockReadFile).toHaveBeenCalledWith('project-1', '/index.html');
    expect(mockWriteFiles).toHaveBeenCalledWith('project-1', [
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>Hi</main>',
        encoding: 'utf-8',
      },
    ]);
    expect(mockResolveProjectForPreview).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'replaceInFile',
      summary: '已更新檔案 /index.html 的指定內容。',
      result: {
        projectId: 'project-1',
        path: '/index.html',
        updated: ['/index.html'],
        previewVersion: 4,
        replaced: true,
        matchCount: 1,
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '已更新檔案 /index.html 的指定內容。',
      },
    });
  });

  it('treats replaceInFile newText as a literal string', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: '<main>Hello</main>',
      encoding: 'utf-8',
      dependencies: [],
      size: 18,
      updatedAt: 1700000001000,
    });
    mockWriteFiles.mockResolvedValue({
      updated: ['/index.html'],
      previewVersion: 4,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          oldText: 'Hello',
          newText: '$&',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockWriteFiles).toHaveBeenCalledWith('project-1', [
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>$&</main>',
        encoding: 'utf-8',
      },
    ]);
  });

  it('returns a structured recoverable result when replaceInFile oldText is missing', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          oldText: '',
          newText: 'Hi',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(result).toMatchObject({
      toolName: 'replaceInFile',
      summary: 'replaceInFile requires a non-empty oldText value.',
      result: {
        ok: false,
        recoverable: true,
        code: 'invalid-replace-old-text',
        message: 'replaceInFile requires a non-empty oldText value.',
        guidance: 'Call readFile first, copy the exact text to replace, then retry replaceInFile.',
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'replaceInFile requires a non-empty oldText value.',
        preview: null,
      },
    });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when replaceInFile path validation fails inside the store', async () => {
    const { HtmlProjectPathValidationError } = await import('./htmlProjectStore');
    mockReadFile.mockRejectedValue(
      new HtmlProjectPathValidationError(
        '../..',
        'path-resolved-to-root',
        'Project file path must include a file inside the virtual project root: ../..',
      ),
    );
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '../..',
          oldText: 'Hello',
          newText: 'Hi',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-7',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockReadFile).toHaveBeenCalledWith('project-1', '../..');
    expect(result).toMatchObject({
      toolName: 'replaceInFile',
      summary: 'Project file path must include a file inside the virtual project root: ../..',
      result: {
        ok: false,
        recoverable: true,
        code: 'path-resolved-to-root',
        message: 'Project file path must include a file inside the virtual project root: ../..',
        guidance:
          'Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Do not use host filesystem paths or URLs.',
        details: {
          path: '../..',
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage:
          'Project file path must include a file inside the virtual project root: ../..',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when replaceInFile oldText is ambiguous', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: '<p>Hello</p>\n<p>Hello</p>',
      encoding: 'utf-8',
      dependencies: [],
      size: 25,
      updatedAt: 1700000001000,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          oldText: 'Hello',
          newText: 'Hi',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockReadFile).toHaveBeenCalledWith('project-1', '/index.html');
    expect(result).toMatchObject({
      toolName: 'replaceInFile',
      summary: 'replaceInFile found 2 matches in /index.html.',
      result: {
        ok: false,
        recoverable: true,
        code: 'replace-old-text-ambiguous',
        message: 'replaceInFile found 2 matches in /index.html.',
        guidance:
          'Use a longer oldText snippet that uniquely identifies the section to replace, or narrow the edit after reading the file again.',
        details: {
          path: '/index.html',
          matchCount: 2,
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'replaceInFile found 2 matches in /index.html.',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when readFile cannot find the requested path', async () => {
    mockReadFile.mockResolvedValue(undefined);

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'readFile',
        args: {
          projectId: 'project-1',
          path: '/missing.html',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockReadFile).toHaveBeenCalledWith('project-1', '/missing.html');
    expect(result).toMatchObject({
      toolName: 'readFile',
      summary: 'Project file /missing.html not found.',
      result: {
        ok: false,
        recoverable: true,
        code: 'read-file-not-found',
        message: 'Project file /missing.html not found.',
        guidance:
          'Call listFiles or searchFiles first to confirm the exact virtual project path before retrying readFile.',
        details: {
          path: '/missing.html',
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'Project file /missing.html not found.',
        preview: null,
      },
    });
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

describe('getHtmlProjectToolDefinitions', () => {
  it('includes replaceInFile and describes writeFiles as a small complete-file tool using virtual project paths', async () => {
    const { getHtmlProjectToolDefinitions } = await import('./htmlProjectToolService');

    const definitions = getHtmlProjectToolDefinitions();
    const writeFilesDefinition = definitions.find(({ name }) => name === 'writeFiles');
    const replaceInFileDefinition = definitions.find(({ name }) => name === 'replaceInFile');

    expect(replaceInFileDefinition).toMatchObject({
      name: 'replaceInFile',
      parameters: {
        required: ['path', 'oldText', 'newText'],
      },
    });
    expect(writeFilesDefinition?.description).toContain(
      'Write or overwrite one or more small complete project files in a single tool call.',
    );
    expect(writeFilesDefinition?.description).toContain(
      'Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js.',
    );
    expect(writeFilesDefinition?.description).toContain(
      'For existing files, prefer readFile plus replaceInFile over sending a large full-file rewrite.',
    );
  });
});
