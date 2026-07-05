import { afterEach, describe, expect, it } from 'vitest';
import { isHarnessMessage, previewRuntimeDiagnostics } from './previewRuntimeDiagnostics';
import type { HtmlProjectRuntimeErrorEntry } from '../types';

describe('VFS runtime diagnostics (AC5 / AC7b wiring)', () => {
  afterEach(() => {
    previewRuntimeDiagnostics.clear('proj-mr');
  });

  it('stores a missing_reference runtime entry and surfaces it as has_errors (AC7b)', async () => {
    const entry: HtmlProjectRuntimeErrorEntry = {
      kind: 'missing_reference',
      message: 'fetch() referenced a missing project file: /data.json',
      timestamp: 1000,
    };
    previewRuntimeDiagnostics.recordReadyAck('proj-mr', 1);
    previewRuntimeDiagnostics.recordRuntimeErrors('proj-mr', 1, [entry]);

    const result = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-mr', 1, 0);
    expect(result.status).toBe('has_errors');
    expect(result.errors.some(e => e.kind === 'missing_reference')).toBe(true);
  });

  it('isHarnessMessage accepts a runtime-errors payload carrying missing_reference entries', () => {
    const payload = {
      type: 'runtime-errors' as const,
      projectId: 'proj-mr',
      previewVersion: 1,
      errors: [{ kind: 'missing_reference', message: 'missing /x.json', timestamp: 1 }],
    };
    expect(isHarnessMessage(payload, { projectId: 'proj-mr', previewVersion: 1 })).toBe(true);
  });

  it('AC5: query before any ready ack returns not_executed', async () => {
    // No recordReadyAck call — the store has no ack for this version.
    const result = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-mr', 99, 0);
    expect(result.status).toBe('not_executed');
    expect(result.readyAckReceived).toBe(false);
  });

  it('AC5: after a clean ready ack (no errors), status is clean', async () => {
    previewRuntimeDiagnostics.recordReadyAck('proj-mr', 7);
    const result = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-mr', 7, 0);
    expect(result.status).toBe('clean');
    expect(result.readyAckReceived).toBe(true);
  });
});
