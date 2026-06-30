import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  HtmlProject,
  HtmlProjectFile,
  HtmlProjectFileDescriptor,
  HtmlProjectFileKind,
  HtmlProjectSnapshot,
} from '../types';

const HTML_PROJECT_DB_NAME = 'educare-html-projects';
const HTML_PROJECT_DB_VERSION = 1;
const PROJECTS_STORE = 'htmlProjects';
const PROJECT_FILES_STORE = 'htmlProjectFiles';
const PROJECT_SNAPSHOTS_STORE = 'htmlProjectSnapshots';

interface HtmlProjectDB extends DBSchema {
  [PROJECTS_STORE]: {
    key: string;
    value: HtmlProject;
    indexes: {
      'by-assistant': string;
      'by-session': string;
      'by-updated-at': number;
    };
  };
  [PROJECT_FILES_STORE]: {
    key: [string, string];
    value: HtmlProjectFile;
    indexes: {
      'by-project': string;
      'by-project-updated-at': [string, number];
    };
  };
  [PROJECT_SNAPSHOTS_STORE]: {
    key: [string, number];
    value: HtmlProjectSnapshot;
    indexes: {
      'by-project': string;
    };
  };
}

export interface CreateHtmlProjectInput {
  assistantId: string;
  sessionId?: string | null;
  name: string;
  description?: string;
  entryFile?: string;
  lastPrompt?: string;
  tags?: string[];
}

export interface WriteHtmlProjectFileInput {
  path: string;
  kind: HtmlProjectFileKind;
  content: string;
  encoding?: 'utf-8' | 'base64';
}

export interface WriteHtmlProjectFilesResult {
  updated: string[];
  previewVersion: number;
}

let dbPromise: Promise<IDBPDatabase<HtmlProjectDB>> | null = null;

const now = (): number => Date.now();

const normalizePath = (path: string): string => {
  if (!path.trim()) {
    throw new Error('Project file path is required.');
  }

  return path.startsWith('/') ? path : `/${path}`;
};

const inferDependencies = (kind: HtmlProjectFileKind, content: string): string[] => {
  const dependencies = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || /^([a-z]+:|#|\/\/)/i.test(trimmed)) {
      return;
    }
    dependencies.add(normalizePath(trimmed));
  };

  if (kind === 'html') {
    const htmlRefPattern = /(?:href|src)=['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(htmlRefPattern)) {
      add(match[1]);
    }
  }

  if (kind === 'css') {
    const cssRefPattern = /url\(['"]?([^'")]+)['"]?\)|@import\s+['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(cssRefPattern)) {
      add(match[1] || match[2]);
    }
  }

  if (kind === 'js') {
    const jsRefPattern = /import\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(jsRefPattern)) {
      add(match[1]);
    }
  }

  return Array.from(dependencies);
};

const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDB<HtmlProjectDB>(HTML_PROJECT_DB_NAME, HTML_PROJECT_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          const projectStore = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
          projectStore.createIndex('by-assistant', 'assistantId');
          projectStore.createIndex('by-session', 'sessionId');
          projectStore.createIndex('by-updated-at', 'updatedAt');
        }

        if (!db.objectStoreNames.contains(PROJECT_FILES_STORE)) {
          const fileStore = db.createObjectStore(PROJECT_FILES_STORE, {
            keyPath: ['projectId', 'path'],
          });
          fileStore.createIndex('by-project', 'projectId');
          fileStore.createIndex('by-project-updated-at', ['projectId', 'updatedAt']);
        }

        if (!db.objectStoreNames.contains(PROJECT_SNAPSHOTS_STORE)) {
          const snapshotStore = db.createObjectStore(PROJECT_SNAPSHOTS_STORE, {
            keyPath: ['projectId', 'version'],
          });
          snapshotStore.createIndex('by-project', 'projectId');
        }
      },
    });
  }

  return dbPromise;
};

const requireProject = async (
  db: IDBPDatabase<HtmlProjectDB>,
  projectId: string,
): Promise<HtmlProject> => {
  const project = await db.get(PROJECTS_STORE, projectId);
  if (!project) {
    throw new Error(`HTML project ${projectId} not found.`);
  }
  return project;
};

const updateProjectRecord = async (
  db: IDBPDatabase<HtmlProjectDB>,
  project: HtmlProject,
): Promise<HtmlProject> => {
  await db.put(PROJECTS_STORE, project);
  return project;
};

const buildFileDescriptor = (file: HtmlProjectFile): HtmlProjectFileDescriptor => ({
  path: file.path,
  kind: file.kind,
  size: file.size,
  updatedAt: file.updatedAt,
  dependencies: file.dependencies,
});

class HtmlProjectStore {
  async createProject(input: CreateHtmlProjectInput): Promise<HtmlProject> {
    const db = await getDb();
    const timestamp = now();
    const project: HtmlProject = {
      id: `project-${timestamp}`,
      assistantId: input.assistantId,
      sessionId: input.sessionId ?? null,
      name: input.name,
      description: input.description,
      entryFile: normalizePath(input.entryFile || '/index.html'),
      status: 'draft',
      previewVersion: 0,
      assetPaths: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      lastPrompt: input.lastPrompt,
      lastBuildError: null,
      tags: input.tags,
    };

    await db.put(PROJECTS_STORE, project);
    return project;
  }

