import React, { useCallback, useEffect, useState } from 'react';
import type { AgentRunState, HtmlProjectSnapshot } from '../../types';
import { htmlProjectStore } from '../../services/htmlProjectStore';
import { htmlPreviewService } from '../../services/htmlPreviewService';
import { useAppContext } from '../core/useAppContext';

interface AgentRunPanelProps {
  projectId: string;
  runState: AgentRunState | null;
}

const STATUS_LABEL: Record<AgentRunState['status'], string> = {
  running: '執行中',
  complete: '完成',
  stopped: '已停止',
  failed: '失敗',
  aborted: '已中斷',
};

const STATUS_COLOR: Record<AgentRunState['status'], string> = {
  running: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40',
  complete: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  stopped: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  failed: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  aborted: 'bg-gray-500/20 text-gray-200 border-gray-500/40',
};

const DIAG_LIGHT_COLOR: Record<AgentRunState['previewDiagnosticState'], string> = {
  not_executed: 'bg-gray-500',
  clean: 'bg-emerald-500',
  has_errors: 'bg-rose-500',
};

const DIAG_LIGHT_LABEL: Record<AgentRunState['previewDiagnosticState'], string> = {
  not_executed: '尚未執行',
  clean: '無錯誤',
  has_errors: '有錯誤',
};

const formatTime = (ms: number): string => {
  const date = new Date(ms);
  return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
};

