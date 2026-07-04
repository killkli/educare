import { describe, expect, it } from 'vitest';

import { buildHtmlProjectSystemPrompt, shouldEnableHtmlProjectTools } from './htmlProjectPrompting';

describe('shouldEnableHtmlProjectTools', () => {
  it('returns true for continuation or reopen requests without an active project', () => {
    expect(
      shouldEnableHtmlProjectTools('Continue the HTML project we were editing yesterday.', null),
    ).toBe(true);
    expect(shouldEnableHtmlProjectTools('Can you reopen the earlier canvas prototype?', null)).toBe(
      true,
    );
  });

  it('returns true when an active project already exists', () => {
    expect(shouldEnableHtmlProjectTools('Help me tweak the copy.', 'project-123')).toBe(true);
  });

  it('returns true for project todo and checklist requests without an active project', () => {
    expect(shouldEnableHtmlProjectTools('Please create a project todo checklist.', null)).toBe(
      true,
    );
    expect(shouldEnableHtmlProjectTools('幫我建立專案工作清單', null)).toBe(true);
  });
});

describe('buildHtmlProjectSystemPrompt', () => {
  it('tells the model to list and open an existing project before editing when none is active', () => {
    const prompt = buildHtmlProjectSystemPrompt(null);

    expect(prompt).toContain('No active HTML project exists yet.');
    expect(prompt).toContain('call listProjects first, then openProject before editing files');
    expect(prompt).toContain(
      'Only createProject when the user wants a brand new webpage or prototype.',
    );
  });

  it('tells the model to reuse the active project and inspect files before writing', () => {
    const prompt = buildHtmlProjectSystemPrompt('project-123');

    expect(prompt).toContain('Current active HTML project id: project-123.');
    expect(prompt).toContain(
      'Reuse it for incremental edits unless the user explicitly asks for a fresh project.',
    );
    expect(prompt).toContain(
      'prefer createProject, listProjects, openProject, searchFiles, listFiles, readFile, writeFiles, replaceInFile, modifyLinesInFile, listProjectTodos, setProjectTodos, updateProjectTodo, deleteProjectTodo, checkProjectTodos, deleteFile, setEntrypoint, and renderPreview',
    );
    expect(prompt).toContain(
      'Always use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Never use host filesystem paths or URLs.',
    );
    expect(prompt).toContain(
      'For targeted edits, inspect existing work first: use searchFiles to locate relevant code, use listFiles to inspect structure, then use readFile before writeFiles, replaceInFile, or modifyLinesInFile.',
    );
    expect(prompt).toContain(
      'Use writeFiles only for small complete-file writes. For edits inside an existing text file, prefer modifyLinesInFile after readFile.numberedContent when line-based edits are clearer, or use replaceInFile with raw content when you have one exact unique snippet.',
    );
    expect(prompt).toContain(
      'For multi-step project work, maintain a project-scoped checklist using listProjectTodos, setProjectTodos, updateProjectTodo, deleteProjectTodo, and checkProjectTodos. Before resuming project execution, inspect the current checklist. Before saying all work is complete, call checkProjectTodos and confirm allComplete is true.',
    );
    expect(prompt).toContain(
      'Each displayed line in readFile.numberedContent starts with "<line> | ". That line-number prefix is only for display and must never be copied into replaceInFile.oldText, replaceInFile.newText, modifyLinesInFile.content, or modifyLinesInFile.expectedOriginal.',
    );
    expect(prompt).toContain(
      'If a tool returns a recoverable validation error, retry once with corrected arguments or a smaller payload.',
    );
    expect(prompt).toContain(
      'After opening an existing project, continue editing that same project unless the user explicitly asks to fork or replace it.',
    );
  });
});
