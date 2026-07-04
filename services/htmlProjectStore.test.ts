import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlProject, HtmlProjectFile, HtmlProjectSnapshot, HtmlProjectTodo } from '../types';

type ProjectRecord = HtmlProject;
type FileRecord = HtmlProjectFile;
type SnapshotRecord = HtmlProjectSnapshot;
type TodoRecord = HtmlProjectTodo;

type MockDb = {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  getAllFromIndex: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const { mockOpenDB } = vi.hoisted(() => ({
  mockOpenDB: vi.fn(),
}));

vi.mock('idb', () => ({
  openDB: mockOpenDB,
}));

const createMockDb = (): MockDb => {
  const projects = new Map<string, ProjectRecord>();
  const files = new Map<string, FileRecord>();
  const snapshots = new Map<string, SnapshotRecord>();
  const todos = new Map<string, TodoRecord>();

  return {
    put: vi.fn(
      async (
        storeName: string,
        value: ProjectRecord | FileRecord | SnapshotRecord | TodoRecord,
      ) => {
        if (storeName === 'htmlProjects') {
          projects.set((value as ProjectRecord).id, value as ProjectRecord);
          return;
        }

        if (storeName === 'htmlProjectFiles') {
          const file = value as FileRecord;
          files.set(`${file.projectId}:${file.path}`, file);
          return;
        }

        if (storeName === 'htmlProjectSnapshots') {
          const snapshot = value as SnapshotRecord;
          snapshots.set(`${snapshot.projectId}:${snapshot.version}`, snapshot);
          return;
        }

        if (storeName === 'htmlProjectTodos') {
          const todo = value as TodoRecord;
          todos.set(`${todo.projectId}:${todo.id}`, todo);
        }
      },
    ),
    get: vi.fn(async (storeName: string, key: string | [string, string]) => {
      if (storeName === 'htmlProjects') {
        return projects.get(key as string);
      }

      if (storeName === 'htmlProjectFiles') {
        const [projectId, path] = key as [string, string];
        return files.get(`${projectId}:${path}`);
      }

      if (storeName === 'htmlProjectSnapshots') {
        const [projectId, version] = key as unknown as [string, number];
        return snapshots.get(`${projectId}:${version}`);
      }

      if (storeName === 'htmlProjectTodos') {
        const [projectId, todoId] = key as [string, string];
        return todos.get(`${projectId}:${todoId}`);
      }
    }),
    getAllFromIndex: vi.fn(async (storeName: string, indexName: string, query: string) => {
      if (storeName === 'htmlProjects' && indexName === 'by-assistant') {
        return Array.from(projects.values()).filter(project => project.assistantId === query);
      }

      if (storeName === 'htmlProjectFiles' && indexName === 'by-project') {
        return Array.from(files.values()).filter(file => file.projectId === query);
      }

      if (storeName === 'htmlProjectSnapshots' && indexName === 'by-project') {
        return Array.from(snapshots.values()).filter(snapshot => snapshot.projectId === query);
      }

      if (storeName === 'htmlProjectTodos' && indexName === 'by-project') {
        return Array.from(todos.values()).filter(todo => todo.projectId === query);
      }

      return [];
    }),
    delete: vi.fn(async (storeName: string, key: string | [string, string] | [string, number]) => {
      if (storeName === 'htmlProjects') {
        projects.delete(key as string);
        return;
      }

      if (storeName === 'htmlProjectFiles') {
        const [projectId, path] = key as [string, string];
        files.delete(`${projectId}:${path}`);
        return;
      }

      if (storeName === 'htmlProjectSnapshots') {
        const [projectId, version] = key as [string, number];
        snapshots.delete(`${projectId}:${version}`);
        return;
      }

      if (storeName === 'htmlProjectTodos') {
        const [projectId, todoId] = key as [string, string];
        todos.delete(`${projectId}:${todoId}`);
      }
    }),
  };
};

describe('htmlProjectStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('creates projects with normalized entry file and previewVersion 0', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      sessionId: 'session-1',
      name: 'Canvas MVP',
      entryFile: 'index.html',
    });

    expect(project).toMatchObject({
      id: 'project-1700000000000',
      assistantId: 'assistant-1',
      sessionId: 'session-1',
      entryFile: '/index.html',
      previewVersion: 0,
      status: 'draft',
    });
  });

  it('canonicalizes equivalent non-traversal virtual paths across normalizePath, writeFiles, and readFile', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);

    const { htmlProjectStore, normalizePath } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Canvas MVP',
    });

    expect(normalizePath('./src/app.js')).toBe('/src/app.js');
    expect(normalizePath('src/app.js')).toBe('/src/app.js');
    expect(normalizePath('/src/app.js')).toBe('/src/app.js');

    const writeResult = await htmlProjectStore.writeFiles(project.id, [
      {
        path: './src/app.js',
        kind: 'js',
        content: 'console.log("dot");',
      },
    ]);

    const fileFromRelativePath = await htmlProjectStore.readFile(project.id, 'src/app.js');
    const fileFromCanonicalPath = await htmlProjectStore.readFile(project.id, '/src/app.js');

    expect(writeResult).toEqual({
      updated: ['/src/app.js'],
      previewVersion: 1,
    });
    expect(fileFromRelativePath).toMatchObject({
      path: '/src/app.js',
      content: 'console.log("dot");',
    });
    expect(fileFromCanonicalPath).toEqual(fileFromRelativePath);
  });

  it('rejects protocol-like, control-character, and root-only virtual paths with explicit errors', async () => {
    const { normalizePath } = await import('./htmlProjectStore');

    expect(() => normalizePath('https://example.com/app.js')).toThrow(
      'Project file path must stay inside the virtual project root: https://example.com/app.js',
    );
    expect(() => normalizePath('//cdn.example.com/app.js')).toThrow(
      'Project file path must stay inside the virtual project root: //cdn.example.com/app.js',
    );
    expect(() => normalizePath('\\\\cdn.example.com\\app.js')).toThrow(
      'Project file path must stay inside the virtual project root: \\\\cdn.example.com\\app.js',
    );
    const controlCharacterPath = `scripts/${String.fromCharCode(0)}app.js`;

    expect(() => normalizePath(controlCharacterPath)).toThrow(
      `Project file path contains invalid control characters: ${controlCharacterPath}`,
    );
    expect(() => normalizePath('scripts/app.js\n')).toThrow(
      'Project file path contains invalid control characters: scripts/app.js\n',
    );
    expect(() => normalizePath('\tscripts/app.js')).toThrow(
      'Project file path contains invalid control characters: \tscripts/app.js',
    );
    expect(() => normalizePath('../data/ruby.js')).toThrow(
      'Project file path must not use parent-directory traversal: ../data/ruby.js',
    );
    expect(() => normalizePath('/src/../index.html')).toThrow(
      'Project file path must not use parent-directory traversal: /src/../index.html',
    );
    expect(() => normalizePath('../..')).toThrow(
      'Project file path must not use parent-directory traversal: ../..',
    );
    expect(() => normalizePath('.')).toThrow(
      'Project file path must include a file inside the virtual project root: .',
    );
  });

  it('ignores external-scheme references during dependency inference', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Canvas MVP',
    });

    await htmlProjectStore.writeFiles(project.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<a href="web+demo:open">Link</a><img src="chrome-extension://abc/icon.png">',
      },
      {
        path: 'styles.css',
        kind: 'css',
        content: 'body { background-image: url("git+ssh://example.com/asset.png"); }',
      },
    ]);

    const htmlFile = await htmlProjectStore.readFile(project.id, 'index.html');
    const cssFile = await htmlProjectStore.readFile(project.id, 'styles.css');

    expect(htmlFile?.dependencies).toEqual([]);
    expect(cssFile?.dependencies).toEqual([]);
  });

  it('writes, lists, and reads files while incrementing previewVersion once per write batch', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Canvas MVP',
    });

    const writeResult = await htmlProjectStore.writeFiles(project.id, [
      {
        path: 'styles/app.css',
        kind: 'css',
        content: 'body { color: red; }',
      },
      {
        path: 'index.html',
        kind: 'html',
        content: '<link rel="stylesheet" href="styles/app.css">',
      },
    ]);

    const updatedProject = await htmlProjectStore.getProject(project.id);
    const files = await htmlProjectStore.listFiles(project.id);
    const projectFiles = await htmlProjectStore.listProjectFiles(project.id);
    const htmlFile = await htmlProjectStore.readFile(project.id, 'index.html');

    expect(writeResult).toEqual({
      updated: ['/styles/app.css', '/index.html'],
      previewVersion: 1,
    });
    expect(updatedProject?.previewVersion).toBe(1);
    expect(files.map(file => file.path)).toEqual(['/index.html', '/styles/app.css']);
    expect(projectFiles.map(file => file.path)).toEqual(['/index.html', '/styles/app.css']);
    expect(projectFiles[0]).toMatchObject({
      path: '/index.html',
      content: '<link rel="stylesheet" href="styles/app.css">',
      encoding: 'utf-8',
    });
    expect(htmlFile).toMatchObject({
      path: '/index.html',
      dependencies: ['/styles/app.css'],
    });
  });

  it('copies a file using canonicalized paths and increments previewVersion once', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1700000000000)
      .mockReturnValueOnce(1700000001000)
      .mockReturnValueOnce(1700000002000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Canvas MVP',
    });

    await htmlProjectStore.writeFiles(project.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>Hello</main>',
      },
    ]);

    const copyResult = await htmlProjectStore.copyFile(
      project.id,
      './index.html',
      'pages/index-copy.html',
    );
    const sourceFile = await htmlProjectStore.readFile(project.id, '/index.html');
    const copiedFile = await htmlProjectStore.readFile(project.id, '/pages/index-copy.html');
    const updatedProject = await htmlProjectStore.getProject(project.id);

    expect(copyResult).toEqual({
      sourcePath: '/index.html',
      destinationPath: '/pages/index-copy.html',
      previewVersion: 2,
    });
    expect(sourceFile).toMatchObject({
      path: '/index.html',
      content: '<main>Hello</main>',
    });
    expect(copiedFile).toMatchObject({
      path: '/pages/index-copy.html',
      content: '<main>Hello</main>',
    });
    expect(updatedProject?.previewVersion).toBe(2);
  });

  it('rejects copyFile when the source is missing, the destination exists, or both paths normalize equally', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Canvas MVP',
    });

    await htmlProjectStore.writeFiles(project.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>Hello</main>',
      },
      {
        path: 'pages/index-copy.html',
        kind: 'html',
        content: '<main>Existing</main>',
      },
    ]);

    await expect(
      htmlProjectStore.copyFile(project.id, '/missing.html', '/pages/missing-copy.html'),
    ).rejects.toThrow('Project file /missing.html not found.');
    await expect(
      htmlProjectStore.copyFile(project.id, '/index.html', '/pages/index-copy.html'),
    ).rejects.toThrow('Project file /pages/index-copy.html already exists.');
    await expect(
      htmlProjectStore.copyFile(project.id, '/index.html', './index.html'),
    ).rejects.toThrow('Source and destination paths must be different.');
  });

  it('renames the entry file and updates project metadata', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1700000000000)
      .mockReturnValueOnce(1700000001000)
      .mockReturnValueOnce(1700000002000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Canvas MVP',
      entryFile: 'index.html',
    });

    await htmlProjectStore.writeFiles(project.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>Hello</main>',
      },
    ]);

    const renameResult = await htmlProjectStore.renameFile(
      project.id,
      '/index.html',
      '/pages/home.html',
    );
    const oldFile = await htmlProjectStore.readFile(project.id, '/index.html');
    const renamedFile = await htmlProjectStore.readFile(project.id, '/pages/home.html');
    const updatedProject = await htmlProjectStore.getProject(project.id);

    expect(renameResult).toEqual({
      sourcePath: '/index.html',
      destinationPath: '/pages/home.html',
      previewVersion: 2,
    });
    expect(oldFile).toBeUndefined();
    expect(renamedFile).toMatchObject({
      path: '/pages/home.html',
      content: '<main>Hello</main>',
    });
    expect(updatedProject).toMatchObject({
      entryFile: '/pages/home.html',
      previewVersion: 2,
    });
  });

  it('renames asset files by moving assetPaths to the new canonical path', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1700000000000)
      .mockReturnValueOnce(1700000001000)
      .mockReturnValueOnce(1700000002000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Canvas MVP',
    });

    await htmlProjectStore.writeFiles(project.id, [
      {
        path: 'assets/logo.bin',
        kind: 'asset',
        content: 'binary-data',
      },
    ]);

    const renameResult = await htmlProjectStore.renameFile(
      project.id,
      './assets/logo.bin',
      'assets/logo-2.bin',
    );
    const updatedProject = await htmlProjectStore.getProject(project.id);

    expect(renameResult).toEqual({
      sourcePath: '/assets/logo.bin',
      destinationPath: '/assets/logo-2.bin',
      previewVersion: 2,
    });
    expect(updatedProject?.assetPaths).toEqual(['/assets/logo-2.bin']);
  });

  it('rejects renameFile when the source is missing, the destination exists, or both paths normalize equally', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Canvas MVP',
      entryFile: 'index.html',
    });

    await htmlProjectStore.writeFiles(project.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>Hello</main>',
      },
      {
        path: 'pages/home.html',
        kind: 'html',
        content: '<main>Existing</main>',
      },
    ]);

    await expect(
      htmlProjectStore.renameFile(project.id, '/missing.html', '/pages/missing.html'),
    ).rejects.toThrow('Project file /missing.html not found.');
    await expect(
      htmlProjectStore.renameFile(project.id, '/index.html', '/pages/home.html'),
    ).rejects.toThrow('Project file /pages/home.html already exists.');
    await expect(
      htmlProjectStore.renameFile(project.id, '/index.html', './index.html'),
    ).rejects.toThrow('Source and destination paths must be different.');
  });

  it('throws a clear error when writeFiles receives an empty files array', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Canvas MVP',
    });

    await expect(htmlProjectStore.writeFiles(project.id, [])).rejects.toThrow(
      'writeFiles requires a non-empty files array.',
    );
  });

  it('lists only the requested assistant projects across sessions and sorts newest first', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1700000000000)
      .mockReturnValueOnce(1700000001000)
      .mockReturnValueOnce(1700000002000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      sessionId: 'session-1',
      name: 'Older Session Project',
    });
    await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      sessionId: 'session-2',
      name: 'Newer Session Project',
    });
    await htmlProjectStore.createProject({
      assistantId: 'assistant-2',
      sessionId: 'session-9',
      name: 'Other Assistant Project',
    });

    const projects = await htmlProjectStore.listProjectsByAssistant('assistant-1');

    expect(projects.map(project => project.name)).toEqual([
      'Newer Session Project',
      'Older Session Project',
    ]);
    expect(projects.map(project => project.sessionId)).toEqual(['session-2', 'session-1']);
    expect(projects.every(project => project.assistantId === 'assistant-1')).toBe(true);
  });

  it('renames projects by trimming whitespace and updating updatedAt', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      sessionId: 'session-1',
      name: 'Original Name',
    });

    const renamedProject = await htmlProjectStore.renameProject(
      project.id,
      'assistant-1',
      '  Renamed Canvas  ',
    );

    expect(renamedProject).toMatchObject({
      id: project.id,
      assistantId: 'assistant-1',
      sessionId: 'session-1',
      name: 'Renamed Canvas',
    });
    expect(renamedProject.updatedAt).toBe(1700000001000);
    await expect(
      htmlProjectStore.assertProjectOwnership(project.id, 'assistant-1'),
    ).resolves.toMatchObject({
      name: 'Renamed Canvas',
      updatedAt: 1700000001000,
    });
  });

  it('rejects renames with a blank name after trimming whitespace', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Original Name',
    });

    await expect(htmlProjectStore.renameProject(project.id, 'assistant-1', '   ')).rejects.toThrow(
      'Project name is required.',
    );
  });

  it('returns search hits and reports skipped or truncated files', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Searchable Canvas',
    });

    await htmlProjectStore.writeFiles(project.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>Needle in the markup</main>',
      },
      {
        path: 'src/app.js',
        kind: 'js',
        content: 'const label = "needle";\nconsole.log(label, "needle again");',
      },
      {
        path: 'assets/logo.bin',
        kind: 'asset',
        content: 'needle-in-binary',
      },
      {
        path: 'data/search-index.json',
        kind: 'json',
        encoding: 'base64',
        content: 'bmVlZGxl',
      },
      {
        path: 'docs/huge.md',
        kind: 'md',
        content: `needle${'a'.repeat(250 * 1024)}`,
      },
    ]);

    const result = await htmlProjectStore.searchFiles(project.id, {
      query: 'needle',
      maxResults: 2,
    });

    expect(result).toMatchObject({
      projectId: project.id,
      query: 'needle',
      caseSensitive: false,
      scannedFiles: 2,
      truncated: true,
    });
    expect(result.matches).toHaveLength(2);
    expect(result.matches.map(match => match.path)).toEqual(['/index.html', '/src/app.js']);
    expect(result.matches[0]?.snippet.toLowerCase()).toContain('needle');
    expect(result.skippedFiles).toEqual([
      { path: '/assets/logo.bin', reason: 'unsupported-kind' },
      { path: '/data/search-index.json', reason: 'binary-encoding' },
      { path: '/docs/huge.md', reason: 'file-too-large' },
    ]);
  });

  it('returns no search matches when the query is absent', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'No Hit Canvas',
    });

    await htmlProjectStore.writeFiles(project.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>Hello world</main>',
      },
      {
        path: 'assets/illustration.bin',
        kind: 'asset',
        content: 'not-searchable',
      },
    ]);

    const result = await htmlProjectStore.searchFiles(project.id, {
      query: 'needle',
    });

    expect(result.matches).toEqual([]);
    expect(result.scannedFiles).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.skippedFiles).toEqual([
      { path: '/assets/illustration.bin', reason: 'unsupported-kind' },
    ]);
  });

  it('deletes files and increments previewVersion, then updates entrypoint separately', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1700000000000)
      .mockReturnValueOnce(1700000001000)
      .mockReturnValueOnce(1700000002000)
      .mockReturnValueOnce(1700000003000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Canvas MVP',
      entryFile: 'index.html',
    });

    await htmlProjectStore.writeFiles(project.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<h1>Hello</h1>',
      },
      {
        path: 'src/main.js',
        kind: 'js',
        content: 'console.log("hi")',
      },
    ]);

    const deleteResult = await htmlProjectStore.deleteFile(project.id, 'src/main.js');
    const afterDelete = await htmlProjectStore.getProject(project.id);
    const missingFile = await htmlProjectStore.readFile(project.id, 'src/main.js');
    const entrypointProject = await htmlProjectStore.setEntrypoint(project.id, 'src/app.html');

    expect(deleteResult).toEqual({ deleted: true, previewVersion: 2 });
    expect(afterDelete?.previewVersion).toBe(2);
    expect(missingFile).toBeUndefined();
    expect(entrypointProject.entryFile).toBe('/src/app.html');
    expect(entrypointProject.previewVersion).toBe(3);
  });

  it('replaces, lists, updates, and deletes project todos', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1700000000000)
      .mockReturnValueOnce(1700000001000)
      .mockReturnValueOnce(1700000002000)
      .mockReturnValueOnce(1700000003000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Todo Project',
    });

    const replaced = await htmlProjectStore.replaceTodos(project.id, [
      {
        title: 'Plan changes',
        status: 'pending',
      },
      {
        title: 'Implement feature',
        status: 'in_progress',
      },
    ]);

    expect(replaced.todos).toHaveLength(2);
    expect(replaced.summary).toMatchObject({
      projectId: project.id,
      total: 2,
      pending: 1,
      inProgress: 1,
      completed: 0,
      allComplete: false,
    });

    const firstTodoId = replaced.todos[0].id;
    const updated = await htmlProjectStore.updateTodo(project.id, firstTodoId, {
      status: 'completed',
    });

    expect(updated.todo).toMatchObject({
      id: firstTodoId,
      status: 'completed',
    });
    expect(updated.todo.completedAt).toBe(1700000002000);

    const summaryAfterUpdate = await htmlProjectStore.getTodoSummary(project.id);
    expect(summaryAfterUpdate).toMatchObject({
      total: 2,
      pending: 0,
      inProgress: 1,
      completed: 1,
      allComplete: false,
    });

    const deleted = await htmlProjectStore.deleteTodo(project.id, firstTodoId);
    expect(deleted).toMatchObject({
      deleted: firstTodoId,
      summary: {
        total: 1,
        pending: 0,
        inProgress: 1,
        completed: 0,
        allComplete: false,
      },
    });

    const remainingTodos = await htmlProjectStore.listTodos(project.id);
    expect(remainingTodos).toHaveLength(1);
    expect(remainingTodos[0].title).toBe('Implement feature');
  });

  it('deletes a single project record, files, snapshots, and todos without touching other assistants', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1700000000000)
      .mockReturnValueOnce(1700000001000)
      .mockReturnValueOnce(1700000002000)
      .mockReturnValueOnce(1700000003000)
      .mockReturnValueOnce(1700000004000)
      .mockReturnValueOnce(1700000005000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const targetProject = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Delete Me',
    });
    const otherAssistantProject = await htmlProjectStore.createProject({
      assistantId: 'assistant-2',
      name: 'Keep Me',
    });

    await htmlProjectStore.writeFiles(targetProject.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>delete me</main>',
      },
    ]);
    await htmlProjectStore.writeFiles(otherAssistantProject.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>keep me</main>',
      },
    ]);
    await htmlProjectStore.replaceTodos(targetProject.id, [
      {
        title: 'Delete todo',
      },
    ]);
    const snapshot = await htmlProjectStore.createSnapshot(targetProject.id, 'delete snapshot');

    const deletedProject = await htmlProjectStore.deleteProject(targetProject.id, 'assistant-1');

    expect(deletedProject).toMatchObject({
      id: targetProject.id,
      assistantId: 'assistant-1',
      name: 'Delete Me',
    });
    await expect(
      htmlProjectStore.assertProjectOwnership(targetProject.id, 'assistant-1'),
    ).rejects.toThrow(`HTML project ${targetProject.id} not found.`);
    expect(await htmlProjectStore.listFiles(targetProject.id)).toEqual([]);
    expect(mockDb.delete).toHaveBeenCalledWith('htmlProjectFiles', [
      targetProject.id,
      '/index.html',
    ]);
    expect(mockDb.delete).toHaveBeenCalledWith('htmlProjectSnapshots', [
      targetProject.id,
      snapshot.version,
    ]);
    expect(mockDb.delete).toHaveBeenCalledWith('htmlProjectTodos', [
      targetProject.id,
      'todo-1700000003000-0',
    ]);
    expect(mockDb.delete).toHaveBeenCalledWith('htmlProjects', targetProject.id);
    await expect(
      htmlProjectStore.assertProjectOwnership(otherAssistantProject.id, 'assistant-2'),
    ).resolves.toMatchObject({
      id: otherAssistantProject.id,
      name: 'Keep Me',
    });
    expect(
      (await htmlProjectStore.listFiles(otherAssistantProject.id)).map(file => file.path),
    ).toEqual(['/index.html']);
  });

  it('rejects single-project deletion when the assistant does not own the project', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Protected Project',
    });

    await expect(htmlProjectStore.deleteProject(project.id, 'assistant-2')).rejects.toThrow(
      `HTML project ${project.id} not found.`,
    );

    await expect(
      htmlProjectStore.assertProjectOwnership(project.id, 'assistant-1'),
    ).resolves.toMatchObject({
      id: project.id,
      assistantId: 'assistant-1',
    });
  });

  it('deletes every project, file, and snapshot for the assistant only', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1700000000000)
      .mockReturnValueOnce(1700000001000)
      .mockReturnValueOnce(1700000002000)
      .mockReturnValueOnce(1700000003000)
      .mockReturnValueOnce(1700000004000)
      .mockReturnValueOnce(1700000005000)
      .mockReturnValueOnce(1700000006000)
      .mockReturnValueOnce(1700000007000)
      .mockReturnValueOnce(1700000008000)
      .mockReturnValueOnce(1700000009000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const firstProject = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Assistant One A',
    });
    const secondProject = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Assistant One B',
    });
    const otherAssistantProject = await htmlProjectStore.createProject({
      assistantId: 'assistant-2',
      name: 'Assistant Two A',
    });

    await htmlProjectStore.writeFiles(firstProject.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>first</main>',
      },
    ]);
    await htmlProjectStore.writeFiles(secondProject.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>second</main>',
      },
    ]);
    await htmlProjectStore.writeFiles(otherAssistantProject.id, [
      {
        path: 'index.html',
        kind: 'html',
        content: '<main>other</main>',
      },
    ]);
    await htmlProjectStore.replaceTodos(firstProject.id, [{ title: 'First todo' }]);
    await htmlProjectStore.replaceTodos(secondProject.id, [{ title: 'Second todo' }]);
    await htmlProjectStore.createSnapshot(firstProject.id, 'first snapshot');
    await htmlProjectStore.createSnapshot(secondProject.id, 'second snapshot');

    const deletedCount = await htmlProjectStore.deleteProjectsByAssistant('assistant-1');

    expect(deletedCount).toBe(2);
    await expect(
      htmlProjectStore.assertProjectOwnership(firstProject.id, 'assistant-1'),
    ).rejects.toThrow(`HTML project ${firstProject.id} not found.`);
    await expect(
      htmlProjectStore.assertProjectOwnership(secondProject.id, 'assistant-1'),
    ).rejects.toThrow(`HTML project ${secondProject.id} not found.`);
    await expect(
      htmlProjectStore.assertProjectOwnership(otherAssistantProject.id, 'assistant-2'),
    ).resolves.toMatchObject({
      id: otherAssistantProject.id,
    });
    expect(await htmlProjectStore.listProjectsByAssistant('assistant-1')).toEqual([]);
    expect(
      (await htmlProjectStore.listFiles(otherAssistantProject.id)).map(file => file.path),
    ).toEqual(['/index.html']);
  });
});