export function AgentRunPanel({ projectId, runState }: AgentRunPanelProps): React.JSX.Element {
  const { actions } = useAppContext();
  const [snapshots, setSnapshots] = useState<HtmlProjectSnapshot[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [isReverting, setIsReverting] = useState<number | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const refreshSnapshots = useCallback(async () => {
    setIsLoadingSnapshots(true);
    setSnapshotError(null);
    try {
      const result = await htmlProjectStore.listSnapshots(projectId);
      setSnapshots(result.snapshots);
    } catch (error) {
      setSnapshotError((error as Error).message);
    } finally {
      setIsLoadingSnapshots(false);
    }
  }, [projectId]);

  // Load snapshots on mount, on run end, and when runState.snapshotVersion changes.
  useEffect(() => {
    refreshSnapshots().catch(() => {
      // best-effort — handled in callback.
    });
  }, [refreshSnapshots, runState?.status, runState?.snapshotVersion]);

  const handleRevert = async (version: number) => {
    const confirmed = window.confirm(`還原至快照 v${version}?目前未儲存的變更會遺失。`);
    if (!confirmed) {
      return;
    }
    setIsReverting(version);
    setSnapshotError(null);
    try {
      await htmlProjectStore.revertToSnapshot(projectId, version);
      const nextPreview = await htmlPreviewService.resolveProjectForPreview(projectId);
      actions.setProjectPreview(nextPreview);
      actions.appendProjectActivity(`已還原至快照 v${version}。`);
      await refreshSnapshots();
    } catch (error) {
      setSnapshotError((error as Error).message);
      actions.appendProjectActivity(`還原快照失敗:${(error as Error).message}`);
    } finally {
      setIsReverting(null);
    }
  };

  const todo = runState?.todoSummary;
  const todoCompleted = todo?.completed ?? 0;
  const todoTotal = todo?.total ?? 0;
  const todoPct = todoTotal > 0 ? Math.round((todoCompleted / todoTotal) * 100) : 0;
  const toolTrace = runState?.toolTrace ?? [];
  const recentTools = toolTrace.slice(-8);

  return (
    <div
      className='flex flex-col gap-4 rounded-2xl border border-gray-800 bg-gray-900/60 p-3 md:p-4 text-xs md:text-sm'
      data-testid='agent-run-panel'
    >
      {/* Header: status + turn counter */}
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs font-semibold uppercase tracking-wider text-gray-400'>
          Agent Run
        </span>
        {runState ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOR[runState.status]}`}
            data-testid='agent-run-status-badge'
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                runState.status === 'running' ? 'animate-pulse bg-current' : 'bg-current'
              }`}
              aria-hidden='true'
            />
            {STATUS_LABEL[runState.status]}
          </span>
        ) : (
          <span className='text-[10px] text-gray-500'>尚未執行</span>
        )}
        {runState && (
          <span
            className='ml-auto rounded-full border border-gray-700 bg-gray-800/80 px-2 py-0.5 text-[10px] text-gray-300'
            data-testid='agent-run-turn-counter'
          >
            Turn {runState.turnIndex + 1} / {runState.maxTurns}
          </span>
        )}
        {runState?.autoContinued && (
          <span
            className='rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200'
            title='本回合由 controller 自動續跑'
          >
            auto-continued
          </span>
        )}
        {runState?.loopDetected && (
          <span
            className='rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200'
            title='偵測到工具迴圈,已停止'
          >
            loop detected
          </span>
        )}
      </div>

      {/* Progress grid: stacked on mobile (G16), 3-up on md+ */}
      <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
        {/* Tool rounds + recent sequence */}
        <div className='rounded-xl border border-gray-800 bg-gray-950/40 p-3'>
          <div className='mb-1 flex items-center justify-between'>
            <span className='text-[10px] uppercase tracking-wider text-gray-500'>工具軌跡</span>
            <span className='text-[10px] text-gray-400'>{toolTrace.length} 次</span>
          </div>
          {recentTools.length === 0 ? (
            <p className='text-[11px] text-gray-500'>尚無工具呼叫</p>
          ) : (
            <ol className='space-y-1 text-[11px] text-gray-300'>
              {recentTools.map((tool, idx) => (
                <li key={`${tool}-${idx}`} className='truncate'>
                  <span className='text-gray-500'>{idx + 1}.</span> {tool}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Todo progress */}
        <div className='rounded-xl border border-gray-800 bg-gray-950/40 p-3'>
          <div className='mb-1 flex items-center justify-between'>
            <span className='text-[10px] uppercase tracking-wider text-gray-500'>Todo 進度</span>
            <span className='text-[10px] text-gray-400'>
              {todoCompleted} / {todoTotal}
            </span>
          </div>
          {todoTotal === 0 ? (
            <p className='text-[11px] text-gray-500'>尚無 todo 資料</p>
          ) : (
            <div className='space-y-2'>
              <div className='h-1.5 w-full overflow-hidden rounded-full bg-gray-800'>
                <div
                  className='h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all'
                  style={{ width: `${todoPct}%` }}
                />
              </div>
              <p className='text-[11px] text-gray-400'>{todoPct}% 完成</p>
            </div>
          )}
        </div>

        {/* Runtime diagnostic light */}
        <div className='rounded-xl border border-gray-800 bg-gray-950/40 p-3'>
          <span className='mb-1 block text-[10px] uppercase tracking-wider text-gray-500'>
            預覽診斷
          </span>
          <div className='flex items-center gap-2'>
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                runState ? DIAG_LIGHT_COLOR[runState.previewDiagnosticState] : 'bg-gray-700'
              }`}
              aria-hidden='true'
              data-testid='agent-run-diagnostic-light'
            />
            <span className='text-[11px] text-gray-300'>
              {runState ? DIAG_LIGHT_LABEL[runState.previewDiagnosticState] : '尚未執行'}
            </span>
          </div>
          {runState?.finishReason && (
            <p className='mt-2 text-[10px] text-gray-500'>
              finishReason: <code className='text-gray-400'>{runState.finishReason}</code>
            </p>
          )}
        </div>
      </div>

      {/* Snapshots section (G11) */}
      <div className='rounded-xl border border-gray-800 bg-gray-950/40 p-3'>
        <div className='mb-2 flex flex-wrap items-center gap-2'>
          <span className='text-[10px] uppercase tracking-wider text-gray-500'>快照</span>
          <button
            type='button'
            onClick={refreshSnapshots}
            disabled={isLoadingSnapshots}
            className='ml-auto rounded-full border border-gray-700 bg-gray-800/80 px-2 py-0.5 text-[10px] text-gray-300 transition hover:border-gray-600 hover:text-white disabled:opacity-50'
            aria-label='重新載入快照'
          >
            {isLoadingSnapshots ? '載入中…' : '重新載入'}
          </button>
        </div>
        {snapshotError && (
          <p className='mb-2 text-[11px] text-rose-300' role='alert'>
            快照錯誤:{snapshotError}
          </p>
        )}
        {snapshots.length === 0 ? (
          <p className='text-[11px] text-gray-500'>沒有可用的快照。</p>
        ) : (
          <ul className='divide-y divide-gray-800'>
            {snapshots.map(snapshot => {
              const isRevertingThis = isReverting === snapshot.version;
              return (
                <li
                  key={snapshot.version}
                  className='flex flex-wrap items-center gap-2 py-2 text-[11px]'
                  data-testid={`snapshot-row-${snapshot.version}`}
                >
                  <span className='font-mono text-gray-300'>v{snapshot.version}</span>
                  <span className='text-gray-500'>·</span>
                  <span className='text-gray-400'>{formatTime(snapshot.createdAt)}</span>
                  {snapshot.note && (
                    <span className='truncate text-gray-500'>· {snapshot.note}</span>
                  )}
                  <button
                    type='button'
                    onClick={() => handleRevert(snapshot.version)}
                    disabled={isReverting !== null}
                    className='ml-auto rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50'
                    aria-label={`還原至快照 v${snapshot.version}`}
                  >
                    {isRevertingThis ? '還原中…' : '還原'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
