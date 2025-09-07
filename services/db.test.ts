import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAllAssistants, getAssistant, saveAssistant, deleteAssistant } from './db';
import { Assistant } from '../types';
import type { IDBPDatabase } from 'idb';

// Mock idb module
vi.mock('idb', () => ({
  openDB: vi.fn(),
}));

describe('Database Service', () => {
  const mockAssistant: Assistant = {
    id: 'test-id',
    name: 'Test Assistant',
    description: 'A test assistant',
    systemPrompt: 'You are a test assistant',
    ragChunks: [],
    createdAt: Date.now(),
  };

  const mockDB = {
    getAll: vi.fn(),
    get: vi.fn(),
    add: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { openDB } = await import('idb');
    vi.mocked(openDB).mockResolvedValue(mockDB as IDBPDatabase<unknown>);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getAllAssistants', () => {
    it('should return all assistants from database', async () => {
      const mockAssistants = [mockAssistant];
      mockDB.getAll.mockResolvedValue(mockAssistants);

      const result = await getAllAssistants();

      expect(mockDB.getAll).toHaveBeenCalledWith('assistants');
      expect(result).toEqual(mockAssistants);
    });

    it('should handle database errors', async () => {
      mockDB.getAll.mockRejectedValue(new Error('Database error'));

      await expect(getAllAssistants()).rejects.toThrow('Database error');
    });
  });

  describe('getAssistant', () => {
    it('should return specific assistant by id', async () => {
      mockDB.get.mockResolvedValue(mockAssistant);

      const result = await getAssistant('test-id');

      expect(mockDB.get).toHaveBeenCalledWith('assistants', 'test-id');
      expect(result).toEqual(mockAssistant);
    });

    it('should return undefined for non-existent assistant', async () => {
      mockDB.get.mockResolvedValue(undefined);

      const result = await getAssistant('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('saveAssistant', () => {
    it('should save assistant to database', async () => {
      mockDB.put.mockResolvedValue(undefined);

      await saveAssistant(mockAssistant);

      expect(mockDB.put).toHaveBeenCalledWith('assistants', mockAssistant);
    });
  });

  describe('deleteAssistant', () => {
    it('should delete assistant from database', async () => {
      mockDB.delete.mockResolvedValue(undefined);

      await deleteAssistant('test-id');

      expect(mockDB.delete).toHaveBeenCalledWith('assistants', 'test-id');
    });
  });
});