// ============================================================================
// T4 Harness store tests (G11): listSnapshots, revertToSnapshot, retention
// ============================================================================

describe('htmlProjectStore snapshots (G11)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('listSnapshots returns snapshots sorted newest-first with retainedLimit', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    const nowBase = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(nowBase);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Snapshots',
    });

    // Create 3 snapshots at different previewVersions
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<div>v1</div>' },
    ]);
    await htmlProjectStore.createSnapshot(project.id, 'first');

    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<div>v2</div>' },
    ]);
    await htmlProjectStore.createSnapshot(project.id, 'second');

    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<div>v3</div>' },
    ]);
    await htmlProjectStore.createSnapshot(project.id, 'third');

    const result = await htmlProjectStore.listSnapshots(project.id);

    expect(result.projectId).toBe(project.id);
    expect(result.retainedLimit).toBe(20);
    expect(result.snapshots).toHaveLength(3);
    // Newest-first: third (version 3), second (2), first (1)
    expect(result.snapshots.map(s => s.version)).toEqual([3, 2, 1]);
    expect(result.snapshots.map(s => s.note)).toEqual(['third', 'second', 'first']);
  });

  it('revertToSnapshot restores files and monotonically increments previewVersion', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Revert',
    });

    // v1: index.html + app.js
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<div>v1</div>' },
      { path: '/app.js', kind: 'js', content: 'console.log("v1");' },
    ]);
    await htmlProjectStore.createSnapshot(project.id, 'v1');

    // v2: index.html changed, app.js deleted, styles.css added
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<div>v2</div>' },
      { path: '/styles.css', kind: 'css', content: 'body { color: red; }' },
    ]);
    await htmlProjectStore.deleteFile(project.id, '/app.js');
    const afterV2 = await htmlProjectStore.assertProjectOwnership(project.id, 'assistant-1');
    expect(afterV2.previewVersion).toBe(3); // 2 writes + 1 delete

    // Revert to v1 (snapshot version 1)
    const result = await htmlProjectStore.revertToSnapshot(project.id, 1);

    expect(result.projectId).toBe(project.id);
    expect(result.revertedToVersion).toBe(1);
    expect(result.previewVersion).toBe(afterV2.previewVersion + 1);
    expect(result.runtimeDiagnosticsCleared).toBe(true);
    expect(result.filesRestored).toBe(2); // index.html + app.js

    // Verify files are actually restored
    const filesAfter = await htmlProjectStore.listProjectFiles(project.id);
    const paths = filesAfter.map(f => f.path).sort();
    expect(paths).toEqual(['/app.js', '/index.html']);

    const indexFile = filesAfter.find(f => f.path === '/index.html');
    expect(indexFile?.content).toBe('<div>v1</div>'); // reverted to v1 content

    const appFile = filesAfter.find(f => f.path === '/app.js');
    expect(appFile?.content).toBe('console.log("v1");');

    // styles.css should be gone (not in snapshot)
    expect(filesAfter.find(f => f.path === '/styles.css')).toBeUndefined();

    // previewVersion should be monotonic (current + 1, not reset to 2)
    const afterRevert = await htmlProjectStore.assertProjectOwnership(project.id, 'assistant-1');
    expect(afterRevert.previewVersion).toBe(afterV2.previewVersion + 1);
  });

  it('revertToSnapshot throws for missing snapshot version', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { htmlProjectStore } = await import('./htmlProjectStore');
    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Missing',
    });

    await expect(htmlProjectStore.revertToSnapshot(project.id, 99)).rejects.toThrow(
      'Project snapshot version 99 not found.',
    );
  });

  it('retention evicts oldest snapshots beyond limit of 20', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { htmlProjectStore, SNAPSHOT_RETENTION_LIMIT } = await import('./htmlProjectStore');
    expect(SNAPSHOT_RETENTION_LIMIT).toBe(20);

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Retention',
    });

    // Create 23 snapshots (each needs a previewVersion bump)
    for (let i = 0; i < 23; i += 1) {
      await htmlProjectStore.writeFiles(project.id, [
        { path: '/index.html', kind: 'html', content: `<div>v${i}</div>` },
      ]);
      await htmlProjectStore.createSnapshot(project.id, `snap-${i}`);
    }

    const result = await htmlProjectStore.listSnapshots(project.id);
    expect(result.snapshots).toHaveLength(20);

    // Should keep versions 4..23 (newest 20), evict versions 1..3
    const versions = result.snapshots.map(s => s.version);
    expect(Math.min(...versions)).toBe(4);
    expect(Math.max(...versions)).toBe(23);

    // Oldest snapshots should have been deleted via db.delete
    expect(mockDb.delete).toHaveBeenCalledWith('htmlProjectSnapshots', [project.id, 1]);
    expect(mockDb.delete).toHaveBeenCalledWith('htmlProjectSnapshots', [project.id, 2]);
    expect(mockDb.delete).toHaveBeenCalledWith('htmlProjectSnapshots', [project.id, 3]);
  });

  it('createSnapshot persists file contents for revert', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    const project = await htmlProjectStore.createProject({
      assistantId: 'assistant-1',
      name: 'Contents',
    });

    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<div>snapshot content</div>' },
    ]);

    const snapshot = await htmlProjectStore.createSnapshot(project.id, 'with-content');

    // Public snapshot type only has paths
    expect(snapshot.files).toEqual(['/index.html']);
    expect(snapshot.version).toBe(1);

    // But internal record (stored in mock DB) should have fileEntries
    const stored = await mockDb.get('htmlProjectSnapshots', [project.id, snapshot.version]);
    expect(stored).toBeDefined();
    expect((stored as { fileEntries?: unknown }).fileEntries).toBeDefined();
    const entries = (stored as { fileEntries: Array<{ path: string; content: string }> })
      .fileEntries;
    expect(entries[0].path).toBe('/index.html');
    expect(entries[0].content).toBe('<div>snapshot content</div>');
  });
});
