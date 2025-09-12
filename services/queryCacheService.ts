/// <reference lib="dom" />

/* global indexedDB, IDBOpenDBRequest, IDBDatabase, IDBRequest, IDBKeyRange */

import { QueryCacheEntry, RagChunk } from '../types';
import { cosineSimilarity } from './embeddingService';

/**
 * IndexedDB based vector cache for query results
 * Provides efficient storage and retrieval of query embeddings and their reranked results
 */

class QueryCacheDB {
  private dbName = 'EduCareQueryCache';
  private version = 1;
  storeName = 'queryCache';
  private db: IDBDatabase | null = null;

  /**
   * Initialize the IndexedDB connection
   */
  async initDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('Failed to open QueryCache database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create the query cache store
        const store = db.createObjectStore(this.storeName, { keyPath: 'id' });

        // Create indexes for efficient querying
        store.createIndex('assistantId', 'assistantId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('lastAccessTime', 'lastAccessTime', { unique: false });

        console.log('QueryCache database initialized');
      };
    });
  }

  /**
   * Store a query cache entry
   */
  async storeEntry(entry: QueryCacheEntry): Promise<void> {
    const db = await this.initDB();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    await new Promise<void>((resolve, reject) => {
      const request = store.put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retrieve all cache entries for a specific assistant
   */
  async getEntriesByAssistant(assistantId: string): Promise<QueryCacheEntry[]> {
    const db = await this.initDB();
    const transaction = db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);
    const index = store.index('assistantId');

    return new Promise((resolve, reject) => {
      const request = index.getAll(assistantId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update an existing cache entry (for hit count and last access time)
   */
  async updateEntry(id: string, updates: Partial<QueryCacheEntry>): Promise<void> {
    const db = await this.initDB();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const entry = getRequest.result;
        if (entry) {
          const updatedEntry = { ...entry, ...updates };
          const putRequest = store.put(updatedEntry);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          reject(new Error(`Cache entry with id ${id} not found`));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Delete cache entries for a specific assistant
   */
  async clearAssistantCache(assistantId: string): Promise<number> {
    const entries = await this.getEntriesByAssistant(assistantId);
    const db = await this.initDB();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    let deletedCount = 0;
    for (const entry of entries) {
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(entry.id);
        request.onsuccess = () => {
          deletedCount++;
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }

    console.log(`Cleared ${deletedCount} cache entries for assistant ${assistantId}`);
    return deletedCount;
  }

  /**
   * Clean up expired cache entries (older than 30 days)
   */
  async cleanupExpiredEntries(): Promise<number> {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const db = await this.initDB();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const index = store.index('lastAccessTime');

    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.upperBound(thirtyDaysAgo);
      const request = index.openCursor(range);
      let deletedCount = 0;

      request.onsuccess = event => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          console.log(`Cleaned up ${deletedCount} expired cache entries`);
          resolve(deletedCount);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Enforce cache size limit per assistant (keep only top 1000 entries by access time)
   */
  async enforceCacheLimit(assistantId: string, maxEntries = 1000): Promise<number> {
    const entries = await this.getEntriesByAssistant(assistantId);

    if (entries.length <= maxEntries) {
      return 0;
    }

    // Sort by lastAccessTime (oldest first)
    entries.sort((a, b) => a.lastAccessTime - b.lastAccessTime);
    const entriesToDelete = entries.slice(0, entries.length - maxEntries);

    const db = await this.initDB();
    const transaction = db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);

    let deletedCount = 0;
    for (const entry of entriesToDelete) {
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(entry.id);
        request.onsuccess = () => {
          deletedCount++;
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }

    console.log(
      `Enforced cache limit for assistant ${assistantId}: deleted ${deletedCount} entries`,
    );
    return deletedCount;
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalEntries: number;
    entriesByAssistant: Record<string, number>;
    oldestEntry: number | null;
    newestEntry: number | null;
  }> {
    const db = await this.initDB();
    const transaction = db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const entries: QueryCacheEntry[] = request.result || [];

        const stats = {
          totalEntries: entries.length,
          entriesByAssistant: {} as Record<string, number>,
          oldestEntry: null as number | null,
          newestEntry: null as number | null,
        };

        if (entries.length > 0) {
          // Count entries per assistant
          for (const entry of entries) {
            stats.entriesByAssistant[entry.assistantId] =
              (stats.entriesByAssistant[entry.assistantId] || 0) + 1;
          }

          // Find oldest and newest entries
          const timestamps = entries.map(e => e.timestamp);
          stats.oldestEntry = Math.min(...timestamps);
          stats.newestEntry = Math.max(...timestamps);
        }

        resolve(stats);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

/**
 * High-level cache service for managing query cache operations
 */
export class QueryCacheService {
  private cacheDB: QueryCacheDB;
  private similarityThreshold = 0.75;

  constructor() {
    this.cacheDB = new QueryCacheDB();
  }

  /**
   * Search for similar cached queries
   */
  async searchSimilarQuery(
    queryEmbedding: number[],
    assistantId: string,
    threshold: number = this.similarityThreshold,
  ): Promise<QueryCacheEntry | null> {
    try {
      const entries = await this.cacheDB.getEntriesByAssistant(assistantId);

      let bestMatch: QueryCacheEntry | null = null;
      let bestSimilarity = 0;

      for (const entry of entries) {
        const similarity = cosineSimilarity(queryEmbedding, entry.queryEmbedding);

        if (similarity >= threshold && similarity > bestSimilarity) {
          bestMatch = entry;
          bestSimilarity = similarity;
        }
      }

      if (bestMatch) {
        // Update hit statistics
        await this.updateHitStatistics(bestMatch.id);
        console.log(
          `🎯 Cache hit! Similarity: ${bestSimilarity.toFixed(4)} for query: "${bestMatch.queryText}"`,
        );
      }

      return bestMatch;
    } catch (error) {
      console.error('Error searching similar query:', error);
      return null;
    }
  }

  /**
   * Cache a query result
   */
  async cacheQueryResult(
    queryText: string,
    queryEmbedding: number[],
    rerankedResults: RagChunk[],
    assistantId: string,
  ): Promise<void> {
    try {
      const entry: QueryCacheEntry = {
        id: crypto.randomUUID(),
        queryText,
        queryEmbedding,
        rerankedResults,
        assistantId,
        timestamp: Date.now(),
        hitCount: 0,
        lastAccessTime: Date.now(),
      };

      await this.cacheDB.storeEntry(entry);

      // Enforce cache size limit
      await this.cacheDB.enforceCacheLimit(assistantId);

      console.log(`💾 Cached query result for assistant ${assistantId}: "${queryText}"`);
    } catch (error) {
      console.error('Error caching query result:', error);
    }
  }

  /**
   * Update hit statistics for a cache entry
   */
  private async updateHitStatistics(entryId: string): Promise<void> {
    try {
      // We need to get the current entry to increment hit count
      const db = await this.cacheDB.initDB();
      const transaction = db.transaction([this.cacheDB.storeName], 'readwrite');
      const store = transaction.objectStore(this.cacheDB.storeName);

      return new Promise((resolve, reject) => {
        const getRequest = store.get(entryId);
        getRequest.onsuccess = () => {
          const entry = getRequest.result;
          if (entry) {
            entry.hitCount = (entry.hitCount || 0) + 1;
            entry.lastAccessTime = Date.now();
            const putRequest = store.put(entry);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
          } else {
            reject(new Error(`Cache entry with id ${entryId} not found`));
          }
        };
        getRequest.onerror = () => reject(getRequest.error);
      });
    } catch (error) {
      console.error('Error updating hit statistics:', error);
      throw error;
    }
  }

  /**
   * Clear cache for a specific assistant
   */
  async clearAssistantCache(assistantId: string): Promise<number> {
    return await this.cacheDB.clearAssistantCache(assistantId);
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredCache(): Promise<number> {
    return await this.cacheDB.cleanupExpiredEntries();
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<ReturnType<typeof this.cacheDB.getCacheStats>> {
    return await this.cacheDB.getCacheStats();
  }

  /**
   * Set similarity threshold for cache hits
   */
  setSimilarityThreshold(threshold: number) {
    this.similarityThreshold = Math.max(0, Math.min(1, threshold));
  }
}

// Singleton instance
export const queryCacheService = new QueryCacheService();