  async getProject(projectId: string): Promise<HtmlProject | undefined> {
    const db = await getDb();
    return db.get(PROJECTS_STORE, projectId);
  }

  async listProjectsByAssistant(assistantId: string): Promise<HtmlProject[]> {
    const db = await getDb();
    const projects = await db.getAllFromIndex(PROJECTS_STORE, 'by-assistant', assistantId);
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listFiles(projectId: string): Promise<HtmlProjectFileDescriptor[]> {
    const db = await getDb();
    const files = await db.getAllFromIndex(PROJECT_FILES_STORE, 'by-project', projectId);
    return files
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(file => buildFileDescriptor(file));
  }

  async readFile(projectId: string, path: string): Promise<HtmlProjectFile | undefined> {
    const db = await getDb();
    return db.get(PROJECT_FILES_STORE, [projectId, normalizePath(path)]);
  }

  async writeFile(
    projectId: string,
    file: WriteHtmlProjectFileInput,
  ): Promise<WriteHtmlProjectFilesResult> {
    return this.writeFiles(projectId, [file]);
  }

  async writeFiles(
    projectId: string,
    files: WriteHtmlProjectFileInput[],
  ): Promise<WriteHtmlProjectFilesResult> {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('writeFiles requires a non-empty files array.');
    }

    const db = await getDb();
    const project = await requireProject(db, projectId);
    const timestamp = now();
    const updatedPaths: string[] = [];
    const assetPaths = new Set(project.assetPaths);

    for (const file of files) {
      const normalizedPath = normalizePath(file.path);
      const projectFile: HtmlProjectFile = {
        projectId,
        path: normalizedPath,
        kind: file.kind,
        content: file.content,
        encoding: file.encoding || 'utf-8',
        dependencies: inferDependencies(file.kind, file.content),
        size: file.content.length,
        updatedAt: timestamp,
      };

      await db.put(PROJECT_FILES_STORE, projectFile);
      updatedPaths.push(normalizedPath);

      if (file.kind === 'asset') {
        assetPaths.add(normalizedPath);
      } else {
        assetPaths.delete(normalizedPath);
      }
    }

    const nextProject: HtmlProject = {
      ...project,
      assetPaths: Array.from(assetPaths).sort(),
      updatedAt: timestamp,
      previewVersion: project.previewVersion + 1,
      status: 'draft',
      lastBuildError: null,
    };

    await updateProjectRecord(db, nextProject);

    return {
      updated: updatedPaths,
      previewVersion: nextProject.previewVersion,
    };
  }

  async deleteFile(
    projectId: string,
    path: string,
  ): Promise<{ deleted: boolean; previewVersion: number }> {
    const db = await getDb();
    const project = await requireProject(db, projectId);
    const normalizedPath = normalizePath(path);
    const existingFile = await db.get(PROJECT_FILES_STORE, [projectId, normalizedPath]);

    if (!existingFile) {
      return {
        deleted: false,
        previewVersion: project.previewVersion,
      };
    }

    await db.delete(PROJECT_FILES_STORE, [projectId, normalizedPath]);

    const nextProject: HtmlProject = {
      ...project,
      assetPaths: project.assetPaths.filter(assetPath => assetPath !== normalizedPath),
      updatedAt: now(),
      previewVersion: project.previewVersion + 1,
      status: normalizedPath === project.entryFile ? 'error' : 'draft',
      lastBuildError:
        normalizedPath === project.entryFile
          ? 'Entrypoint file was deleted.'
          : project.lastBuildError,
    };

    await updateProjectRecord(db, nextProject);

    return {
      deleted: true,
      previewVersion: nextProject.previewVersion,
    };
  }

  async setEntrypoint(projectId: string, path: string): Promise<HtmlProject> {
    const db = await getDb();
    const project = await requireProject(db, projectId);
    const normalizedPath = normalizePath(path);

    const nextProject: HtmlProject = {
      ...project,
      entryFile: normalizedPath,
      updatedAt: now(),
      previewVersion: project.previewVersion + 1,
      status: 'draft',
      lastBuildError: null,
    };

    await updateProjectRecord(db, nextProject);
    return nextProject;
  }

  async createSnapshot(projectId: string, note?: string): Promise<HtmlProjectSnapshot> {
    const db = await getDb();
    const project = await requireProject(db, projectId);
    const files = await this.listFiles(projectId);
    const snapshot: HtmlProjectSnapshot = {
      projectId,
      version: project.previewVersion,
      files: files.map(file => file.path),
      createdAt: now(),
      note,
    };

    await db.put(PROJECT_SNAPSHOTS_STORE, snapshot);
    return snapshot;
  }
}

export const htmlProjectStore = new HtmlProjectStore();
