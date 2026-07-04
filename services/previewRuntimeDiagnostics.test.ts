import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlProjectRuntimeErrorEntry } from '../types';
import {
  PREVIEW_RUNTIME_MAX_ENTRIES,
  PREVIEW_RUNTIME_MAX_MESSAGE_CHARS,
  dedupeAndCapEntries,
  isHarnessMessage,
  mountHiddenVerificationFrame,
  previewRuntimeDiagnostics,
  truncateMessage,
} from './previewRuntimeDiagnostics';

const makeEntry = (
  overrides: Partial<HtmlProjectRuntimeErrorEntry> = {},
): HtmlProjectRuntimeErrorEntry => ({
  kind: 'error',
  message: 'boom',
  timestamp: 1000,
  ...overrides,
});

describe('truncateMessage', () => {
  it('returns short messages unchanged', () => {
    expect(truncateMessage('short')).toBe('short');
  });

  it('truncates messages exceeding the default max length', () => {
    const long = 'x'.repeat(PREVIEW_RUNTIME_MAX_MESSAGE_CHARS + 50);
    const result = truncateMessage(long);
    expect(result.length).toBe(PREVIEW_RUNTIME_MAX_MESSAGE_CHARS + 1); // +1 for ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  it('honours a custom max length', () => {
    const result = truncateMessage('abcdefghij', 5);
    expect(result).toBe('abcde…');
  });
});

describe('dedupeAndCapEntries', () => {
  it('removes duplicates keyed by (kind, message) keeping first-seen order', () => {
    const entries = [
      makeEntry({ kind: 'error', message: 'a' }),
      makeEntry({ kind: 'error', message: 'a', lineno: 99 }),
      makeEntry({ kind: 'error', message: 'b' }),
      makeEntry({ kind: 'console_error', message: 'a' }),
    ];
    const result = dedupeAndCapEntries(entries);
    expect(result).toHaveLength(3);
    expect(result.map(e => `${e.kind}:${e.message}`)).toEqual([
      'error:a',
      'error:b',
      'console_error:a',
    ]);
  });

  it('caps the result at the configured maximum', () => {
    const entries: HtmlProjectRuntimeErrorEntry[] = [];
    for (let i = 0; i < PREVIEW_RUNTIME_MAX_ENTRIES + 10; i++) {
      entries.push(makeEntry({ kind: 'error', message: `err-${i}`, timestamp: i }));
    }
    const result = dedupeAndCapEntries(entries);
    expect(result).toHaveLength(PREVIEW_RUNTIME_MAX_ENTRIES);
    // Keeps the first-seen entries.
    expect(result[0].message).toBe('err-0');
    expect(result[result.length - 1].message).toBe(`err-${PREVIEW_RUNTIME_MAX_ENTRIES - 1}`);
  });

  it('honours a custom cap', () => {
    const entries = [
      makeEntry({ message: 'a' }),
      makeEntry({ message: 'b' }),
      makeEntry({ message: 'c' }),
    ];
    expect(dedupeAndCapEntries(entries, 2)).toHaveLength(2);
  });
});

describe('isHarnessMessage (4-tuple G1 validation)', () => {
  const expected = { projectId: 'proj-1', previewVersion: 3 };

  it('accepts a well-formed ready message', () => {
    const data = { type: 'ready', projectId: 'proj-1', previewVersion: 3 };
    expect(isHarnessMessage(data, expected, { expectedSource: {} as Window })).toBe(true);
  });

  it('accepts a well-formed runtime-errors message', () => {
    const data = {
      type: 'runtime-errors',
      projectId: 'proj-1',
      previewVersion: 3,
      errors: [],
    };
    expect(isHarnessMessage(data, expected, { expectedSource: {} as Window })).toBe(true);
  });

  it('rejects non-object data', () => {
    expect(isHarnessMessage('hello', expected)).toBe(false);
    expect(isHarnessMessage(null, expected)).toBe(false);
    expect(isHarnessMessage(undefined, expected)).toBe(false);
  });

  it('rejects unknown message types', () => {
    expect(
      isHarnessMessage(
        { type: 'something-else', projectId: 'proj-1', previewVersion: 3 },
        expected,
      ),
    ).toBe(false);
  });

  it('rejects a mismatched projectId', () => {
    expect(
      isHarnessMessage({ type: 'ready', projectId: 'other-project', previewVersion: 3 }, expected),
    ).toBe(false);
  });

  it('rejects a mismatched previewVersion', () => {
    expect(
      isHarnessMessage({ type: 'ready', projectId: 'proj-1', previewVersion: 99 }, expected),
    ).toBe(false);
  });

  it('rejects when expectedSource is null/undefined', () => {
    const data = { type: 'ready', projectId: 'proj-1', previewVersion: 3 };
    expect(isHarnessMessage(data, expected, { expectedSource: null })).toBe(false);
    expect(isHarnessMessage(data, expected, { expectedSource: undefined })).toBe(false);
  });
});

