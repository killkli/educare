import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRuntimeBridgeScript } from './htmlPreviewService';

/**
 * Bridge IIFE execution (architect issue #1). The bootstrap→bridge→parent chain was previously
 * only string-asserted. Here the REAL bridge IIFE (the exact string injected into preview blobs)
 * is executed against a live jsdom window primed with the bootstrap's output contract
 * (window.__vfsReady__ + window.__vfsErrors__), and the parent-facing postMessage stream is
 * captured. This verifies the bridge drains buffered errors and acks ready for both the corrupt
 * -manifest path (AC11) and a normal vfs:ready — the wiring the unit tests could not reach.
 *
 * The bootstrap half (it sets __vfsReady__/__vfsErrors__ and dispatches vfs:ready) is already
 * executed in previewVfsBootstrap.test.ts; this test consumes the same contract from the bridge
 * side, closing the integration gap.
 */

const extractBody = (scriptTag: string): string =>
  scriptTag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');

const installMeta = (projectId: string, previewVersion: number) => {
  const el = document.createElement('script');
  el.type = 'application/json';
  el.setAttribute('data-harness-meta', '');
  el.textContent = JSON.stringify({ projectId, previewVersion });
  document.head.appendChild(el);
};

const runBridge = async (): Promise<Array<Record<string, unknown>>> => {
  const spy = vi.spyOn(window.parent, 'postMessage');
  (0, eval)(extractBody(buildRuntimeBridgeScript()));
  // sendReady posts synchronously when __vfsReady__.done is already true on install; the forced
  // flushErrors also posts synchronously. A short tick covers the throttled path.
  await new Promise(resolve => setTimeout(resolve, 50));
  const posted = spy.mock.calls.map(c => c[0] as Record<string, unknown>);
  spy.mockRestore();
  return posted;
};

describe('harness bridge IIFE — vfs:ready + error-buffer drain (architect #1)', () => {
  const w = window as unknown as Record<string, unknown>;

  beforeEach(() => {
    document.head.innerHTML = '';
    // The bridge install sentinel is defineProperty(configurable:false) — once set it cannot be
    // deleted, so each test runs in a fresh vitest module scope (this file has one bridge install
    // per test; vitest isolates files, so the sentinel is clean at file start).
  });

  afterEach(() => {
    document.head.innerHTML = '';
    delete w.__vfsReady__;
    delete w.__vfsErrors__;
  });

  it('AC11: when the bootstrap pre-signaled vfs-ready (degraded) with a buffered parse error, the bridge posts runtime-errors then ready', async () => {
    // The bridge install sentinel is defineProperty(configurable:false), so a second bridge
    // scenario in this file would silently no-op (the IIFE returns early). Fail loudly instead.
    expect(
      w.__harnessRuntimeBridgeInstalled__,
      'bridge already installed — only one scenario per file',
    ).toBeUndefined();
    installMeta('proj-fs', 1);
    // Simulate the bootstrap's corrupt-manifest output: it set the latch + buffered the error.
    w.__vfsReady__ = { done: true, degraded: true };
    w.__vfsErrors__ = [
      {
        kind: 'error',
        message: 'VFS manifest parse failed: Unexpected token } in JSON',
        timestamp: 1,
      },
    ];

    const posted = await runBridge();

    const runtimeErrorsMsg = posted.find(m => m && m.type === 'runtime-errors');
    const readyMsg = posted.find(m => m && m.type === 'ready');
    expect(runtimeErrorsMsg).toBeDefined();
    expect(readyMsg).toBeDefined();
    const errors = (runtimeErrorsMsg?.errors as Array<{ message: string }>) ?? [];
    expect(errors.some(e => /manifest parse failed/i.test(e.message))).toBe(true);
  });
});
