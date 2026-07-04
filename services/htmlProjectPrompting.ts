const HTML_PROJECT_KEYWORDS = [
  'landing page',
  'prototype',
  'widget',
  'dashboard',
  'mini app',
  'single page',
  '網頁',
  '頁面',
  '網站',
  '原型',
  'prototype',
  'landing',
  'hero section',
  'cta',
  'canvas',
  'html',
  'css',
  'javascript',
  'app',
];

const HTML_PROJECT_CONTINUATION_KEYWORDS = [
  'continue',
  'continuing',
  'existing project',
  'previous project',
  'reopen',
  'open project',
  'resume',
  'same project',
  'earlier page',
  'existing canvas',
  '之前的頁面',
  '之前做的',
  '延續',
  '延續剛剛',
  '既有專案',
  '舊專案',
  '繼續修改',
  '重開專案',
  '開啟專案',
  '同一個 project',
  'todo',
  'todos',
  'checklist',
  'work plan',
  '待辦',
  '工作清單',
  '檢查清單',
  '任務清單',
];

export const shouldEnableHtmlProjectTools = (
  message: string,
  activeProjectId?: string | null,
): boolean => {
  if (activeProjectId) {
    return true;
  }

  const normalized = message.toLowerCase();
  return [...HTML_PROJECT_KEYWORDS, ...HTML_PROJECT_CONTINUATION_KEYWORDS].some(keyword =>
    normalized.includes(keyword.toLowerCase()),
  );
};

export const buildHtmlProjectSystemPrompt = (activeProjectId?: string | null): string => {
  const continuationPrompt = activeProjectId
    ? `Current active HTML project id: ${activeProjectId}. Reuse it for incremental edits unless the user explicitly asks for a fresh project.`
    : 'No active HTML project exists yet. If the user wants to continue or reopen earlier canvas work, call listProjects first, then openProject before editing files. Only createProject when the user wants a brand new webpage or prototype.';

  return [
    'You can maintain browser-only HTML projects for the user using dedicated project tools.',
    continuationPrompt,
    'When building or editing UI, prefer createProject, listProjects, openProject, searchFiles, listFiles, readFile, writeFiles, replaceInFile, modifyLinesInFile, listProjectTodos, setProjectTodos, updateProjectTodo, deleteProjectTodo, checkProjectTodos, deleteFile, copyFile, renameFile, setEntrypoint, and renderPreview over dumping large HTML directly into the chat response.',
    'When HTML project tools are enabled and the user asks to create, edit, copy, rename, or delete project contents, you must use the project tools to perform those changes. Do not answer a modification request only by proposing code or describing edits in chat unless the user explicitly asks for planning or explanation without execution.',
    'Always use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Never use host filesystem paths or URLs.',
    'For targeted edits, inspect existing work first: use searchFiles to locate relevant code, use listFiles to inspect structure, then use readFile before writeFiles, replaceInFile, or modifyLinesInFile.',
    'Use writeFiles only for small complete-file writes. For edits inside an existing text file, prefer modifyLinesInFile after readFile.numberedContent when line-based edits are clearer, or use replaceInFile with raw content when you have one exact unique snippet.',
    'For path-level duplication or moves, prefer copyFile and renameFile instead of manually simulating those operations with readFile plus writeFiles plus deleteFile.',
    'For multi-step project work, maintain a project-scoped checklist using listProjectTodos, setProjectTodos, updateProjectTodo, deleteProjectTodo, and checkProjectTodos. Before resuming project execution, inspect the current checklist. Before saying all work is complete, call checkProjectTodos and confirm allComplete is true.',
    'Each displayed line in readFile.numberedContent starts with "<line> | ". That line-number prefix is only for display and must never be copied into replaceInFile.oldText, replaceInFile.newText, modifyLinesInFile.content, or modifyLinesInFile.expectedOriginal.',
    'If a tool returns a recoverable validation error, retry once with corrected arguments or a smaller payload.',
    'After opening an existing project, continue editing that same project unless the user explicitly asks to fork or replace it.',
    'After file changes, call renderPreview so the UI can refresh the sandboxed preview.',
    'Keep final chat responses concise and summarize the project changes rather than pasting the full source code.',
  ].join(' ');
};
