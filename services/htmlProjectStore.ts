import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  HtmlProject,
  HtmlProjectFile,
  HtmlProjectFileDescriptor,
  HtmlProjectFileKind,
  HtmlProjectSnapshot,
  HtmlProjectTodo,
  HtmlProjectTodoStatus,
  HtmlProjectTodoSummary,
} from '../types';

const HTML_PROJECT_DB_NAME = 'educare-html-projects';
const HTML_PROJECT_DB_VERSION = 2;
const PROJECTS_STORE = 'htmlProjects';
const PROJECT_FILES_STORE = 'htmlProjectFiles';
const PROJECT_SNAPSHOTS_STORE = 'htmlProjectSnapshots';
const PROJECT_TODOS_STORE = 'htmlProjectTodos';
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
  [PROJECT_TODOS_STORE]: {
    key: [string, string];
    value: HtmlProjectTodo;
    indexes: {
      'by-project': string;
      'by-project-order': [string, number];
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

export interface ReplaceHtmlProjectTodosInput {
  id?: string;
  title: string;
  description?: string;
  status?: HtmlProjectTodoStatus;
  order?: number;
}

export interface UpdateHtmlProjectTodoInput {
  title?: string;
  description?: string;
  status?: HtmlProjectTodoStatus;
  order?: number;
}

let dbPromise: Promise<IDBPDatabase<HtmlProjectDB>> | null = null;

const now = (): number => Date.now();
const HTML_PROJECT_PATH_GUIDANCE =
  'Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Do not use host filesystem paths or URLs.';
const EXTERNAL_PROJECT_REFERENCE_PATTERN = /^([a-z][a-z\d+.-]*:|\/\/)/i;
const normalizeProjectPathSlashes = (path: string): string => path.replace(/\\/g, '/');
const isExternalProjectReference = (path: string): boolean =>
  EXTERNAL_PROJECT_REFERENCE_PATTERN.test(normalizeProjectPathSlashes(path));

export class HtmlProjectPathValidationError extends Error {
  readonly code: string;
  readonly guidance: string;
  readonly path: string;

  constructor(path: string, code: string, message: string, guidance = HTML_PROJECT_PATH_GUIDANCE) {
    super(message);
    this.name = 'HtmlProjectPathValidationError';
    this.code = code;
    this.guidance = guidance;
    this.path = path;
  }
}

export const normalizePath = (path: string): string => {
  if (
    Array.from(path).some(character => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new HtmlProjectPathValidationError(
      path,
      'invalid-control-characters',
      `Project file path contains invalid control characters: ${path}`,
    );
  }

  const trimmedPath = path.trim();
  if (!trimmedPath) {
    throw new HtmlProjectPathValidationError(
      path,
      'missing-path',
      'Project file path is required.',
    );
  }

  const slashNormalizedPath = normalizeProjectPathSlashes(trimmedPath);
  if (isExternalProjectReference(slashNormalizedPath)) {
    throw new HtmlProjectPathValidationError(
      path,
      'path-outside-project-root',
      `Project file path must stay inside the virtual project root: ${path}`,
    );
  }

  const normalizedPath = (
    slashNormalizedPath.startsWith('/') ? slashNormalizedPath : `/${slashNormalizedPath}`
  ).replace(/\/+/g, '/');
  const resolvedSegments: string[] = [];

  for (const segment of normalizedPath.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      throw new HtmlProjectPathValidationError(
        path,
        'path-parent-traversal',
        `Project file path must not use parent-directory traversal: ${path}`,
      );
    }
    resolvedSegments.push(segment);
  }

  if (resolvedSegments.length === 0) {
    throw new HtmlProjectPathValidationError(
      path,
      'path-resolved-to-root',
      `Project file path must include a file inside the virtual project root: ${path}`,
    );
  }

  return `/${resolvedSegments.join('/')}`;
};

const inferDependencies = (kind: HtmlProjectFileKind, content: string): string[] => {
  const dependencies = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    if (isExternalProjectReference(trimmed)) {
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

        if (!db.objectStoreNames.contains(PROJECT_TODOS_STORE)) {
          const todoStore = db.createObjectStore(PROJECT_TODOS_STORE, {
            keyPath: ['projectId', 'id'],
          });
          todoStore.createIndex('by-project', 'projectId');
          todoStore.createIndex('by-project-order', ['projectId', 'order']);
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

const normalizeTodoStatus = (status?: HtmlProjectTodoStatus): HtmlProjectTodoStatus => {
  return status ?? 'pending';
};

const buildTodoSummary = (projectId: string, todos: HtmlProjectTodo[]): HtmlProjectTodoSummary => {
  const summary = todos.reduce(
    (accumulator, todo) => {
      if (todo.status === 'completed') {
        accumulator.completed += 1;
      } else if (todo.status === 'in_progress') {
        accumulator.inProgress += 1;
      } else {
        accumulator.pending += 1;
      }
      return accumulator;
    },
    {
      projectId,
      total: todos.length,
      pending: 0,
      inProgress: 0,
      completed: 0,
      allComplete: false,
    },
  );

  summary.allComplete = summary.total > 0 && summary.completed === summary.total;
  return summary;
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

  async renameProject(projectId: string, assistantId: string, name: string): Promise<HtmlProject> {
    const db = await getDb();
    const project = await this.assertProjectOwnership(projectId, assistantId);
    const trimmedName = name.trim();

    if (!trimmedName) {
      throw new Error('Project name is required.');
    }

    const nextProject: HtmlProject = {
      ...project,
      name: trimmedName,
      updatedAt: now(),
    };

    await updateProjectRecord(db, nextProject);
    return nextProject;
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

  async copyFile(
    projectId: string,
    sourcePath: string,
    destinationPath: string,
  ): Promise<{ sourcePath: string; destinationPath: string; previewVersion: number }> {
    const db = await getDb();
    const project = await requireProject(db, projectId);
    const normalizedSourcePath = normalizePath(sourcePath);
    const normalizedDestinationPath = normalizePath(destinationPath);

    if (normalizedSourcePath === normalizedDestinationPath) {
      throw new Error('Source and destination paths must be different.');
    }

    const existingFile = await db.get(PROJECT_FILES_STORE, [projectId, normalizedSourcePath]);
    if (!existingFile) {
      throw new Error(`Project file ${normalizedSourcePath} not found.`);
    }

    const destinationFile = await db.get(PROJECT_FILES_STORE, [
      projectId,
      normalizedDestinationPath,
    ]);
    if (destinationFile) {
      throw new Error(`Project file ${normalizedDestinationPath} already exists.`);
    }

    const timestamp = now();
    const copiedFile: HtmlProjectFile = {
      ...existingFile,
      path: normalizedDestinationPath,
      dependencies: inferDependencies(existingFile.kind, existingFile.content),
      size: existingFile.content.length,
      updatedAt: timestamp,
    };
    const assetPaths = new Set(project.assetPaths);

    await db.put(PROJECT_FILES_STORE, copiedFile);

    if (copiedFile.kind === 'asset') {
      assetPaths.add(normalizedDestinationPath);
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
      sourcePath: normalizedSourcePath,
      destinationPath: normalizedDestinationPath,
      previewVersion: nextProject.previewVersion,
    };
  }

  async renameFile(
    projectId: string,
    sourcePath: string,
    destinationPath: string,
  ): Promise<{ sourcePath: string; destinationPath: string; previewVersion: number }> {
    const db = await getDb();
    const project = await requireProject(db, projectId);
    const normalizedSourcePath = normalizePath(sourcePath);
    const normalizedDestinationPath = normalizePath(destinationPath);

    if (normalizedSourcePath === normalizedDestinationPath) {
      throw new Error('Source and destination paths must be different.');
    }

    const existingFile = await db.get(PROJECT_FILES_STORE, [projectId, normalizedSourcePath]);
    if (!existingFile) {
      throw new Error(`Project file ${normalizedSourcePath} not found.`);
    }

    const destinationFile = await db.get(PROJECT_FILES_STORE, [
      projectId,
      normalizedDestinationPath,
    ]);
    if (destinationFile) {
      throw new Error(`Project file ${normalizedDestinationPath} already exists.`);
    }

    const timestamp = now();
    const renamedFile: HtmlProjectFile = {
      ...existingFile,
      path: normalizedDestinationPath,
      dependencies: inferDependencies(existingFile.kind, existingFile.content),
      size: existingFile.content.length,
      updatedAt: timestamp,
    };
    const assetPaths = new Set(project.assetPaths);

    await db.put(PROJECT_FILES_STORE, renamedFile);
    await db.delete(PROJECT_FILES_STORE, [projectId, normalizedSourcePath]);

    if (renamedFile.kind === 'asset') {
      assetPaths.delete(normalizedSourcePath);
      assetPaths.add(normalizedDestinationPath);
    }

    const nextProject: HtmlProject = {
      ...project,
      entryFile:
        project.entryFile === normalizedSourcePath ? normalizedDestinationPath : project.entryFile,
      assetPaths: Array.from(assetPaths).sort(),
      updatedAt: timestamp,
      previewVersion: project.previewVersion + 1,
      status: 'draft',
      lastBuildError: null,
    };

    await updateProjectRecord(db, nextProject);

    return {
      sourcePath: normalizedSourcePath,
      destinationPath: normalizedDestinationPath,
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

  async listTodos(projectId: string): Promise<HtmlProjectTodo[]> {
    const db = await getDb();
    await requireProject(db, projectId);
    const todos = await db.getAllFromIndex(PROJECT_TODOS_STORE, 'by-project', projectId);
    return todos.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  async getTodoSummary(projectId: string): Promise<HtmlProjectTodoSummary> {
    return buildTodoSummary(projectId, await this.listTodos(projectId));
  }

  async replaceTodos(
    projectId: string,
    items: ReplaceHtmlProjectTodosInput[],
  ): Promise<{ todos: HtmlProjectTodo[]; summary: HtmlProjectTodoSummary }> {
    const db = await getDb();
    await requireProject(db, projectId);
    const existingTodos = await db.getAllFromIndex(PROJECT_TODOS_STORE, 'by-project', projectId);
    for (const todo of existingTodos) {
      await db.delete(PROJECT_TODOS_STORE, [projectId, todo.id]);
    }

    const timestamp = now();
    const todos: HtmlProjectTodo[] = [];
    for (const [index, item] of items.entries()) {
      const todo: HtmlProjectTodo = {
        projectId,
        id: item.id?.trim() || `todo-${timestamp}-${index}`,
        title: item.title,
        description: item.description,
        status: normalizeTodoStatus(item.status),
        order: item.order ?? index,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: normalizeTodoStatus(item.status) === 'completed' ? timestamp : null,
      };
      await db.put(PROJECT_TODOS_STORE, todo);
      todos.push(todo);
    }

    const normalizedTodos = todos.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    return {
      todos: normalizedTodos,
      summary: buildTodoSummary(projectId, normalizedTodos),
    };
  }

  async updateTodo(
    projectId: string,
    todoId: string,
    patch: UpdateHtmlProjectTodoInput,
  ): Promise<{ todo: HtmlProjectTodo; summary: HtmlProjectTodoSummary }> {
    const db = await getDb();
    await requireProject(db, projectId);
    const todo = await db.get(PROJECT_TODOS_STORE, [projectId, todoId]);
    if (!todo) {
      throw new Error(`Project todo ${todoId} not found.`);
    }

    const timestamp = now();
    const nextStatus = patch.status ?? todo.status;
    const nextTodo: HtmlProjectTodo = {
      ...todo,
      title: typeof patch.title === 'undefined' ? todo.title : patch.title,
      description: typeof patch.description === 'undefined' ? todo.description : patch.description,
      status: nextStatus,
      order: typeof patch.order === 'undefined' ? todo.order : patch.order,
      updatedAt: timestamp,
      completedAt:
        nextStatus === 'completed'
          ? todo.status === 'completed' && todo.completedAt
            ? todo.completedAt
            : timestamp
          : null,
    };

    await db.put(PROJECT_TODOS_STORE, nextTodo);
    return {
      todo: nextTodo,
      summary: await this.getTodoSummary(projectId),
    };
  }

  async deleteTodo(
    projectId: string,
    todoId: string,
  ): Promise<{ deleted: string; summary: HtmlProjectTodoSummary }> {
    const db = await getDb();
    await requireProject(db, projectId);
    const todo = await db.get(PROJECT_TODOS_STORE, [projectId, todoId]);
    if (!todo) {
      throw new Error(`Project todo ${todoId} not found.`);
    }

    await db.delete(PROJECT_TODOS_STORE, [projectId, todoId]);
    return {
      deleted: todoId,
      summary: await this.getTodoSummary(projectId),
    };
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

    const todos = await db.getAllFromIndex(PROJECT_TODOS_STORE, 'by-project', projectId);
    for (const todo of todos) {
      await db.delete(PROJECT_TODOS_STORE, [projectId, todo.id]);
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
