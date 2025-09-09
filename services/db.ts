import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Assistant, ChatSession } from '../types';

const DB_NAME = 'professional-assistant-db';
const DB_VERSION = 1;
const ASSISTANTS_STORE = 'assistants';
export const SESSIONS_STORE = 'sessions';

interface ProfessionalAssistantDB extends DBSchema {
  [ASSISTANTS_STORE]: {
    key: string;
    value: Assistant;
  };
  [SESSIONS_STORE]: {
    key: string;
    value: ChatSession;
    indexes: { 'by-assistant': string };
  };
}

let dbPromise: Promise<IDBPDatabase<ProfessionalAssistantDB>> | null = null;

const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDB<ProfessionalAssistantDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(ASSISTANTS_STORE)) {
          db.createObjectStore(ASSISTANTS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          const sessionStore = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
          sessionStore.createIndex('by-assistant', 'assistantId');
        }
      },
    });
  }
  return dbPromise;
};

// Assistant operations
export const getAllAssistants = async (): Promise<Assistant[]> => {
  const db = await getDb();
  return db.getAll(ASSISTANTS_STORE);
};

export const getAssistant = async (id: string): Promise<Assistant | undefined> => {
  const db = await getDb();
  return db.get(ASSISTANTS_STORE, id);
};

export const saveAssistant = async (assistant: Assistant): Promise<void> => {
  const db = await getDb();
  await db.put(ASSISTANTS_STORE, assistant);
};

export const deleteAssistant = async (id: string): Promise<void> => {
  const db = await getDb();
  await db.delete(ASSISTANTS_STORE, id);
  // Also delete associated sessions
  const sessions = await getSessionsForAssistant(id);
  const tx = db.transaction(SESSIONS_STORE, 'readwrite');
  await Promise.all(sessions.map(session => tx.store.delete(session.id)));
  await tx.done;
};

// Session operations
export const getSessionsForAssistant = async (assistantId: string): Promise<ChatSession[]> => {
  const db = await getDb();
  return db.getAllFromIndex(SESSIONS_STORE, 'by-assistant', assistantId);
};

export const saveSession = async (session: ChatSession): Promise<void> => {
  const db = await getDb();
  await db.put(SESSIONS_STORE, session);
};

export const deleteSession = async (id: string): Promise<void> => {
  const db = await getDb();
  await db.delete(SESSIONS_STORE, id);
};
