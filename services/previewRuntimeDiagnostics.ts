import {
  HtmlProjectPreviewArtifact,
  HtmlProjectRuntimeDiagnosticResult,
  HtmlProjectRuntimeDiagnosticStatus,
  HtmlProjectRuntimeErrorEntry,
} from '../types';

/**
 * G1 / G8 — Runtime diagnostics store for HTML project previews.
 *
 * Tracks per-(projectId, previewVersion):
 *   - readyAckReceived: the preview iframe signalled it loaded successfully
 *   - errors: runtime errors/unhandledrejections/console.error/.warn captured by the bridge
 *   - notExecuted: explicitly marked as not-executed (e.g. after a revert clears diagnostics)
 *
 * `waitForRuntimeDiagnostics` implements the G1 3-state timing contract:
 *   - If a ready ack for this (projectId, previewVersion) has already arrived → return
 *     immediately (clean if no errors, has_errors otherwise).
 *   - If no ack yet → poll every 50ms up to waitMs (clamped to [0, 5000]); resolve early
 *     if an ack arrives mid-wait.
 *   - If still no ack after waitMs → return { status: 'not_executed', ... }.
 */

const MAX_ENTRIES = 50;
const MAX_MESSAGE_CHARS = 500;
const POLL_INTERVAL_MS = 50;
const MAX_WAIT_MS = 5000;
const FLUSH_THROTTLE_MS = 250;

interface DiagnosticState {
  readyAckReceived: boolean;
  errors: HtmlProjectRuntimeErrorEntry[];
  notExecuted: boolean;
}

const now = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const keyFor = (projectId: string, previewVersion: number): string =>
  `${projectId}::${previewVersion}`;

/** Truncate a runtime error message to a safe maximum length (bridge-side mirror). */
export function truncateMessage(message: string, max = MAX_MESSAGE_CHARS): string {
  if (message.length <= max) {
    return message;
  }
  return `${message.slice(0, max)}…`;
}

/**
 * Deduplicate entries by (kind, message) keeping first-seen order, then cap at `max`.
 * Used by the diagnostics store when recording errors and mirrored inside the bridge.
 */
