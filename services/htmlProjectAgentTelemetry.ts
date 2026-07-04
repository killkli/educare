import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { HtmlProjectAgentTelemetryEvent } from '../types';

/**
 * G14: Telemetry ring buffer cap. In-memory cache + durable IndexedDB store
 * both retain the newest 200 events (evict oldest beyond cap).
 */
const MAX_TELEMETRY_EVENTS = 200;

/**
 * Self-contained IndexedDB handle (does NOT touch the shared htmlProjectStore
 * schema, which would require editing a non-owned file). Dedicated DB + store
 * so this module owns its full lifecycle.
 */
const TELEMETRY_DB_NAME = 'educare-html-project-agent-telemetry';
const TELEMETRY_DB_VERSION = 1;
const TELEMETRY_STORE = 'events';

interface TelemetryDB extends DBSchema {
  [TELEMETRY_STORE]: {
    /** autoIncrement numeric key — natural insertion order. */
    key: number;
    value: HtmlProjectAgentTelemetryEvent;
  };
}

const telemetryEvents: HtmlProjectAgentTelemetryEvent[] = [];

let dbPromise: Promise<IDBPDatabase<TelemetryDB>> | null = null;
/**
 * Serialized write queue. Initialized to the best-effort hydration promise so
 * that (a) on page refresh the in-memory cache is hydrated from IndexedDB and
 * (b) subsequent background writes are ordered and never block the sync caller.
 */
let writeQueue: Promise<void> = Promise.resolve();

const cloneTelemetryEvent = (
  event: HtmlProjectAgentTelemetryEvent,
): HtmlProjectAgentTelemetryEvent => ({
  ...event,
  selectedPackSet: [...event.selectedPackSet],
  toolSequence: [...event.toolSequence],
  repeatedRecoverableErrors: event.repeatedRecoverableErrors.map(entry => ({ ...entry })),
});

const getTelemetryDb = (): Promise<IDBPDatabase<TelemetryDB>> => {
  if (!dbPromise) {
    dbPromise = openDB<TelemetryDB>(TELEMETRY_DB_NAME, TELEMETRY_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(TELEMETRY_STORE)) {
          // autoIncrement key gives natural insertion order without polluting
          // the stored event value with a synthetic _seq field.
          db.createObjectStore(TELEMETRY_STORE, { autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
};

/**
 * Append event to IndexedDB and enforce newest-200 retention (evict oldest).
 * getAll/getAllKeys return results in key order, so the smallest keys are the
 * oldest entries to evict.
 */
const persistEvent = async (event: HtmlProjectAgentTelemetryEvent): Promise<void> => {
  const db = await getTelemetryDb();
  await db.add(TELEMETRY_STORE, cloneTelemetryEvent(event));

  const keys = (await db.getAllKeys(TELEMETRY_STORE)) as number[];
  if (keys.length > MAX_TELEMETRY_EVENTS) {
    keys.sort((a, b) => a - b);
    const evictCount = keys.length - MAX_TELEMETRY_EVENTS;
    for (let i = 0; i < evictCount; i += 1) {
      await db.delete(TELEMETRY_STORE, keys[i]);
    }
  }
};

/**
 * Best-effort hydrate the in-memory cache from IndexedDB on module init so a
 * page refresh retains recent telemetry. Newest 200 only; older entries are
 * ignored (retention enforced on write path).
 */
const hydrateFromStore = async (): Promise<void> => {
  try {
    const db = await getTelemetryDb();
    const all = await db.getAll(TELEMETRY_STORE);
    const newest = all.slice(-MAX_TELEMETRY_EVENTS);
    for (const event of newest) {
      telemetryEvents.push(cloneTelemetryEvent(event));
    }
  } catch (error) {
    // Hydration is best-effort; never break the chat flow on failure.
    console.warn('[htmlProjectAgentTelemetry] Failed to hydrate from IndexedDB:', error);
  }
};

/**
 * Chain a write onto the queue, swallowing persistence errors so telemetry
 * failures never break the chat flow. Caller stays sync (void).
 */
const enqueuePersist = (task: () => Promise<void>): void => {
  writeQueue = writeQueue.then(task).catch(error => {
    console.warn('[htmlProjectAgentTelemetry] Persistence operation failed:', error);
  });
};

// Kick off best-effort hydration as the seed of the write queue. Subsequent
// writes chain after it so the cache is populated before the first append.
writeQueue = hydrateFromStore();

export const recordHtmlProjectTelemetryEvent = (event: HtmlProjectAgentTelemetryEvent): void => {
  const cloned = cloneTelemetryEvent(event);
  telemetryEvents.push(cloned);
  if (telemetryEvents.length > MAX_TELEMETRY_EVENTS) {
    telemetryEvents.shift();
  }
  // Fire-and-forget background persistence; never awaits (caller is sync).
  enqueuePersist(() => persistEvent(cloned));
};

/**
 * Returns clones of the in-memory ring buffer (newest 200). SYNC and
 * backward-compatible — existing callers continue to work unchanged.
 */
export const getHtmlProjectTelemetryEvents = (): HtmlProjectAgentTelemetryEvent[] =>
  telemetryEvents.map(cloneTelemetryEvent);

/**
 * G14: Reads the durable IndexedDB ring buffer. For the success-rate evaluation
 * use case where the caller wants events that survived a page refresh.
 * Returns events in insertion order (oldest to newest). Errors → empty array.
 */
export const getHtmlProjectTelemetryEventsFromStore = async (): Promise<
  HtmlProjectAgentTelemetryEvent[]
> => {
  try {
    const db = await getTelemetryDb();
    const all = await db.getAll(TELEMETRY_STORE);
    return all.map(cloneTelemetryEvent);
  } catch (error) {
    console.warn('[htmlProjectAgentTelemetry] Failed to read persisted events:', error);
    return [];
  }
};

export const clearHtmlProjectTelemetryEvents = (): void => {
  telemetryEvents.length = 0;
  // Fire-and-forget clear of the IndexedDB store.
  enqueuePersist(async () => {
    const db = await getTelemetryDb();
    await db.clear(TELEMETRY_STORE);
  });
};