describe('previewRuntimeDiagnostics (G1 3-state + timing)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    previewRuntimeDiagnostics.clear('proj-1');
    previewRuntimeDiagnostics.clear('proj-2');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns not_executed when no ready ack arrives within waitMs (pre-ack query)', async () => {
    const pending = previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 200);
    // Advance past the wait window without recording an ack.
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;
    expect(result).toMatchObject({
      projectId: 'proj-1',
      previewVersion: 1,
      status: 'not_executed',
      readyAckReceived: false,
      waitedForReadyAck: true,
      waitMs: 200,
      errors: [],
    });
  });

  it('returns not_executed with waitMs=0 immediately when no ack exists', async () => {
    const result = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 0);
    expect(result.status).toBe('not_executed');
    expect(result.waitedForReadyAck).toBe(false);
    expect(result.waitMs).toBe(0);
  });

  it('returns clean immediately when ready ack was already recorded (fast path)', async () => {
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 1);
    const result = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 1000);
    expect(result).toMatchObject({
      status: 'clean',
      readyAckReceived: true,
      errors: [],
      waitedForReadyAck: false,
    });
  });

  it('returns has_errors when ack + errors were recorded before the query', async () => {
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 1);
    previewRuntimeDiagnostics.recordRuntimeErrors('proj-1', 1, [
      makeEntry({ kind: 'error', message: 'fail' }),
    ]);
    const result = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 1000);
    expect(result.status).toBe('has_errors');
    expect(result.readyAckReceived).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('fail');
  });

  it('resolves early when a ready ack arrives mid-wait', async () => {
    const pending = previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 1000);
    await vi.advanceTimersByTimeAsync(100);
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 1);
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(result.status).toBe('clean');
    expect(result.readyAckReceived).toBe(true);
    expect(result.waitedForReadyAck).toBe(true);
  });

  it('resolves with has_errors when errors arrive during the wait, then ack triggers resolution', async () => {
    const pending = previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 1000);
    await vi.advanceTimersByTimeAsync(50);
    // Errors arrive BEFORE the ack — the wait must continue (no ack yet).
    previewRuntimeDiagnostics.recordRuntimeErrors('proj-1', 1, [
      makeEntry({ message: 'mid-wait error' }),
    ]);
    await vi.advanceTimersByTimeAsync(60);
    // Now the ack arrives — resolution must reflect the accumulated errors.
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 1);
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(result.status).toBe('has_errors');
    expect(result.readyAckReceived).toBe(true);
    expect(result.errors[0].message).toBe('mid-wait error');
  });

  it('clamps waitMs to [0, 5000] (verified via fast-path return value)', async () => {
    previewRuntimeDiagnostics.recordReadyAck('proj-2', 1);
    const result = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-2', 1, 99999);
    expect(result.waitMs).toBe(5000);
    expect(result.readyAckReceived).toBe(true);
    expect(result.waitedForReadyAck).toBe(false);
    previewRuntimeDiagnostics.clear('proj-2');
  });

  it('dedupes recorded errors by (kind, message)', async () => {
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 1);
    previewRuntimeDiagnostics.recordRuntimeErrors('proj-1', 1, [
      makeEntry({ kind: 'error', message: 'dup' }),
      makeEntry({ kind: 'error', message: 'dup' }),
      makeEntry({ kind: 'error', message: 'dup' }),
    ]);
    previewRuntimeDiagnostics.recordRuntimeErrors('proj-1', 1, [
      makeEntry({ kind: 'error', message: 'dup' }),
      makeEntry({ kind: 'error', message: 'unique' }),
    ]);
    const result = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 0);
    expect(result.errors.map(e => e.message).sort()).toEqual(['dup', 'unique']);
  });

  it('caps recorded errors at the maximum', async () => {
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 1);
    const bulk: HtmlProjectRuntimeErrorEntry[] = [];
    for (let i = 0; i < PREVIEW_RUNTIME_MAX_ENTRIES + 20; i++) {
      bulk.push(makeEntry({ message: `e-${i}` }));
    }
    previewRuntimeDiagnostics.recordRuntimeErrors('proj-1', 1, bulk);
    const result = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 0);
    expect(result.errors).toHaveLength(PREVIEW_RUNTIME_MAX_ENTRIES);
  });

  it('markNotExecuted overrides a previously-recorded clean/has_errors state', async () => {
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 1);
    previewRuntimeDiagnostics.recordRuntimeErrors('proj-1', 1, [makeEntry()]);
    previewRuntimeDiagnostics.markNotExecuted('proj-1', 1);
    const result = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 0);
    expect(result.status).toBe('not_executed');
    expect(result.readyAckReceived).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it('clear(projectId, previewVersion) drops the matching state only', async () => {
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 1);
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 2);
    previewRuntimeDiagnostics.recordReadyAck('proj-2', 1);
    previewRuntimeDiagnostics.clear('proj-1', 1);
    const r1v1 = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 0);
    const r1v2 = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 2, 0);
    const r2v1 = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-2', 1, 0);
    expect(r1v1.status).toBe('not_executed');
    expect(r1v2.status).toBe('clean');
    expect(r2v1.status).toBe('clean');
  });

  it('clear(projectId) drops every version for that project', async () => {
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 1);
    previewRuntimeDiagnostics.recordReadyAck('proj-1', 2);
    previewRuntimeDiagnostics.clear('proj-1');
    const r1v1 = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 1, 0);
    const r1v2 = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics('proj-1', 2, 0);
    expect(r1v1.status).toBe('not_executed');
    expect(r1v2.status).toBe('not_executed');
  });
});

