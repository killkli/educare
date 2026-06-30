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
const SEARCHABLE_FILE_KINDS = new Set<HtmlProjectFileKind>([
  'html',
  'css',
  'js',
  'json',
  'svg',
  'md',
]);
const DEFAULT_SEARCH_RESULT_LIMIT = 20;
const MAX_SEARCH_RESULTS_PER_FILE = 5;
const MAX_SEARCHABLE_FILE_SIZE = 250 * 1024;
const SEARCH_SNIPPET_RADIUS = 120;

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

export interface HtmlProjectSearchMatch {
  path: string;
  kind: HtmlProjectFileKind;
  line: number;
  column: number;
  snippet: string;
  matchCount: number;
}

export interface HtmlProjectSkippedFile {
  path: string;
  reason: 'unsupported-kind' | 'binary-encoding' | 'file-too-large';
}

export interface SearchHtmlProjectFilesInput {
  query: string;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface SearchHtmlProjectFilesResult {
  [key: string]: unknown;
  projectId: string;
  query: string;
  caseSensitive: boolean;
  scannedFiles: number;
  matches: HtmlProjectSearchMatch[];
  skippedFiles: HtmlProjectSkippedFile[];
  truncated: boolean;
}

let dbPromise: Promise<IDBPDatabase<HtmlProjectDB>> | null = null;

const now = (): number => Date.now();

const normalizePath = (path: string): string => {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    throw new Error('Project file path is required.');
  }

  const normalizedPath = (trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`)
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);

  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe project file path: ${path}`);
  }

  return `/${segments.join('/')}`;
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

const buildSearchSnippet = (content: string, matchIndex: number, queryLength: number): string => {
  const start = Math.max(0, matchIndex - SEARCH_SNIPPET_RADIUS);
  const end = Math.min(content.length, matchIndex + queryLength + SEARCH_SNIPPET_RADIUS);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
};

const getLineAndColumn = (
  content: string,
  matchIndex: number,
): { line: number; column: number } => {
  const previousContent = content.slice(0, matchIndex);
  const line = previousContent.split('\n').length;
  const lastNewlineIndex = previousContent.lastIndexOf('\n');
  const column = matchIndex - lastNewlineIndex;
  return { line, column };
};

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

  async assertProjectOwnership(projectId: string, assistantId: string): Promise<HtmlProject> {
    const db = await getDb();
    const project = await db.get(PROJECTS_STORE, projectId);

    if (!project || project.assistantId !== assistantId) {
      throw new Error(`HTML project ${projectId} not found.`);
    }

    return project;
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

  async listProjectFiles(projectId: string): Promise<HtmlProjectFile[]> {
    const db = await getDb();
    const files = await db.getAllFromIndex(PROJECT_FILES_STORE, 'by-project', projectId);
    return files.sort((a, b) => a.path.localeCompare(b.path));
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

  async searchFiles(
    projectId: string,
    input: SearchHtmlProjectFilesInput,
  ): Promise<SearchHtmlProjectFilesResult> {
    const query = input.query.trim();
    if (!query) {
      throw new Error('searchFiles query is required.');
    }

    const db = await getDb();
    await requireProject(db, projectId);

    const files = await db.getAllFromIndex(PROJECT_FILES_STORE, 'by-project', projectId);
    const normalizedQuery = input.caseSensitive ? query : query.toLowerCase();
    const maxResults = Math.max(1, input.maxResults ?? DEFAULT_SEARCH_RESULT_LIMIT);
    const matches: HtmlProjectSearchMatch[] = [];
    const skippedFiles: HtmlProjectSkippedFile[] = [];
    let truncated = false;
    let scannedFiles = 0;

    for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
      if (!SEARCHABLE_FILE_KINDS.has(file.kind)) {
        skippedFiles.push({ path: file.path, reason: 'unsupported-kind' });
        continue;
      }

      if (file.encoding === 'base64') {
        skippedFiles.push({ path: file.path, reason: 'binary-encoding' });
        continue;
      }

      if (file.size > MAX_SEARCHABLE_FILE_SIZE) {
        skippedFiles.push({ path: file.path, reason: 'file-too-large' });
        continue;
      }

      scannedFiles += 1;
      const haystack = input.caseSensitive ? file.content : file.content.toLowerCase();
      let searchIndex = 0;
      let fileMatchCount = 0;

      while (searchIndex <= haystack.length - normalizedQuery.length) {
        const matchIndex = haystack.indexOf(normalizedQuery, searchIndex);
        if (matchIndex === -1) {
          break;
        }

        fileMatchCount += 1;

        if (fileMatchCount <= MAX_SEARCH_RESULTS_PER_FILE && matches.length < maxResults) {
          const { line, column } = getLineAndColumn(file.content, matchIndex);
          matches.push({
            path: file.path,
            kind: file.kind,
            line,
            column,
            snippet: buildSearchSnippet(file.content, matchIndex, query.length),
            matchCount: fileMatchCount,
          });
        }

        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }

        searchIndex = matchIndex + normalizedQuery.length;
      }

      if (truncated) {
        break;
      }
    }

    return {
      projectId,
      query,
      caseSensitive: Boolean(input.caseSensitive),
      scannedFiles,
      matches,
      skippedFiles,
      truncated,
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

  private async deleteProjectRecords(projectId: string): Promise<void> {
    const db = await getDb();
    const files = await db.getAllFromIndex(PROJECT_FILES_STORE, 'by-project', projectId);
    for (const file of files) {
      await db.delete(PROJECT_FILES_STORE, [projectId, file.path]);
    }

    const snapshots = await db.getAllFromIndex(PROJECT_SNAPSHOTS_STORE, 'by-project', projectId);
    for (const snapshot of snapshots) {
      await db.delete(PROJECT_SNAPSHOTS_STORE, [projectId, snapshot.version]);
    }

    await db.delete(PROJECTS_STORE, projectId);
  }

  async deleteProject(projectId: string, assistantId: string): Promise<HtmlProject> {
    const project = await this.assertProjectOwnership(projectId, assistantId);
    await this.deleteProjectRecords(project.id);
    return project;
  }

  async deleteProjectsByAssistant(assistantId: string): Promise<number> {
    const projects = await this.listProjectsByAssistant(assistantId);

    for (const project of projects) {
      await this.deleteProjectRecords(project.id);
    }

    return projects.length;
  }
}

export const htmlProjectStore = new HtmlProjectStore();
