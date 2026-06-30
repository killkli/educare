import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlProject, HtmlProjectFile, HtmlProjectSnapshot } from '../types';

type ProjectRecord = HtmlProject;
type FileRecord = HtmlProjectFile;
type SnapshotRecord = HtmlProjectSnapshot;

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

  return {
    put: vi.fn(async (storeName: string, value: ProjectRecord | FileRecord | SnapshotRecord) => {
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
      }
    }),
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
    const htmlFile = await htmlProjectStore.readFile(project.id, 'index.html');

    expect(writeResult).toEqual({
      updated: ['/styles/app.css', '/index.html'],
      previewVersion: 1,
    });
    expect(updatedProject?.previewVersion).toBe(1);
    expect(files.map(file => file.path)).toEqual(['/index.html', '/styles/app.css']);
    expect(htmlFile).toMatchObject({
      path: '/index.html',
      dependencies: ['/styles/app.css'],
    });
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
      .mockReturnValueOnce(1700000007000);

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
