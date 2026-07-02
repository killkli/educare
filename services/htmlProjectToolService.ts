import {
  HtmlProject,
  HtmlProjectFileKind,
  HtmlProjectToolExecutionResult,
  HtmlProjectWorkspaceUpdate,
} from '../types';
import type { ToolCall, ToolDefinition } from './llmAdapter';
import { htmlPreviewService } from './htmlPreviewService';
import {
  HtmlProjectPathValidationError,
  htmlProjectStore,
  type WriteHtmlProjectFileInput,
} from './htmlProjectStore';
import { getTemplateFiles, type HtmlProjectTemplate } from './htmlProjectTemplates';

const HTML_PROJECT_TOOL_NAMES = [
  'createProject',
  'listProjects',
  'openProject',
  'searchFiles',
  'writeFiles',
  'replaceInFile',
  'listFiles',
  'readFile',
  'deleteFile',
  'setEntrypoint',
  'renderPreview',
] as const;

interface HtmlProjectToolContext {
  assistantId: string;
  sessionId?: string | null;
  activeProjectId?: string | null;
}

interface CreateProjectArgs {
  name: string;
  description?: string;
  template?: HtmlProjectTemplate;
}

interface OpenProjectArgs {
  projectId: string;
}

interface SearchFilesArgs {
  projectId?: string;
  query: string;
  caseSensitive?: boolean;
}

interface WriteFilesArgs {
  projectId?: string;
  files:
    | Array<{
        path: string;
        content: string;
        kind?: HtmlProjectFileKind;
      }>
    | {
        path: string;
        content: string;
        kind?: HtmlProjectFileKind;
      };
}

interface ReadFileArgs {
  projectId?: string;
  path: string;
}

interface ReplaceInFileArgs {
  projectId?: string;
  path: string;
  oldText: string;
  newText: string;
}

interface DeleteFileArgs {
  projectId?: string;
  path: string;
}

interface SetEntrypointArgs {
  projectId?: string;
  path: string;
}

interface RenderPreviewArgs {
  projectId?: string;
}

const createWorkspaceUpdate = (
  activeProjectId: string | null,
  activityMessage: string,
  preview: HtmlProjectWorkspaceUpdate['preview'] = null,
): HtmlProjectWorkspaceUpdate => ({
  activeProjectId,
  preview,
  activityMessage,
});

const requireProjectId = (
  explicitProjectId: string | undefined,
  activeProjectId: string | null | undefined,
): string => {
  const projectId = explicitProjectId || activeProjectId;
  if (!projectId) {
    throw new Error('No active HTML project is available for this tool call.');
  }
  return projectId;
};

const requireOwnedProject = async (
  explicitProjectId: string | undefined,
  context: HtmlProjectToolContext,
): Promise<HtmlProject> => {
  const projectId = requireProjectId(explicitProjectId, context.activeProjectId);
  return htmlProjectStore.assertProjectOwnership(projectId, context.assistantId);
};

const summarizeSearchResult = (result: {
  query: string;
  scannedFiles: number;
  matches: unknown[];
  truncated: boolean;
}): string => {
  if (result.matches.length === 0) {
    return `在 ${result.scannedFiles} 個可搜尋檔案中找不到「${result.query}」的結果。`;
  }

  const suffix = result.truncated ? '結果已截斷。' : '結果完整。';
  return `在 ${result.scannedFiles} 個可搜尋檔案中找到 ${result.matches.length} 個「${result.query}」結果，${suffix}`;
};

const summarizeFileList = (paths: string[]): string => paths.join(', ');

const VIRTUAL_PROJECT_PATH_GUIDANCE =
  'Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Do not use host filesystem paths or URLs.';
const WRITE_FILE_MAX_BYTES = 24 * 1024;
const WRITE_FILES_MAX_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();

interface RecoverableToolErrorResult {
  ok: false;
  recoverable: true;
  code: string;
  message: string;
  guidance: string;
  details?: Record<string, unknown>;
}

class HtmlProjectToolRecoverableError extends Error {
  readonly result: RecoverableToolErrorResult;

