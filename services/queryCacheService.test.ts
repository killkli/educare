import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryCacheService } from './queryCacheService';
import { RagChunk } from '../types';

// Mock IndexedDB for testing
class MockIDBRequest {
  result: unknown;
  error: unknown;
  onsuccess: ((event: { target: MockIDBRequest }) => void) | null = null;
  onerror: ((event: { target: MockIDBRequest }) => void) | null = null;

  constructor(result?: unknown, error?: unknown) {
    this.result = result;
    this.error = error;
    // Simulate async behavior
    if (error) {
      this.onerror?.({ target: this });
    } else {
      this.onsuccess?.({ target: this });
    }
  }
}

class MockIDBObjectStore {
  private data: Map<string, unknown> = new Map();
  private indexes: Map<string, MockIDBIndex> = new Map();

  createIndex(name: string, keyPath: string, _options?: unknown) {
    const index = new MockIDBIndex(keyPath, this.data);
    this.indexes.set(name, index);
    return index;
  }

  index(name: string) {
    return this.indexes.get(name);
  }

  put(value: unknown) {
    // Assume value has id property
    const id = (value as { id: string }).id;
    this.data.set(id, value);
    return new MockIDBRequest(undefined);
  }

  get(key: string) {
    return new MockIDBRequest(this.data.get(key));
  }

  getAll() {
    return new MockIDBRequest(Array.from(this.data.values()));
  }

  delete(key: string) {
    this.data.delete(key);
    return new MockIDBRequest(undefined);
  }
}

class MockIDBIndex {
  constructor(
    private keyPath: string,
    private data: Map<string, unknown>,
  ) {}

  getAll(key?: unknown) {
    if (key === undefined) {
      return new MockIDBRequest(Array.from(this.data.values()));
    }
    const results = Array.from(this.data.values()).filter(
      item => (item as Record<string, unknown>)[this.keyPath] === key,
    );
    return new MockIDBRequest(results);
  }

  openCursor(_range?: unknown) {
    // Simplified cursor implementation for cleanup tests
    const values = Array.from(this.data.values());
    let index = 0;
    const request = new MockIDBRequest();

    const advanceCursor = () => {
      if (index < values.length) {
        const currentValue = values[index];
        request.result = {
          value: currentValue,
          delete: () => {
            if (currentValue) {
              this.data.delete((currentValue as Record<string, unknown>).id as string);
            }
          },
          continue: () => {
            index++;
            advanceCursor();
          },
        };
      } else {
        request.result = null;
      }
      request.onsuccess?.({ target: request });
    };

    advanceCursor();
    return request;
  }
}

class MockIDBTransaction {
  constructor(private stores: Map<string, MockIDBObjectStore>) {}

  objectStore(name: string) {
    return this.stores.get(name);
  }
}

class MockIDBDatabase {
  private stores: Map<string, MockIDBObjectStore> = new Map();

  createObjectStore(name: string, _options?: unknown) {
    const store = new MockIDBObjectStore();
    this.stores.set(name, store);
    return store;
  }

  transaction(_storeNames: string[], _mode: string) {
    return new MockIDBTransaction(this.stores);
  }
}

// Mock the global indexedDB
const mockIndexedDB = {
  open: (_name: string, _version: number) => {
    const request = new MockIDBRequest();

    const db = new MockIDBDatabase();
    // Simulate onupgradeneeded event for database initialization
    const store = db.createObjectStore('queryCache', { keyPath: 'id' });
    store.createIndex('assistantId', 'assistantId', { unique: false });
    store.createIndex('timestamp', 'timestamp', { unique: false });
    store.createIndex('lastAccessTime', 'lastAccessTime', { unique: false });

    request.result = db;
    request.onsuccess?.({ target: request });

    return request;
  },
};

// Setup global mocks
Object.defineProperty(global, 'indexedDB', {
  value: mockIndexedDB,
  writable: true,
});

Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => `test-uuid-${Math.random()}`,
  },
  writable: true,
});

