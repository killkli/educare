import { describe, expect, it } from 'vitest';
import type { HtmlProjectSummary } from '../types';

import {
  buildHtmlProjectSystemPrompt,
  classifyHtmlProjectIntent,
  shouldEnableHtmlProjectTools,
} from './htmlProjectPrompting';

const projectSummary: HtmlProjectSummary = {
  projectId: 'project-123',
  name: 'Canvas MVP',
  entryFile: '/index.html',
  previewVersion: 7,
  previewReady: false,
  files: [
    {
      path: '/index.html',
      kind: 'html',
      size: 256,
      updatedAt: 1700000000000,
      dependencies: ['/scripts/app.js'],
    },
  ],
  fileCount: 1,
  todoSummary: {
    projectId: 'project-123',
    total: 2,
    pending: 1,
    inProgress: 1,
    completed: 0,
    allComplete: false,
  },
  lastBuildError: null,
  warnings: ['保留外部腳本資源：https://cdn.example.com/app.js'],
  previewDiagnostics: {
    category: 'missing_reference',
    outcome: 'repairable_error',
    repairable: true,
    summary: 'Missing preview dependencies: /scripts/app.js.',
    missingPaths: ['/scripts/app.js'],
    warnings: ['保留外部腳本資源：https://cdn.example.com/app.js'],
    details: ['Restore the missing file(s) or update the HTML references before retrying preview.'],
  },
  suggestedNextActionCategory: 'repair_preview',
};

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

describe('classifyHtmlProjectIntent', () => {
  it('routes reopen requests without an active project to the resume pack set', () => {
    expect(classifyHtmlProjectIntent('Can you reopen the earlier canvas prototype?', null)).toEqual(
      expect.objectContaining({
        intent: 'resume_project',
        confidence: 'high',
        selectedPackSet: expect.arrayContaining(['inspect', 'edit', 'todo_finalize']),
        requiresSummaryPreflight: false,
      }),
    );
  });

  it('adds preview recheck routing when continuing an active project and refreshing preview', () => {
    expect(
      classifyHtmlProjectIntent(
        'Continue the same project, fix the header, and refresh preview after that.',
        'project-123',
      ),
    ).toEqual(
      expect.objectContaining({
        intent: 'resume_project',
        confidence: 'medium',
        selectedPackSet: ['inspect', 'edit', 'todo_finalize', 'preview_recheck'],
        requiresSummaryPreflight: true,
      }),
    );
  });

  it('routes completion-plus-preview turns to finalize tooling', () => {
    expect(
      classifyHtmlProjectIntent(
        'Please finish this and recheck preview before we wrap up.',
        'project-123',
      ),
    ).toEqual(
      expect.objectContaining({
        intent: 'finalize_or_complete',
        confidence: 'high',
        selectedPackSet: ['inspect', 'todo_finalize', 'preview_recheck'],
        requiresSummaryPreflight: true,
      }),
    );
  });
});

describe('buildHtmlProjectSystemPrompt', () => {
  it('tells the model to list and open an existing project before editing when resuming without an active project', () => {
    const prompt = buildHtmlProjectSystemPrompt({
      activeProjectId: null,
      intentDecision: classifyHtmlProjectIntent(
        'Can you reopen the earlier canvas prototype?',
        null,
      ),
      projectSummary: null,
    });

    expect(prompt).toContain('No active HTML project exists yet.');
    expect(prompt).toContain('Current routing intent: resume_project (high confidence).');
    expect(prompt).toContain(
      'HTML tool packs exposed for this turn: bootstrap, inspect, edit, todo_finalize.',
    );
    expect(prompt).toContain(
      'Visible HTML project tools: createProject, listProjects, openProject',
    );
    expect(prompt).toContain(
      'When no active project exists and the user wants to continue earlier canvas work, use listProjects first, then openProject. Use createProject only when the user clearly wants a brand new webpage or prototype.',
    );
  });

  it('includes only the route-visible tools for active project resume flows', () => {
    const prompt = buildHtmlProjectSystemPrompt({
      activeProjectId: 'project-123',
      intentDecision: classifyHtmlProjectIntent(
        'Continue the same project, fix the header, and refresh preview after that.',
        'project-123',
      ),
      projectSummary,
    });

    expect(prompt).toContain('Current active HTML project id: project-123.');
    expect(prompt).toContain('Current routing intent: resume_project (medium confidence).');
    expect(prompt).toContain(
      'HTML tool packs exposed for this turn: inspect, edit, todo_finalize, preview_recheck.',
    );
    expect(prompt).toContain(
      'Visible HTML project tools: getProjectSummary, listFiles, searchFiles, readFile, listProjectTodos, writeFiles, replaceInFile, modifyLinesInFile, copyFile, renameFile, deleteFile, setEntrypoint, setProjectTodos, updateProjectTodo, deleteProjectTodo, checkProjectTodos, renderPreview.',
    );
    expect(prompt).toContain(
      'The system already injected a current project summary for this turn:',
    );
    expect(prompt).toContain('Do not start with redundant listFiles or listProjectTodos');
    expect(prompt).toContain(
      'For targeted edits, inspect existing work first: use getProjectSummary when available, use searchFiles to locate relevant code, use listFiles to inspect structure, then use readFile before writeFiles, replaceInFile, or modifyLinesInFile.',
    );
    expect(prompt).toContain(
      'Successful mutating tools already refresh preview/workspace state automatically. Use renderPreview only when the user explicitly asks to rebuild, reopen, refresh, or recheck preview state, or when preview diagnostics indicate that a repair flow needs revalidation.',
    );
    expect(prompt).not.toContain('Visible HTML project tools: createProject');
  });

  it('keeps finalize guidance scoped to finalize packs until edit routing is promoted elsewhere', () => {
    const prompt = buildHtmlProjectSystemPrompt({
      activeProjectId: 'project-123',
      intentDecision: classifyHtmlProjectIntent(
        'Please finish this and recheck preview before we wrap up.',
        'project-123',
      ),
      projectSummary,
    });

    expect(prompt).toContain('Current routing intent: finalize_or_complete (high confidence).');
    expect(prompt).toContain(
      'HTML tool packs exposed for this turn: inspect, todo_finalize, preview_recheck.',
    );
    expect(prompt).toContain(
      'Visible HTML project tools: getProjectSummary, listFiles, searchFiles, readFile, listProjectTodos, checkProjectTodos, renderPreview.',
    );
    expect(prompt).not.toContain(
      'Visible HTML project tools: getProjectSummary, listFiles, searchFiles, readFile, listProjectTodos, writeFiles',
    );
    expect(prompt).not.toContain(
      'use getProjectSummary when available, use searchFiles to locate relevant code, use listFiles to inspect structure, then use readFile before writeFiles, replaceInFile, or modifyLinesInFile.',
    );
  });
});
