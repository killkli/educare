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

export const shouldEnableHtmlProjectTools = (
  message: string,
  activeProjectId?: string | null,
): boolean => {
  if (activeProjectId) {
    return true;
  }

  const normalized = message.toLowerCase();
  return HTML_PROJECT_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));
};

export const buildHtmlProjectSystemPrompt = (activeProjectId?: string | null): string => {
  const continuationPrompt = activeProjectId
    ? `Current active HTML project id: ${activeProjectId}. Reuse it for incremental edits unless the user explicitly asks for a fresh project.`
    : 'No active HTML project exists yet. Create one before writing files when the user asks for a webpage, prototype, or UI implementation.';

  return [
    'You can maintain browser-only HTML projects for the user using dedicated project tools.',
    continuationPrompt,
    'When building or editing UI, prefer createProject/writeFiles/listFiles/readFile/deleteFile/setEntrypoint/renderPreview over dumping large HTML directly into the chat response.',
    'Use listFiles/readFile to inspect an existing project before making targeted edits.',
    'After file changes, call renderPreview so the UI can refresh the sandboxed preview.',
    'Keep final chat responses concise and summarize the project changes rather than pasting the full source code.',
  ].join(' ');
};
