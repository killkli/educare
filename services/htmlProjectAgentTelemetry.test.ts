import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlProjectAgentTelemetryEvent } from '../types';

type MockDb = {
  add: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
  getAllKeys: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};

// vi.hoisted so the mock factory (also hoisted) can reference mockOpenDB.
const { mockOpenDB } = vi.hoisted(() => ({
  mockOpenDB: vi.fn(),
}));

vi.mock('idb', () => ({
  openDB: mockOpenDB,
}));

/**
 * Minimal in-memory idb mock. autoIncrement semantics simulated via nextKey.
 * getAll/getAllKeys return results in ascending key order (matches IDB spec).
 */
const createMockDb = (): MockDb => {
  const events = new Map<number, HtmlProjectAgentTelemetryEvent>();
  let nextKey = 1;

  return {
    add: vi.fn(async (_store: string, value: HtmlProjectAgentTelemetryEvent) => {
      const key = nextKey++;
      events.set(key, value);
      return key;
    }),
    put: vi.fn(async (_store: string, value: HtmlProjectAgentTelemetryEvent) => {
      const key = nextKey++;
      events.set(key, value);
      return key;
    }),
    get: vi.fn(async (_store: string, key: number) => events.get(key)),
    getAll: vi.fn(async (_store: string) =>
      Array.from(events.entries())
        .sort(([a], [b]) => a - b)
        .map(([, v]) => v),
    ),
    getAllKeys: vi.fn(async (_store: string) => Array.from(events.keys()).sort((a, b) => a - b)),
    delete: vi.fn(async (_store: string, key: number) => {
      events.delete(key);
    }),
    clear: vi.fn(async (_store: string) => {
      events.clear();
    }),
  };
};

const flushPromises = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

const baseEvent = (
  overrides: Partial<HtmlProjectAgentTelemetryEvent> = {},
): HtmlProjectAgentTelemetryEvent => ({
  provider: 'gemini',
  intent: 'create',
  selectedPackSet: [],
  toolSequence: [],
  repeatedRecoverableErrors: [],
  toolRounds: 1,
  ...overrides,
});

