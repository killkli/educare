import {
  HtmlProjectFileKind,
  HtmlProjectToolExecutionResult,
  HtmlProjectWorkspaceUpdate,
} from '../types';
import type { ToolCall, ToolDefinition } from './llmAdapter';
import { htmlPreviewService } from './htmlPreviewService';
import { htmlProjectStore, type WriteHtmlProjectFileInput } from './htmlProjectStore';

const HTML_PROJECT_TOOL_NAMES = [
  'createProject',
  'writeFiles',
  'listFiles',
  'readFile',
  'deleteFile',
  'setEntrypoint',
  'renderPreview',
] as const;

const SINGLE_PAGE_TEMPLATE = {
  html: `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HTML Project Canvas</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="app-shell">
      <section class="hero">
        <span class="eyebrow">Canvas MVP</span>
        <h1>開始建立你的第一個互動原型</h1>
        <p>這個專案已經準備好讓模型增量修改。你可以要求重新設計版面、加入區塊或改寫互動。</p>
        <button id="primary-cta">開始編輯</button>
      </section>
    </main>
    <script src="/main.js"></script>
  </body>
</html>`,
  css: `:root {
  color-scheme: dark;
  font-family: Inter, system-ui, sans-serif;
  background: #020617;
  color: #e2e8f0;
}
body {
  margin: 0;
  min-height: 100vh;
  background: radial-gradient(circle at top, #1e293b, #020617 60%);
}
.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
}
.hero {
  max-width: 720px;
  padding: 40px;
  border-radius: 24px;
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.45);
}
.eyebrow {
  display: inline-flex;
  margin-bottom: 16px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.18);
  color: #67e8f9;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
h1 {
  margin: 0 0 16px;
  font-size: clamp(2rem, 4vw, 3.5rem);
}
p {
  margin: 0 0 24px;
  color: #cbd5e1;
  line-height: 1.7;
}
button {
  padding: 14px 20px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #22d3ee, #3b82f6);
  color: #020617;
  font-weight: 700;
  cursor: pointer;
}
`,
  js: `const button = document.getElementById('primary-cta');
if (button) {
  button.addEventListener('click', () => {
    button.textContent = '已準備好繼續修改';
  });
}
`,
};

interface HtmlProjectToolContext {
  assistantId: string;
  sessionId?: string | null;
  activeProjectId?: string | null;
}

interface CreateProjectArgs {
  name: string;
  description?: string;
  template?: 'single-page-app' | 'blank';
}

interface WriteFilesArgs {
  projectId?: string;
  files: Array<{
    path: string;
    content: string;
    kind: HtmlProjectFileKind;
  }>;
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

const getTemplateFiles = (template?: 'single-page-app' | 'blank'): WriteHtmlProjectFileInput[] => {
  if (template === 'blank') {
    return [
      {
        path: '/index.html',
        kind: 'html',
        content:
          '<!doctype html><html><head><meta charset="UTF-8" /><title>Blank Project</title></head><body></body></html>',
      },
    ];
  }

  return [
    { path: '/index.html', kind: 'html', content: SINGLE_PAGE_TEMPLATE.html },
    { path: '/styles.css', kind: 'css', content: SINGLE_PAGE_TEMPLATE.css },
    { path: '/main.js', kind: 'js', content: SINGLE_PAGE_TEMPLATE.js },
  ];
};

const summarizeFileList = (paths: string[]): string => paths.join(', ');

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

const handleWriteFiles = async (
  args: WriteFilesArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const projectId = requireProjectId(args.projectId, context.activeProjectId);
  const result = await htmlProjectStore.writeFiles(projectId, args.files);
  const preview = await htmlPreviewService.resolveProjectForPreview(projectId);
  const summary = `已更新檔案：${summarizeFileList(result.updated)}。`;

  return {
    toolName: 'writeFiles',
    summary,
    result: {
      projectId,
      updated: result.updated,
      previewVersion: result.previewVersion,
    },
    workspace: createWorkspaceUpdate(projectId, summary, preview),
  };
};

const handleListFiles = async (projectId: string): Promise<HtmlProjectToolExecutionResult> => {
  const project = await htmlProjectStore.getProject(projectId);
  if (!project) {
    throw new Error(`HTML project ${projectId} not found.`);
  }
  const files = await htmlProjectStore.listFiles(projectId);
  const summary = `目前專案共有 ${files.length} 個檔案。`;

  return {
    toolName: 'listFiles',
    summary,
    result: {
      projectId,
      files,
      entryFile: project.entryFile,
      previewVersion: project.previewVersion,
    },
    workspace: createWorkspaceUpdate(projectId, summary),
  };
};

const handleReadFile = async (
  args: ReadFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const projectId = requireProjectId(args.projectId, context.activeProjectId);
  const file = await htmlProjectStore.readFile(projectId, args.path);
  if (!file) {
    throw new Error(`Project file ${args.path} not found.`);
  }

  const summary = `已讀取檔案 ${file.path}。`;
  return {
    toolName: 'readFile',
    summary,
    result: {
      projectId,
      path: file.path,
      kind: file.kind,
      content: file.content,
      dependencies: file.dependencies || [],
      updatedAt: file.updatedAt,
    },
    workspace: createWorkspaceUpdate(projectId, summary),
  };
};

const handleDeleteFile = async (
  args: DeleteFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const projectId = requireProjectId(args.projectId, context.activeProjectId);
  const result = await htmlProjectStore.deleteFile(projectId, args.path);
  const preview = await htmlPreviewService.resolveProjectForPreview(projectId);
  const summary = result.deleted ? `已刪除檔案 ${args.path}。` : `找不到檔案 ${args.path}。`;

  return {
    toolName: 'deleteFile',
    summary,
    result: {
      projectId,
      deleted: result.deleted,
      path: args.path,
      previewVersion: result.previewVersion,
    },
    workspace: createWorkspaceUpdate(projectId, summary, preview),
  };
};

const handleSetEntrypoint = async (
  args: SetEntrypointArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const projectId = requireProjectId(args.projectId, context.activeProjectId);
  const project = await htmlProjectStore.setEntrypoint(projectId, args.path);
  const preview = await htmlPreviewService.resolveProjectForPreview(projectId);
  const summary = `已將入口檔切換為 ${project.entryFile}。`;

  return {
    toolName: 'setEntrypoint',
    summary,
    result: {
      projectId,
      entryFile: project.entryFile,
      previewVersion: project.previewVersion,
    },
    workspace: createWorkspaceUpdate(projectId, summary, preview),
  };
};

const handleRenderPreview = async (
  args: RenderPreviewArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const projectId = requireProjectId(args.projectId, context.activeProjectId);
  const preview = await htmlPreviewService.resolveProjectForPreview(projectId);
  const summary = preview.previewReady
    ? `已重新整理專案預覽（版本 ${preview.previewVersion}）。`
    : `預覽重建失敗：${preview.error}`;

  return {
    toolName: 'renderPreview',
    summary,
    result: {
      projectId,
      previewVersion: preview.previewVersion,
      entryFile: preview.entryFile,
      previewReady: preview.previewReady,
      previewUrlType: preview.previewUrlType,
      warnings: preview.warnings,
      error: preview.error,
    },
    workspace: createWorkspaceUpdate(projectId, summary, preview),
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
            required: ['path', 'content', 'kind'],
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
    case 'writeFiles':
      return handleWriteFiles(call.args as unknown as WriteFilesArgs, context);
    case 'listFiles':
      return handleListFiles(
        requireProjectId((call.args as { projectId?: string }).projectId, context.activeProjectId),
      );
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