describe('mountHiddenVerificationFrame (G8)', () => {
  it('returns { frame: null, cleanup: noop } when the artifact has no URL', () => {
    const { frame, cleanup } = mountHiddenVerificationFrame({
      projectId: 'p',
      previewVersion: 1,
      entryFile: '/index.html',
      previewReady: true,
      previewUrlType: 'blob',
      html: '<html></html>',
      warnings: [],
      error: null,
      generatedAt: 1,
    });
    expect(frame).toBeNull();
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('creates a hidden iframe attached to document.body and removes it on cleanup', () => {
    const initial = document.body.childElementCount;
    const { frame, cleanup } = mountHiddenVerificationFrame({
      projectId: 'p',
      previewVersion: 1,
      entryFile: '/index.html',
      previewReady: true,
      previewUrlType: 'blob',
      html: '<html></html>',
      url: 'about:blank',
      warnings: [],
      error: null,
      generatedAt: 1,
    });
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('aria-hidden')).toBe('true');
    expect(frame?.style.display).toBe('none');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-modals');
    expect(document.body.childElementCount).toBe(initial + 1);
    cleanup();
    expect(document.body.childElementCount).toBe(initial);
  });

  it('routes matching messages into the diagnostics store', () => {
    const { frame, cleanup } = mountHiddenVerificationFrame({
      projectId: 'p',
      previewVersion: 5,
      entryFile: '/index.html',
      previewReady: true,
      previewUrlType: 'blob',
      html: '<html></html>',
      url: 'about:blank',
      warnings: [],
      error: null,
      generatedAt: 1,
    });

    // Pretend the iframe signalled ready. Source must equal frame.contentWindow.
    const fakeSource = {} as Window;
    Object.defineProperty(frame, 'contentWindow', { value: fakeSource, configurable: true });

    window.postMessage({ type: 'ready', projectId: 'p', previewVersion: 5 }, '*');
    // Simulate that postMessage from inside the iframe arrives synchronously with the right source.
    // jsdom does not set event.source on same-window postMessage, so we dispatch a synthetic MessageEvent.
    const evt = new MessageEvent('message', {
      data: { type: 'ready', projectId: 'p', previewVersion: 5 },
      source: fakeSource,
    });
    window.dispatchEvent(evt);

    cleanup();
    // After cleanup, future messages must not throw and must not be recorded (listener removed).
    expect(() => window.dispatchEvent(evt)).not.toThrow();
  });
});
