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
    });
    expect(artifact.html).toContain('<style data-project-path="/styles/app.css">');
    expect(artifact.html).toContain('body { color: red; }');
    expect(artifact.html).toContain('<script  data-project-path="/scripts/app.js">');
    expect(artifact.html).toContain('console.log("preview");');
  });

  it('returns an error artifact when preview dependencies are missing', async () => {
    mockGetProject.mockResolvedValue(project);
    mockListFiles.mockResolvedValue([{ path: '/index.html' }]);
    mockReadFile.mockResolvedValue(htmlFile);

    const { htmlPreviewService } = await import('./htmlPreviewService');

    const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

    expect(artifact.previewReady).toBe(false);
    expect(artifact.url).toBeUndefined();
    expect(artifact.error).toContain('/styles/app.css');
    expect(artifact.error).toContain('/scripts/app.js');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