  constructor(result: RecoverableToolErrorResult) {
    super(result.message);
    this.name = 'HtmlProjectToolRecoverableError';
    this.result = result;
  }
}

const createRecoverableToolExecutionResult = (
  toolName: string,
  error: RecoverableToolErrorResult,
  activeProjectId: string | null | undefined,
): HtmlProjectToolExecutionResult => ({
  toolName,
  summary: error.message,
  result: { ...error },
  workspace: createWorkspaceUpdate(activeProjectId ?? null, error.message),
});

const getRecoverableActiveProjectId = (
  args: Record<string, unknown>,
  activeProjectId: string | null | undefined,
): string | null => {
  const explicitProjectId = typeof args.projectId === 'string' ? args.projectId : null;
  return explicitProjectId || activeProjectId || null;
};

const getContentSizeInBytes = (content: string): number => textEncoder.encode(content).length;

const inferHtmlProjectFileKind = (path: string): HtmlProjectFileKind => {
  const normalizedPath = path.toLowerCase();

  if (normalizedPath.endsWith('.html') || normalizedPath.endsWith('.htm')) {
    return 'html';
  }

  if (normalizedPath.endsWith('.css') || normalizedPath.endsWith('.scss')) {
    return 'css';
  }

  if (
    normalizedPath.endsWith('.js') ||
    normalizedPath.endsWith('.mjs') ||
    normalizedPath.endsWith('.cjs') ||
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.tsx') ||
    normalizedPath.endsWith('.jsx')
  ) {
    return 'js';
  }

  if (normalizedPath.endsWith('.json')) {
    return 'json';
  }

  if (normalizedPath.endsWith('.svg')) {
    return 'svg';
  }

  if (normalizedPath.endsWith('.md') || normalizedPath.endsWith('.markdown')) {
    return 'md';
  }

  return 'asset';
};

const normalizeWriteFilesInput = (files: WriteFilesArgs['files']): WriteHtmlProjectFileInput[] => {
  const fileList = Array.isArray(files) ? files : files && typeof files === 'object' ? [files] : [];

  if (fileList.length === 0) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-write-files-input',
      message: 'writeFiles requires a non-empty files array.',
      guidance:
        'Pass one or more file objects in files[]. Use writeFiles for small complete files only.',
    });
  }

  let totalBytes = 0;

  return fileList.map((file, index) => {
    const path = typeof file.path === 'string' ? file.path.trim() : '';
    if (!path) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-write-file-path',
        message: `writeFiles.files[${index}] is missing a valid path.`,
        guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
      });
    }

    if (typeof file.content !== 'string') {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-write-file-content',
        message: `writeFiles.files[${index}] is missing string content.`,
        guidance:
          'Provide UTF-8 text content for text files. Use targeted edit tools for existing files.',
      });
    }

    const contentBytes = getContentSizeInBytes(file.content);
    if (contentBytes > WRITE_FILE_MAX_BYTES) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'write-file-too-large',
        message: `writeFiles payload for ${path} is too large (${contentBytes} bytes).`,
        guidance:
          'Use writeFiles only for small complete files. For existing files, readFile first and then use replaceInFile for targeted edits.',
        details: {
          path,
          contentBytes,
          maxBytes: WRITE_FILE_MAX_BYTES,
        },
      });
    }

    totalBytes += contentBytes;
    if (totalBytes > WRITE_FILES_MAX_BYTES) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'write-files-payload-too-large',
        message: `writeFiles payload is too large (${totalBytes} bytes across ${fileList.length} files).`,
        guidance:
          'Split the change into smaller writeFiles calls, or use replaceInFile for focused edits to existing files.',
        details: {
          contentBytes: totalBytes,
          maxBytes: WRITE_FILES_MAX_BYTES,
          fileCount: fileList.length,
        },
      });
    }

    return {
      path,
      content: file.content,
      kind: file.kind ?? inferHtmlProjectFileKind(path),
    };
  });
};

