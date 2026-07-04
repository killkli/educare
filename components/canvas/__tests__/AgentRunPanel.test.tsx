/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunPanel } from '../AgentRunPanel';
import { useAppContext } from '../../core/useAppContext';
import { htmlProjectStore } from '../../../services/htmlProjectStore';
import { htmlPreviewService } from '../../../services/htmlPreviewService';
import type { AgentRunState } from '../../../types';

vi.mock('../../core/useAppContext', () => ({
  useAppContext: vi.fn(),
}));

vi.mock('../../../services/htmlProjectStore', () => ({
  htmlProjectStore: {
    listSnapshots: vi.fn(),
    revertToSnapshot: vi.fn(),
  },
}));

vi.mock('../../../services/htmlPreviewService', () => ({
  htmlPreviewService: {
    resolveProjectForPreview: vi.fn(),
  },
}));

const baseState: AgentRunState = {
  runId: 'run-1',
  projectId: 'project-1',
  sessionId: 'session-1',
  assistantId: 'assistant-1',
  status: 'running',
  turnIndex: 2,
  maxTurns: 5,
  previewDiagnosticState: 'not_executed',
  autoContinued: false,
  toolTrace: ['writeFiles', 'renderPreview', 'reportTurnOutcome'],
  startedAt: 1640995200000,
  updatedAt: 1640995200000,
};

describe('AgentRunPanel', () => {
  const mockSetProjectPreview = vi.fn();
  const mockAppendProjectActivity = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useAppContext).mockReturnValue({
      actions: {
        setProjectPreview: mockSetProjectPreview,
        appendProjectActivity: mockAppendProjectActivity,
      },
    } as never);

    vi.mocked(htmlProjectStore.listSnapshots).mockResolvedValue({
      projectId: 'project-1',
      snapshots: [
        {
          projectId: 'project-1',
          version: 3,
          files: ['/index.html'],
          createdAt: 1640995200000,
          note: 'run-start',
        },
        {
          projectId: 'project-1',
          version: 2,
          files: ['/index.html'],
          createdAt: 1640995100000,
        },
      ],
      retainedLimit: 20,
    });

    vi.mocked(htmlProjectStore.revertToSnapshot).mockResolvedValue({
      projectId: 'project-1',
      revertedToVersion: 3,
      previewVersion: 4,
      runtimeDiagnosticsCleared: true,
      filesRestored: 1,
    });

    vi.mocked(htmlPreviewService.resolveProjectForPreview).mockResolvedValue({
      projectId: 'project-1',
      previewVersion: 4,
      url: 'blob:preview-4',
    } as never);

    // Stub window.confirm so the revert path runs without prompting.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders turn counter, tool trace, and the diagnostic light', async () => {
    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    expect(screen.getByTestId('agent-run-turn-counter')).toHaveTextContent('Turn 3 / 5');
    expect(screen.getByText('writeFiles')).toBeInTheDocument();
    expect(screen.getByText('renderPreview')).toBeInTheDocument();
    expect(screen.getByTestId('agent-run-diagnostic-light')).toBeInTheDocument();
  });

  it('colors the diagnostic light green when state is clean', async () => {
    render(
      <AgentRunPanel
        projectId='project-1'
        runState={{ ...baseState, previewDiagnosticState: 'clean' }}
      />,
    );

    const light = screen.getByTestId('agent-run-diagnostic-light');
    expect(light.className).toContain('bg-emerald-500');
  });

  it('colors the diagnostic light red when state has_errors', async () => {
    render(
      <AgentRunPanel
        projectId='project-1'
        runState={{ ...baseState, previewDiagnosticState: 'has_errors' }}
      />,
    );

    const light = screen.getByTestId('agent-run-diagnostic-light');
    expect(light.className).toContain('bg-rose-500');
  });

  it('shows auto-continued badge when autoContinued is true', () => {
    render(
      <AgentRunPanel projectId='project-1' runState={{ ...baseState, autoContinued: true }} />,
    );

    expect(screen.getByText('auto-continued')).toBeInTheDocument();
  });

  it('renders snapshot list and calls revertToSnapshot on Restore click', async () => {
    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    await waitFor(() => {
      expect(htmlProjectStore.listSnapshots).toHaveBeenCalledWith('project-1');
    });

    const rowV3 = await screen.findByTestId('snapshot-row-3');
    expect(rowV3).toHaveTextContent('v3');

    fireEvent.click(screen.getByRole('button', { name: '還原至快照 v3' }));

    await waitFor(() => {
      expect(htmlProjectStore.revertToSnapshot).toHaveBeenCalledWith('project-1', 3);
    });

    await waitFor(() => {
      expect(mockSetProjectPreview).toHaveBeenCalledWith(
        expect.objectContaining({ previewVersion: 4 }),
      );
      expect(mockAppendProjectActivity).toHaveBeenCalledWith('已還原至快照 v3。');
    });
  });

  it('does not call revertToSnapshot when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    const restoreButton = await screen.findByRole('button', { name: '還原至快照 v3' });
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled();
    });

    expect(htmlProjectStore.revertToSnapshot).not.toHaveBeenCalled();
  });
});
