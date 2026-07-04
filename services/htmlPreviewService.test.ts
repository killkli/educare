import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlProject, HtmlProjectFile } from '../types';

const { mockGetProject, mockListFiles, mockReadFile } = vi.hoisted(() => ({
  mockGetProject: vi.fn(),
  mockListFiles: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock('./htmlProjectStore', () => ({
  htmlProjectStore: {
    getProject: mockGetProject,
    listFiles: mockListFiles,
    readFile: mockReadFile,
  },
}));

const project: HtmlProject = {
  id: 'project-1',
  assistantId: 'assistant-1',
  sessionId: 'session-1',
  name: 'Preview Project',
  entryFile: '/index.html',
  status: 'draft',
  previewVersion: 2,
  assetPaths: [],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  lastBuildError: null,
};

const htmlFile: HtmlProjectFile = {
  projectId: 'project-1',
  path: '/index.html',
  kind: 'html',
  content:
    '<!doctype html><html><head><link rel="stylesheet" href="./styles/app.css"></head><body><script src="./scripts/app.js"></script></body></html>',
  encoding: 'utf-8',
  dependencies: ['/styles/app.css', '/scripts/app.js'],
  size: 10,
  updatedAt: 1700000000000,
};

describe('htmlPreviewService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:preview-1'),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  it('builds a ready preview artifact with inlined local CSS and JS', async () => {
    const cssFile: HtmlProjectFile = {
      projectId: 'project-1',
      path: '/styles/app.css',
      kind: 'css',
      content: 'body { color: red; }',
      encoding: 'utf-8',
      dependencies: [],
      size: 20,
      updatedAt: 1700000000000,
    };
    const jsFile: HtmlProjectFile = {
      projectId: 'project-1',
      path: '/scripts/app.js',
      kind: 'js',
      content: 'console.log("preview");',
      encoding: 'utf-8',
      dependencies: [],
      size: 24,
      updatedAt: 1700000000000,
    };

    mockGetProject.mockResolvedValue(project);
    mockListFiles.mockResolvedValue([
      { path: '/index.html' },
      { path: '/styles/app.css' },
      { path: '/scripts/app.js' },
    ]);
    mockReadFile.mockImplementation(async (_projectId: string, path: string) => {
      if (path === '/index.html') {
        return htmlFile;
      }
      if (path === '/styles/app.css') {
        return cssFile;
      }
      if (path === '/scripts/app.js') {
        return jsFile;
      }
      return undefined;
    });

    const { htmlPreviewService } = await import('./htmlPreviewService');

    const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

    expect(artifact).toMatchObject({
      projectId: 'project-1',
      previewVersion: 2,
      previewReady: true,
      previewUrlType: 'blob',
      url: 'blob:preview-1',
      error: null,
      diagnostics: {
        category: 'none',
        outcome: 'ready',
        repairable: false,
        summary: 'Preview rendered successfully.',
      },
    });
    expect(artifact.html).toContain('<style data-project-path="/styles/app.css">');
    expect(artifact.html).toContain('body { color: red; }');
    expect(artifact.html).toContain('<script  data-project-path="/scripts/app.js">');
    expect(artifact.html).toContain('console.log("preview");');
  });

  it('returns missing_reference diagnostics when preview dependencies are missing', async () => {
    mockGetProject.mockResolvedValue(project);
    mockListFiles.mockResolvedValue([{ path: '/index.html' }]);
    mockReadFile.mockResolvedValue(htmlFile);

    const { htmlPreviewService } = await import('./htmlPreviewService');

    const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

    expect(artifact.previewReady).toBe(false);
    expect(artifact.url).toBeUndefined();
    expect(artifact.error).toContain('/styles/app.css');
    expect(artifact.error).toContain('/scripts/app.js');
    expect(artifact.diagnostics).toEqual({
      category: 'missing_reference',
      outcome: 'repairable_error',
      repairable: true,
      summary: 'Missing preview dependencies: /styles/app.css, /scripts/app.js.',
      missingPaths: ['/styles/app.css', '/scripts/app.js'],
      warnings: [],
      details: [
        'Restore the missing file(s) or update the HTML references before retrying preview.',
      ],
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('returns missing_entrypoint diagnostics when the entry file does not exist', async () => {
    mockGetProject.mockResolvedValue(project);
    mockListFiles.mockResolvedValue([{ path: '/styles/app.css' }]);
    mockReadFile.mockResolvedValue(undefined);

    const { htmlPreviewService } = await import('./htmlPreviewService');

    const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

    expect(artifact).toMatchObject({
      previewReady: false,
      error: 'Entrypoint /index.html 不存在。',
      diagnostics: {
        category: 'missing_entrypoint',
        outcome: 'repairable_error',
        repairable: true,
        summary: 'Entrypoint /index.html does not exist.',
        missingPaths: ['/index.html'],
        details: ['Set a valid entry file or recreate the missing entrypoint file.'],
      },
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('returns external_dependency_warning diagnostics when external assets are preserved', async () => {
    const externalHtmlFile: HtmlProjectFile = {
      ...htmlFile,
      content:
        '<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example.com/app.css"></head><body><script src="https://cdn.example.com/app.js"></script></body></html>',
      dependencies: [],
    };

    mockGetProject.mockResolvedValue(project);
    mockListFiles.mockResolvedValue([{ path: '/index.html' }]);
    mockReadFile.mockResolvedValue(externalHtmlFile);

    const { htmlPreviewService } = await import('./htmlPreviewService');

    const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

    expect(artifact).toMatchObject({
      previewReady: true,
      diagnostics: {
        category: 'external_dependency_warning',
        outcome: 'ready',
        repairable: false,
        summary: 'Preview rendered with external dependency warnings.',
        warnings: [
          '保留外部樣式資源：https://cdn.example.com/app.css',
          '保留外部腳本資源：https://cdn.example.com/app.js',
        ],
        details: [
          '保留外部樣式資源：https://cdn.example.com/app.css',
          '保留外部腳本資源：https://cdn.example.com/app.js',
        ],
      },
    });
    expect(artifact.html).toContain('https://cdn.example.com/app.css');
    expect(artifact.html).toContain('https://cdn.example.com/app.js');
  });
});