const handleCreateProject = async (
  args: CreateProjectArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await htmlProjectStore.createProject({
    assistantId: context.assistantId,
    sessionId: context.sessionId,
    name: args.name,
    description: args.description,
  });

  const templateFiles = getTemplateFiles(args.template);
  await htmlProjectStore.writeFiles(project.id, templateFiles);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已建立 HTML 專案「${project.name}」，入口檔為 ${project.entryFile}。`;

  return {
    toolName: 'createProject',
    summary,
    result: {
      projectId: project.id,
      entryFile: project.entryFile,
      created: true,
      files: templateFiles.map(file => file.path),
      previewVersion: preview.previewVersion,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

const handleListProjects = async (
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const projects = await htmlProjectStore.listProjectsByAssistant(context.assistantId);
  const summary =
    projects.length > 0
      ? `目前 assistant 共有 ${projects.length} 個 HTML 專案。`
      : '目前 assistant 尚無 HTML 專案。';

  return {
    toolName: 'listProjects',
    summary,
    result: {
      projects: projects.map(project => ({
        projectId: project.id,
        name: project.name,
        description: project.description,
        entryFile: project.entryFile,
        updatedAt: project.updatedAt,
        previewVersion: project.previewVersion,
      })),
    },
    workspace: createWorkspaceUpdate(context.activeProjectId ?? null, summary),
  };
};

const handleOpenProject = async (
  args: OpenProjectArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await htmlProjectStore.assertProjectOwnership(
    args.projectId,
    context.assistantId,
  );
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已開啟既有 HTML 專案「${project.name}」。`;

  return {
    toolName: 'openProject',
    summary,
    result: {
      projectId: project.id,
      name: project.name,
      entryFile: project.entryFile,
      previewVersion: preview.previewVersion,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

const handleSearchFiles = async (
  args: SearchFilesArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const searchResult = (await htmlProjectStore.searchFiles(project.id, {
    query: args.query,
    caseSensitive: args.caseSensitive,
  })) as unknown as {
    query: string;
    scannedFiles: number;
    matches: unknown[];
    truncated: boolean;
  } & Record<string, unknown>;
  const summary = summarizeSearchResult(searchResult);
  const result: Record<string, unknown> = {
    ...searchResult,
  };

  return {
    toolName: 'searchFiles',
    summary,
    result,
    workspace: createWorkspaceUpdate(project.id, summary),
  } as HtmlProjectToolExecutionResult;
};

const handleWriteFiles = async (
  args: WriteFilesArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const files = normalizeWriteFilesInput(args.files);
  const result = await htmlProjectStore.writeFiles(project.id, files);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已更新檔案：${summarizeFileList(result.updated)}。`;

  return {
    toolName: 'writeFiles',
    summary,
    result: {
      projectId: project.id,
      updated: result.updated,
      previewVersion: result.previewVersion,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

const handleReplaceInFile = async (
  args: ReplaceInFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  const oldText = typeof args.oldText === 'string' ? args.oldText : '';

  if (!path) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-replace-path',
      message: 'replaceInFile requires a valid path.',
      guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
    });
  }

  if (!oldText) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-replace-old-text',
      message: 'replaceInFile requires a non-empty oldText value.',
      guidance: 'Call readFile first, copy the exact text to replace, then retry replaceInFile.',
    });
  }

  if (typeof args.newText !== 'string') {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-replace-new-text',
      message: 'replaceInFile requires string newText.',
      guidance: 'Provide the replacement content as a string.',
    });
  }

  const file = await htmlProjectStore.readFile(project.id, path);
  if (!file) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'replace-file-not-found',
      message: `Project file ${path} not found.`,
      guidance:
        'Call listFiles or readFile first to confirm the exact project path before retrying.',
    });
  }

  if (file.encoding === 'base64') {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'replace-binary-file',
      message: `replaceInFile only supports text files, but ${file.path} uses ${file.encoding} encoding.`,
      guidance: 'Use writeFiles to replace the full asset instead of replaceInFile.',
    });
  }

  let matchCount = 0;
  let firstMatchIndex = -1;
  let searchIndex = 0;
  while (searchIndex <= file.content.length - oldText.length) {
    const matchIndex = file.content.indexOf(oldText, searchIndex);
    if (matchIndex === -1) {
      break;
    }
    if (firstMatchIndex === -1) {
      firstMatchIndex = matchIndex;
    }
    matchCount += 1;
    searchIndex = matchIndex + 1;
  }

  if (matchCount === 0) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'replace-old-text-not-found',
      message: `replaceInFile could not find the requested text in ${file.path}.`,
      guidance:
        'Call readFile again and retry with an exact oldText snippet from the current file contents.',
      details: {
        path: file.path,
      },
    });
  }

  if (matchCount > 1) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'replace-old-text-ambiguous',
      message: `replaceInFile found ${matchCount} matches in ${file.path}.`,
      guidance:
        'Use a longer oldText snippet that uniquely identifies the section to replace, or narrow the edit after reading the file again.',
      details: {
        path: file.path,
        matchCount,
      },
    });
  }

  const updatedContent =
    file.content.slice(0, firstMatchIndex) +
    args.newText +
    file.content.slice(firstMatchIndex + oldText.length);

  const result = await htmlProjectStore.writeFiles(project.id, [
    {
      path: file.path,
      kind: file.kind,
      content: updatedContent,
      encoding: file.encoding,
    },
  ]);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已更新檔案 ${file.path} 的指定內容。`;

  return {
    toolName: 'replaceInFile',
    summary,
    result: {
      projectId: project.id,
      path: file.path,
      updated: result.updated,
      previewVersion: result.previewVersion,
      replaced: true,
      matchCount,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

const handleListFiles = async (
  args: { projectId?: string },
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const files = await htmlProjectStore.listFiles(project.id);
  const summary = `目前專案共有 ${files.length} 個檔案。`;

  return {
    toolName: 'listFiles',
    summary,
    result: {
      projectId: project.id,
      files,
      entryFile: project.entryFile,
      previewVersion: project.previewVersion,
    },
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleReadFile = async (
  args: ReadFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const file = await htmlProjectStore.readFile(project.id, args.path);
  if (!file) {
    throw new Error(`Project file ${args.path} not found.`);
  }

  const summary = `已讀取檔案 ${file.path}。`;
  return {
    toolName: 'readFile',
    summary,
    result: {
      projectId: project.id,
      path: file.path,
      kind: file.kind,
      content: file.content,
      dependencies: file.dependencies || [],
      updatedAt: file.updatedAt,
    },
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleDeleteFile = async (
  args: DeleteFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const result = await htmlProjectStore.deleteFile(project.id, args.path);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = result.deleted ? `已刪除檔案 ${args.path}。` : `找不到檔案 ${args.path}。`;

  return {
    toolName: 'deleteFile',
    summary,
    result: {
      projectId: project.id,
      deleted: result.deleted,
      path: args.path,
      previewVersion: result.previewVersion,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

const handleSetEntrypoint = async (
  args: SetEntrypointArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const updatedProject = await htmlProjectStore.setEntrypoint(project.id, args.path);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已將入口檔切換為 ${updatedProject.entryFile}。`;

  return {
    toolName: 'setEntrypoint',
    summary,
    result: {
      projectId: project.id,
      entryFile: updatedProject.entryFile,
      previewVersion: updatedProject.previewVersion,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

const handleRenderPreview = async (
  args: RenderPreviewArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = preview.previewReady
    ? `已重新整理專案預覽（版本 ${preview.previewVersion}）。`
    : `預覽重建失敗：${preview.error}`;

  return {
    toolName: 'renderPreview',
    summary,
    result: {
      projectId: project.id,
      previewVersion: preview.previewVersion,
      entryFile: preview.entryFile,
      previewReady: preview.previewReady,
      previewUrlType: preview.previewUrlType,
      warnings: preview.warnings,
      error: preview.error,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

export const getHtmlProjectToolDefinitions = (): ToolDefinition[] => [
  {
    name: 'createProject',
    description: 'Create a browser-only HTML project that can be previewed next to the chat.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        template: { type: 'string', enum: ['single-page-app', 'blank'] },
      },
      required: ['name'],
    },
  },
  {
    name: 'listProjects',
    description: 'List existing HTML projects owned by the current assistant before reopening one.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'openProject',
    description: 'Open an existing HTML project for incremental edits in this chat session.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'searchFiles',
    description:
      'Search text-based project files for an existing string before making targeted edits.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        query: { type: 'string' },
        caseSensitive: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'writeFiles',
    description:
      'Write or overwrite one or more small complete project files in a single tool call. Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Do not use host filesystem paths or URLs. For existing files, prefer readFile plus replaceInFile over sending a large full-file rewrite.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
              content: { type: 'string' },
              kind: { type: 'string', enum: ['html', 'css', 'js', 'json', 'svg', 'asset', 'md'] },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'replaceInFile',
    description:
      'Replace one exact text span inside an existing text file after you inspect it with readFile. Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. If the text is ambiguous, read the file again and retry with a longer oldText snippet.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
        oldText: { type: 'string' },
        newText: { type: 'string' },
      },
      required: ['path', 'oldText', 'newText'],
    },
  },
  {
    name: 'listFiles',
    description: 'List the current project files before making incremental edits.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'readFile',
    description:
      'Read a single project file and inspect its current content. Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
      },
      required: ['path'],
    },
  },
  {
    name: 'deleteFile',
    description:
      'Delete a single project file from the active HTML project. Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
      },
      required: ['path'],
    },
  },
  {
    name: 'setEntrypoint',
    description:
      'Set which HTML file should be used as the preview entrypoint. Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
      },
      required: ['path'],
    },
  },
  {
    name: 'renderPreview',
    description: 'Rebuild the latest preview artifact for the active HTML project.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: [],
    },
  },
];

export const isHtmlProjectToolName = (toolName: string): boolean => {
  return HTML_PROJECT_TOOL_NAMES.includes(toolName as (typeof HTML_PROJECT_TOOL_NAMES)[number]);
};

export const executeHtmlProjectToolCall = async (
  call: ToolCall,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  try {
    switch (call.name) {
      case 'createProject':
        return await handleCreateProject(call.args as unknown as CreateProjectArgs, context);
      case 'listProjects':
        return await handleListProjects(context);
      case 'openProject':
        return await handleOpenProject(call.args as unknown as OpenProjectArgs, context);
      case 'searchFiles':
        return await handleSearchFiles(call.args as unknown as SearchFilesArgs, context);
      case 'writeFiles':
        return await handleWriteFiles(call.args as unknown as WriteFilesArgs, context);
      case 'replaceInFile':
        return await handleReplaceInFile(call.args as unknown as ReplaceInFileArgs, context);
      case 'listFiles':
        return await handleListFiles(call.args as { projectId?: string }, context);
      case 'readFile':
        return await handleReadFile(call.args as unknown as ReadFileArgs, context);
      case 'deleteFile':
        return await handleDeleteFile(call.args as unknown as DeleteFileArgs, context);
      case 'setEntrypoint':
        return await handleSetEntrypoint(call.args as unknown as SetEntrypointArgs, context);
      case 'renderPreview':
        return await handleRenderPreview(call.args as unknown as RenderPreviewArgs, context);
      default:
        throw new Error(`Unsupported HTML project tool: ${call.name}`);
    }
  } catch (error) {
    const recoverableActiveProjectId = getRecoverableActiveProjectId(
      call.args,
      context.activeProjectId,
    );

    if (error instanceof HtmlProjectToolRecoverableError) {
      return createRecoverableToolExecutionResult(
        call.name,
        error.result,
        recoverableActiveProjectId,
      );
    }
    if (error instanceof HtmlProjectPathValidationError) {
      return createRecoverableToolExecutionResult(
        call.name,
        {
          ok: false,
          recoverable: true,
          code: error.code,
          message: error.message,
          guidance: error.guidance,
          details: {
            path: error.path,
          },
        },
        recoverableActiveProjectId,
      );
    }
    throw error;
  }
};