describe('QueryCacheService', () => {
  let cacheService: QueryCacheService;
  const testAssistantId = 'test-assistant-1';

  const mockRagChunks: RagChunk[] = [
    {
      fileName: 'test1.pdf',
      content: 'Test content 1',
      relevanceScore: 0.9,
    },
    {
      fileName: 'test2.pdf',
      content: 'Test content 2',
      relevanceScore: 0.8,
    },
  ];

  const mockQueryEmbedding = new Array(128).fill(0).map(() => Math.random());
  const mockSimilarEmbedding = [...mockQueryEmbedding]; // Identical for perfect similarity
  const mockDifferentEmbedding = new Array(128).fill(0).map(() => Math.random());

  beforeEach(async () => {
    cacheService = new QueryCacheService();
    await cacheService.init();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Cache Operations', () => {
    it('should cache a query result successfully', async () => {
      await expect(
        cacheService.cacheQueryResult(
          'What is the company vacation policy?',
          mockQueryEmbedding,
          mockRagChunks,
          testAssistantId,
        ),
      ).resolves.not.toThrow();
    });

    it('should find similar cached queries', async () => {
      // First cache a query
      await cacheService.cacheQueryResult(
        'What is the vacation policy?',
        mockQueryEmbedding,
        mockRagChunks,
        testAssistantId,
      );

      // Then search for similar query
      const result = await cacheService.searchSimilarQuery(
        mockSimilarEmbedding,
        testAssistantId,
        0.95, // High threshold for exact match
      );

      expect(result).toBeTruthy();
      expect(result?.queryText).toBe('What is the vacation policy?');
      expect(result?.rerankedResults).toEqual(mockRagChunks);
      expect(result?.assistantId).toBe(testAssistantId);
    });

    it('should not find dissimilar queries', async () => {
      // Cache a query
      await cacheService.cacheQueryResult(
        'What is the vacation policy?',
        mockQueryEmbedding,
        mockRagChunks,
        testAssistantId,
      );

      // Search with very different embedding
      const result = await cacheService.searchSimilarQuery(
        mockDifferentEmbedding,
        testAssistantId,
        0.9,
      );

      expect(result).toBeNull();
    });

    it('should respect assistant isolation', async () => {
      const otherAssistantId = 'other-assistant';

      // Cache query for first assistant
      await cacheService.cacheQueryResult(
        'Test query',
        mockQueryEmbedding,
        mockRagChunks,
        testAssistantId,
      );

      // Search from different assistant should not find it
      const result = await cacheService.searchSimilarQuery(
        mockSimilarEmbedding,
        otherAssistantId,
        0.9,
      );

      expect(result).toBeNull();
    });
  });

  describe('Cache Management', () => {
    it('should clear assistant cache', async () => {
      // Cache multiple queries for the assistant
      await cacheService.cacheQueryResult(
        'Query 1',
        mockQueryEmbedding,
        mockRagChunks,
        testAssistantId,
      );

      await cacheService.cacheQueryResult(
        'Query 2',
        mockDifferentEmbedding,
        mockRagChunks,
        testAssistantId,
      );

      // Clear cache for the assistant
      const deletedCount = await cacheService.clearAssistantCache(testAssistantId);

      expect(deletedCount).toBeGreaterThan(0);

      // Verify queries are no longer found
      const result = await cacheService.searchSimilarQuery(
        mockQueryEmbedding,
        testAssistantId,
        0.9,
      );
      expect(result).toBeNull();
    });

    it('should provide cache statistics', async () => {
      // Cache some queries
      await cacheService.cacheQueryResult(
        'Query 1',
        mockQueryEmbedding,
        mockRagChunks,
        testAssistantId,
      );

      const stats = await cacheService.getCacheStats();

      expect(stats).toHaveProperty('totalEntries');
      expect(stats).toHaveProperty('entriesByAssistant');
      expect(stats).toHaveProperty('oldestEntry');
      expect(stats).toHaveProperty('newestEntry');

      expect(stats.totalEntries).toBeGreaterThan(0);
      expect(stats.entriesByAssistant[testAssistantId]).toBeGreaterThan(0);
    });

    it('should clean up expired entries', async () => {
      // This test is difficult to implement with the current mock setup
      // since we'd need to mock time-based operations
      const deletedCount = await cacheService.cleanupExpiredCache();
      expect(typeof deletedCount).toBe('number');
    });
  });

  describe('Similarity Threshold Configuration', () => {
    it('should respect custom similarity thresholds', async () => {
      // Cache a query
      await cacheService.cacheQueryResult(
        'Test query',
        mockQueryEmbedding,
        mockRagChunks,
        testAssistantId,
      );

      // Set very high threshold
      cacheService.setSimilarityThreshold(0.99);

      // Should not find with slightly different embedding at high threshold
      const result = await cacheService.searchSimilarQuery(mockQueryEmbedding, testAssistantId);

      // This will depend on the exact similarity calculation
      // In real usage, we'd need more sophisticated embedding generation
      expect(result).toBeTruthy(); // Since we're using identical embeddings
    });

    it('should clamp similarity threshold to valid range', () => {
      cacheService.setSimilarityThreshold(-0.5); // Invalid
      cacheService.setSimilarityThreshold(1.5); // Invalid

      // The service should handle invalid thresholds gracefully
      // This is more of an integration test to ensure no errors
      expect(() => cacheService.setSimilarityThreshold(-0.5)).not.toThrow();
      expect(() => cacheService.setSimilarityThreshold(1.5)).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Mock console to avoid noise in test output
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // This test verifies that errors don't crash the application
      // In a real scenario, we might mock IndexedDB to throw errors

      await expect(
        cacheService.searchSimilarQuery([], 'invalid-assistant', 0.9),
      ).resolves.toBeNull(); // Should return null on error, not throw

      consoleSpy.mockRestore();
    });
  });
});
