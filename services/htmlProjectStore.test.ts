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
    delete: vi.fn(async (storeName: string, key: [string, string]) => {
      if (storeName === 'htmlProjectFiles') {
        const [projectId, path] = key;
        files.delete(`${projectId}:${path}`);
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

  it('lists projects by assistant newest first', async () => {
    const mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
    vi.spyOn(Date, 'now').mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);

    const { htmlProjectStore } = await import('./htmlProjectStore');

    await htmlProjectStore.createProject({ assistantId: 'assistant-1', name: 'Older' });
    await htmlProjectStore.createProject({ assistantId: 'assistant-1', name: 'Newer' });

    const projects = await htmlProjectStore.listProjectsByAssistant('assistant-1');

    expect(projects.map(project => project.name)).toEqual(['Newer', 'Older']);
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
});