export function dedupeAndCapEntries(
  entries: HtmlProjectRuntimeErrorEntry[],
  max = MAX_ENTRIES,
): HtmlProjectRuntimeErrorEntry[] {
  const seen = new Set<string>();
  const result: HtmlProjectRuntimeErrorEntry[] = [];
  for (const entry of entries) {
    const signature = `${entry.kind}::${entry.message}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    result.push(entry);
    if (result.length >= max) {
      break;
    }
  }
  return result;
}

export type HarnessMessage =
  | { type: 'ready'; projectId: string; previewVersion: number }
  | {
      type: 'runtime-errors';
      projectId: string;
      previewVersion: number;
      errors: HtmlProjectRuntimeErrorEntry[];
    };

/**
 * Validate the 4-tuple G1 contract before trusting a postMessage event:
 *   1. data is a non-null object
 *   2. data.type is 'ready' | 'runtime-errors'
 *   3. data.projectId and data.previewVersion match the expected (projectId, previewVersion)
 *   4. (when expectedSource provided) event.source === expectedSource
 *
 * Returns a type guard so callers can narrow the data shape after validation.
 */
export function isHarnessMessage(
  data: unknown,
  expected: { projectId: string; previewVersion: number },
  options?: { expectedSource?: Window | null },
): data is HarnessMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const record = data as Record<string, unknown>;
  if (record.type !== 'ready' && record.type !== 'runtime-errors') {
    return false;
  }
  if (record.projectId !== expected.projectId) {
    return false;
  }
  if (record.previewVersion !== expected.previewVersion) {
    return false;
  }
  if (options && Object.prototype.hasOwnProperty.call(options, 'expectedSource')) {
    if (options.expectedSource === null || options.expectedSource === undefined) {
      return false;
    }
  }
  return true;
}

class PreviewRuntimeDiagnosticsStore {
  private states = new Map<string, DiagnosticState>();

  private getOrCreate(projectId: string, previewVersion: number): DiagnosticState {
    const key = keyFor(projectId, previewVersion);
    let state = this.states.get(key);
    if (!state) {
      state = { readyAckReceived: false, errors: [], notExecuted: false };
      this.states.set(key, state);
    }
    return state;
  }

  recordReadyAck(projectId: string, previewVersion: number): void {
    const state = this.getOrCreate(projectId, previewVersion);
    state.readyAckReceived = true;
    state.notExecuted = false;
  }

  recordRuntimeErrors(
    projectId: string,
    previewVersion: number,
    errors: HtmlProjectRuntimeErrorEntry[],
  ): void {
    if (!Array.isArray(errors) || errors.length === 0) {
      return;
    }
    const state = this.getOrCreate(projectId, previewVersion);
    const normalized = dedupeAndCapEntries([...state.errors, ...errors]);
    state.errors = normalized;
    state.notExecuted = false;
  }

  markNotExecuted(projectId: string, previewVersion: number): void {
    const state = this.getOrCreate(projectId, previewVersion);
    state.notExecuted = true;
    state.readyAckReceived = false;
  }

  async waitForRuntimeDiagnostics(
    projectId: string,
    previewVersion: number,
    waitMs: number,
  ): Promise<HtmlProjectRuntimeDiagnosticResult> {
    const clampedWaitMs = Math.max(0, Math.min(MAX_WAIT_MS, Math.floor(waitMs)));
    const key = keyFor(projectId, previewVersion);
    const startedAt = now();
    const deadline = startedAt + clampedWaitMs;

    // Fast path: state already present with ack.
    const initial = this.states.get(key);
    if (initial && initial.readyAckReceived) {
      return this.buildResult(projectId, previewVersion, initial, false, clampedWaitMs);
    }

    while (now() < deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      const current = this.states.get(key);
      if (current && current.readyAckReceived) {
        return this.buildResult(projectId, previewVersion, current, true, clampedWaitMs);
      }
    }

    const final = this.states.get(key);
    if (final && final.readyAckReceived) {
      return this.buildResult(projectId, previewVersion, final, true, clampedWaitMs);
    }
    // No ack received within the wait window (or no state at all) → not_executed.
    return {
      projectId,
      previewVersion,
      status: 'not_executed',
      errors: [],
      readyAckReceived: false,
      waitedForReadyAck: clampedWaitMs > 0,
      waitMs: clampedWaitMs,
    };
  }

  clear(projectId: string, previewVersion?: number): void {
    if (previewVersion === undefined) {
      for (const key of Array.from(this.states.keys())) {
        if (key.startsWith(`${projectId}::`)) {
          this.states.delete(key);
        }
      }
      return;
    }
    this.states.delete(keyFor(projectId, previewVersion));
  }

  private buildResult(
    projectId: string,
    previewVersion: number,
    state: DiagnosticState,
    waitedForReadyAck: boolean,
    waitMs: number,
  ): HtmlProjectRuntimeDiagnosticResult {
    let status: HtmlProjectRuntimeDiagnosticStatus;
    if (state.notExecuted) {
      status = 'not_executed';
    } else if (state.errors.length > 0) {
      status = 'has_errors';
    } else {
      status = 'clean';
    }
    return {
      projectId,
      previewVersion,
      status,
      errors: state.errors,
      readyAckReceived: state.readyAckReceived,
      waitedForReadyAck,
      waitMs,
    };
  }
}

export const previewRuntimeDiagnostics = new PreviewRuntimeDiagnosticsStore();

export const PREVIEW_RUNTIME_FLUSH_THROTTLE_MS = FLUSH_THROTTLE_MS;
export const PREVIEW_RUNTIME_MAX_ENTRIES = MAX_ENTRIES;
export const PREVIEW_RUNTIME_MAX_MESSAGE_CHARS = MAX_MESSAGE_CHARS;

/**
 * G8 — Mount a detached, hidden iframe to load an artifact's URL and route its ready
 * and runtime-errors messages into the diagnostics store via the same postMessage path.
 *
 * The frame is created with display:none and aria-hidden so it never affects layout.
 * It does NOT add allow-same-origin — the sandbox stays identical to the visible preview.
 *
 * Returns `{ frame: null, cleanup: noop }` when creation is impossible (no document,
 * no URL, etc.). Callers MUST invoke `cleanup()` when done to release the listener.
 */
export function mountHiddenVerificationFrame(artifact: HtmlProjectPreviewArtifact): {
  frame: HTMLIFrameElement | null;
  cleanup: () => void;
} {
  const noop = () => {};

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { frame: null, cleanup: noop };
  }
  if (!artifact.url) {
    return { frame: null, cleanup: noop };
  }

  let frame: HTMLIFrameElement | null = null;
  try {
    frame = document.createElement('iframe');
  } catch {
    return { frame: null, cleanup: noop };
  }
  if (!frame) {
    return { frame: null, cleanup: noop };
  }

  frame.setAttribute('aria-hidden', 'true');
  frame.style.display = 'none';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.title = 'harness-verification-frame';
  // Use setAttribute('sandbox', ...) — jsdom does not implement HTMLIFrameElement.sandbox
  // as a DOMTokenList, and setAttribute works in every environment. Crucially we do NOT
  // add allow-same-origin: the verification frame stays sandboxed identically to the
  // visible preview.
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
  frame.src = artifact.url;

  const expected = { projectId: artifact.projectId, previewVersion: artifact.previewVersion };

  const handler = (event: MessageEvent) => {
    if (event.source !== frame?.contentWindow) {
      return;
    }
    if (!isHarnessMessage(event.data, expected, { expectedSource: frame?.contentWindow ?? null })) {
      return;
    }
    const data = event.data as HarnessMessage;
    if (data.type === 'ready') {
      previewRuntimeDiagnostics.recordReadyAck(expected.projectId, expected.previewVersion);
    } else {
      previewRuntimeDiagnostics.recordRuntimeErrors(
        expected.projectId,
        expected.previewVersion,
        data.errors,
      );
    }
  };

  window.addEventListener('message', handler);

  try {
    document.body.appendChild(frame);
  } catch {
    window.removeEventListener('message', handler);
    return { frame: null, cleanup: noop };
  }

  const cleanup = () => {
    window.removeEventListener('message', handler);
    try {
      if (frame && frame.parentNode) {
        frame.parentNode.removeChild(frame);
      }
    } catch {
      // ignore — frame may already be detached
    }
  };

  return { frame, cleanup };
}
