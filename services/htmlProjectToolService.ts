import {
  HtmlProject,
  HtmlProjectFileKind,
  HtmlProjectToolExecutionResult,
  HtmlProjectWorkspaceUpdate,
} from '../types';
import type { ToolCall, ToolDefinition } from './llmAdapter';
import { htmlPreviewService } from './htmlPreviewService';
import { htmlProjectStore, type WriteHtmlProjectFileInput } from './htmlProjectStore';
import { getTemplateFiles, type HtmlProjectTemplate } from './htmlProjectTemplates';

const HTML_PROJECT_TOOL_NAMES = [
  'createProject',
  'listProjects',
  'openProject',
  'searchFiles',
  'writeFiles',
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
    throw new Error('writeFiles requires a non-empty files array.');
  }

  return fileList.map((file, index) => {
    const path = typeof file.path === 'string' ? file.path.trim() : '';
    if (!path) {
      throw new Error(`writeFiles.files[${index}] is missing a valid path.`);
    }

    if (typeof file.content !== 'string') {
      throw new Error(`writeFiles.files[${index}] is missing string content.`);
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
    description: 'Write or overwrite one or more project files in a single tool call.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
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
    description: 'Read a single project file and inspect its current content.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'deleteFile',
    description: 'Delete a single project file from the active HTML project.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'setEntrypoint',
    description: 'Set which HTML file should be used as the preview entrypoint.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string' },
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
  switch (call.name) {
    case 'createProject':
      return handleCreateProject(call.args as unknown as CreateProjectArgs, context);
    case 'listProjects':
      return handleListProjects(context);
    case 'openProject':
      return handleOpenProject(call.args as unknown as OpenProjectArgs, context);
    case 'searchFiles':
      return handleSearchFiles(call.args as unknown as SearchFilesArgs, context);
    case 'writeFiles':
      return handleWriteFiles(call.args as unknown as WriteFilesArgs, context);
    case 'listFiles':
      return handleListFiles(call.args as { projectId?: string }, context);
    case 'readFile':
      return handleReadFile(call.args as unknown as ReadFileArgs, context);
    case 'deleteFile':
      return handleDeleteFile(call.args as unknown as DeleteFileArgs, context);
    case 'setEntrypoint':
      return handleSetEntrypoint(call.args as unknown as SetEntrypointArgs, context);
    case 'renderPreview':
      return handleRenderPreview(call.args as unknown as RenderPreviewArgs, context);
    default:
      throw new Error(`Unsupported HTML project tool: ${call.name}`);
  }
};