describe('htmlProjectAgentTelemetry', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockOpenDB.mockResolvedValue(mockDb);
  });

  it('recordHtmlProjectTelemetryEvent pushes to the in-memory ring buffer', async () => {
    const { recordHtmlProjectTelemetryEvent, getHtmlProjectTelemetryEvents } = await import(
      './htmlProjectAgentTelemetry'
    );

    recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'first' }));
    recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'second' }));

    const events = getHtmlProjectTelemetryEvents();
    expect(events).toHaveLength(2);
    expect(events[0].intent).toBe('first');
    expect(events[1].intent).toBe('second');
  });

  it('evicts oldest beyond MAX_TELEMETRY_EVENTS (200) in memory ring', async () => {
    const { recordHtmlProjectTelemetryEvent, getHtmlProjectTelemetryEvents } = await import(
      './htmlProjectAgentTelemetry'
    );

    for (let i = 0; i < 205; i += 1) {
      recordHtmlProjectTelemetryEvent(baseEvent({ intent: `intent-${i}`, toolRounds: i }));
    }

    const events = getHtmlProjectTelemetryEvents();
    expect(events).toHaveLength(200);
    // Newest 200 kept: intent-5 (oldest surviving) through intent-204 (newest)
    expect(events[0].intent).toBe('intent-5');
    expect(events[0].toolRounds).toBe(5);
    expect(events[199].intent).toBe('intent-204');
    expect(events[199].toolRounds).toBe(204);
  });

  it('getHtmlProjectTelemetryEvents returns mutation-safe clones', async () => {
    const { recordHtmlProjectTelemetryEvent, getHtmlProjectTelemetryEvents } = await import(
      './htmlProjectAgentTelemetry'
    );

    recordHtmlProjectTelemetryEvent(
      baseEvent({
        intent: 'original',
        selectedPackSet: ['pack-a'],
        toolSequence: ['tool-1'],
        repeatedRecoverableErrors: [{ toolName: 'tool-1', code: 'rate_limit', count: 1 }],
      }),
    );

    const first = getHtmlProjectTelemetryEvents();
    expect(first).toHaveLength(1);
    first[0].intent = 'mutated';
    first[0].selectedPackSet.push('pack-b');
    first[0].toolSequence.push('tool-2');
    first[0].repeatedRecoverableErrors[0].count = 99;

    const second = getHtmlProjectTelemetryEvents();
    expect(second).toHaveLength(1);
    expect(second[0].intent).toBe('original');
    expect(second[0].selectedPackSet).toEqual(['pack-a']);
    expect(second[0].toolSequence).toEqual(['tool-1']);
    expect(second[0].repeatedRecoverableErrors[0].count).toBe(1);
  });

  it('clearHtmlProjectTelemetryEvents empties the in-memory cache', async () => {
    const {
      recordHtmlProjectTelemetryEvent,
      clearHtmlProjectTelemetryEvents,
      getHtmlProjectTelemetryEvents,
    } = await import('./htmlProjectAgentTelemetry');

    recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'a' }));
    recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'b' }));
    expect(getHtmlProjectTelemetryEvents()).toHaveLength(2);

    clearHtmlProjectTelemetryEvents();
    expect(getHtmlProjectTelemetryEvents()).toHaveLength(0);
  });

  it('new G14 fields round-trip through the clone (runId/turnIndex/finishReason/autoContinued/abortReason/runtimeDiagnosticState)', async () => {
    const { recordHtmlProjectTelemetryEvent, getHtmlProjectTelemetryEvents } = await import(
      './htmlProjectAgentTelemetry'
    );

    const event = baseEvent({
      runId: 'run-abc-123',
      turnIndex: 7,
      finishReason: 'complete',
      autoContinued: true,
      abortReason: undefined,
      runtimeDiagnosticState: 'clean',
    });

    recordHtmlProjectTelemetryEvent(event);

    const [retrieved] = getHtmlProjectTelemetryEvents();
    expect(retrieved.runId).toBe('run-abc-123');
    expect(retrieved.turnIndex).toBe(7);
    expect(retrieved.finishReason).toBe('complete');
    expect(retrieved.autoContinued).toBe(true);
    expect(retrieved.abortReason).toBeUndefined();
    expect(retrieved.runtimeDiagnosticState).toBe('clean');
  });

  it('recordHtmlProjectTelemetryEvent fires a background IndexedDB write (after microtask flush)', async () => {
    const { recordHtmlProjectTelemetryEvent } = await import('./htmlProjectAgentTelemetry');

    recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'persisted', runId: 'r1' }));

    // Before flush — write is queued, not yet applied
    expect(mockDb.add).not.toHaveBeenCalled();

    // Allow hydration + queued write to settle
    await flushPromises();

    expect(mockDb.add).toHaveBeenCalledTimes(1);
    expect(mockDb.add).toHaveBeenCalledWith(
      'events',
      expect.objectContaining({ intent: 'persisted', runId: 'r1' }),
    );
  });

  it('getHtmlProjectTelemetryEventsFromStore returns persisted events in insertion order', async () => {
    const { recordHtmlProjectTelemetryEvent, getHtmlProjectTelemetryEventsFromStore } =
      await import('./htmlProjectAgentTelemetry');

    recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'first', runId: 'r1' }));
    recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'second', runId: 'r2' }));
    recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'third', runId: 'r3' }));

    await flushPromises();

    const persisted = await getHtmlProjectTelemetryEventsFromStore();
    expect(persisted).toHaveLength(3);
    expect(persisted[0].intent).toBe('first');
    expect(persisted[1].intent).toBe('second');
    expect(persisted[2].intent).toBe('third');
  });

  it('IndexedDB ring buffer evicts oldest beyond 200 on write path', async () => {
    const { recordHtmlProjectTelemetryEvent, getHtmlProjectTelemetryEventsFromStore } =
      await import('./htmlProjectAgentTelemetry');

    for (let i = 0; i < 205; i += 1) {
      recordHtmlProjectTelemetryEvent(baseEvent({ intent: `intent-${i}`, toolRounds: i }));
    }

    await flushPromises();

    // add called 205 times; delete called 5 times (eviction of oldest 5)
    expect(mockDb.add).toHaveBeenCalledTimes(205);
    expect(mockDb.delete).toHaveBeenCalledTimes(5);

    const persisted = await getHtmlProjectTelemetryEventsFromStore();
    expect(persisted).toHaveLength(200);
    expect(persisted[0].intent).toBe('intent-5');
    expect(persisted[0].toolRounds).toBe(5);
    expect(persisted[199].intent).toBe('intent-204');
    expect(persisted[199].toolRounds).toBe(204);
  });

  it('clearHtmlProjectTelemetryEvents clears the IndexedDB store (after flush)', async () => {
    const {
      recordHtmlProjectTelemetryEvent,
      clearHtmlProjectTelemetryEvents,
      getHtmlProjectTelemetryEventsFromStore,
    } = await import('./htmlProjectAgentTelemetry');

    recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'a' }));
    recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'b' }));
    await flushPromises();

    expect(await getHtmlProjectTelemetryEventsFromStore()).toHaveLength(2);

    clearHtmlProjectTelemetryEvents();
    await flushPromises();

    expect(mockDb.clear).toHaveBeenCalledTimes(1);
    expect(mockDb.clear).toHaveBeenCalledWith('events');
    expect(await getHtmlProjectTelemetryEventsFromStore()).toHaveLength(0);
  });

  it('persists clones (mutations to caller-held event do not leak into IndexedDB)', async () => {
    const { recordHtmlProjectTelemetryEvent, getHtmlProjectTelemetryEventsFromStore } =
      await import('./htmlProjectAgentTelemetry');

    const event = baseEvent({ intent: 'original', selectedPackSet: ['pack-a'] });
    recordHtmlProjectTelemetryEvent(event);

    // Mutate the caller-held event AFTER recording
    event.intent = 'mutated';
    event.selectedPackSet.push('pack-b');

    await flushPromises();

    const [persisted] = await getHtmlProjectTelemetryEventsFromStore();
    expect(persisted.intent).toBe('original');
    expect(persisted.selectedPackSet).toEqual(['pack-a']);
  });

  it('recordHtmlProjectTelemetryEvent stays sync (returns void, does not block caller)', async () => {
    const { recordHtmlProjectTelemetryEvent } = await import('./htmlProjectAgentTelemetry');

    const result = recordHtmlProjectTelemetryEvent(baseEvent({ intent: 'sync-check' }));
    expect(result).toBeUndefined();
  });
});
