import { RagChunk } from '../types';
import { generateEmbedding } from './embeddingService';
import { queryCacheService } from './queryCacheService';
import { ragQueryService, RagQueryOptions } from './ragQueryService';

/**
 * Performance metrics for monitoring cache effectiveness
 */
interface CacheMetrics {
  totalQueries: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  averageQueryTime: number;
  averageCacheHitTime: number;
  averageFullRagTime: number;
}

/**
 * Cached RAG Manager - Acts as a caching decorator around the core RAG service
 * This maintains separation of concerns: RAG logic vs Cache logic
 */
export class RagCacheManager {
  private metrics: CacheMetrics = {
    totalQueries: 0,
    cacheHits: 0,
    cacheMisses: 0,
    hitRate: 0,
    averageQueryTime: 0,
    averageCacheHitTime: 0,
    averageFullRagTime: 0,
  };

  private totalQueryTime = 0;
  private totalCacheHitTime = 0;
  private totalFullRagTime = 0;

  /**
   * Cached RAG query - checks cache first, delegates to core RAG service if needed
   * This preserves the original Turso → IndexedDB fallback behavior
   */
  async performCachedRagQuery(
    query: string,
    assistantId: string,
    ragChunks: RagChunk[],
    options: RagQueryOptions & {
      similarityThreshold?: number;
      enableCache?: boolean;
    } = {},
  ): Promise<{
    results: RagChunk[];
    fromCache: boolean;
    queryTime: number;
    cacheStats?: {
      similarity?: number;
      originalQuery?: string;
    };
    ragMetadata?: {
      source: 'turso' | 'indexeddb' | 'empty';
      totalCandidates: number;
      filteredCandidates: number;
      finalResults: number;
    };
  }> {
    const startTime = Date.now();
    this.metrics.totalQueries++;

    const { similarityThreshold = 0.9, enableCache = true, ...ragOptions } = options;

    try {
      if (!enableCache) {
        // Skip cache, go directly to core RAG service
        const ragResult = await ragQueryService.performRagQuery(
          query,
          assistantId,
          ragChunks,
          ragOptions,
        );

        const queryTime = Date.now() - startTime;
        this.updateMetrics(false, queryTime);

        return {
          results: ragResult.results,
          fromCache: false,
          queryTime,
          ragMetadata: {
            source: ragResult.source,
            totalCandidates: ragResult.metadata.totalCandidates,
            filteredCandidates: ragResult.metadata.filteredCandidates,
            finalResults: ragResult.metadata.finalResults,
          },
        };
      }

      // Step 1: Generate query embedding for cache lookup
      const queryEmbedding = await generateEmbedding(query, 'query');

      // Step 2: Search for similar cached queries
      const cachedEntry = await queryCacheService.searchSimilarQuery(
        queryEmbedding,
        assistantId,
        similarityThreshold,
      );

      if (cachedEntry) {
        // Cache hit!
        const queryTime = Date.now() - startTime;
        this.updateMetrics(true, queryTime);

        console.log(
          `🎯 RAG Cache Hit! Query: "${query}" matched "${cachedEntry.queryText}" (${queryTime}ms)`,
        );

        return {
          results: cachedEntry.rerankedResults,
          fromCache: true,
          queryTime,
          cacheStats: {
            similarity: this.calculateSimilarity(queryEmbedding, cachedEntry.queryEmbedding),
            originalQuery: cachedEntry.queryText,
          },
        };
      }

      // Cache miss - perform full RAG using the core service and cache the result
      console.log(`💾 RAG Cache Miss - performing full RAG for: "${query}"`);

      const ragResult = await ragQueryService.performRagQuery(
        query,
        assistantId,
        ragChunks,
        ragOptions,
      );

      // Cache the results for future queries (only if we got meaningful results)
      if (ragResult.results.length > 0) {
        await queryCacheService.cacheQueryResult(
          query,
          queryEmbedding,
          ragResult.results,
          assistantId,
        );
      }

      const queryTime = Date.now() - startTime;
      this.updateMetrics(false, queryTime);

      console.log(`✅ RAG query completed and cached in ${queryTime}ms`);

      return {
        results: ragResult.results,
        fromCache: false,
        queryTime,
        ragMetadata: {
          source: ragResult.source,
          totalCandidates: ragResult.metadata.totalCandidates,
          filteredCandidates: ragResult.metadata.filteredCandidates,
          finalResults: ragResult.metadata.finalResults,
        },
      };
    } catch (error) {
      console.error('Error in cached RAG query:', error);

      // Fallback to core RAG service without caching on error
      try {
        const ragResult = await ragQueryService.performRagQuery(
          query,
          assistantId,
          ragChunks,
          ragOptions,
        );

        const queryTime = Date.now() - startTime;
        this.updateMetrics(false, queryTime);

        return {
          results: ragResult.results,
          fromCache: false,
          queryTime,
          ragMetadata: {
            source: ragResult.source,
            totalCandidates: ragResult.metadata.totalCandidates,
            filteredCandidates: ragResult.metadata.filteredCandidates,
            finalResults: ragResult.metadata.finalResults,
          },
        };
      } catch (fallbackError) {
        console.error('Fallback RAG query also failed:', fallbackError);
        throw fallbackError;
      }
    }
  }

  /**
   * Convert results to context string using the core service
   */
  resultsToContextString(results: RagChunk[]): string {
    return ragQueryService.resultsToContextString(results);
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  private calculateSimilarity(embeddingA: number[], embeddingB: number[]): number {
    if (embeddingA.length !== embeddingB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < embeddingA.length; i++) {
      dotProduct += embeddingA[i] * embeddingB[i];
      normA += embeddingA[i] * embeddingA[i];
      normB += embeddingB[i] * embeddingB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(isHit: boolean, queryTime: number): void {
    this.totalQueryTime += queryTime;

    if (isHit) {
      this.metrics.cacheHits++;
      this.totalCacheHitTime += queryTime;
    } else {
      this.metrics.cacheMisses++;
      this.totalFullRagTime += queryTime;
    }

    // Recalculate derived metrics
    this.metrics.hitRate = this.metrics.cacheHits / this.metrics.totalQueries;
    this.metrics.averageQueryTime = this.totalQueryTime / this.metrics.totalQueries;
    this.metrics.averageCacheHitTime =
      this.metrics.cacheHits > 0 ? this.totalCacheHitTime / this.metrics.cacheHits : 0;
    this.metrics.averageFullRagTime =
      this.metrics.cacheMisses > 0 ? this.totalFullRagTime / this.metrics.cacheMisses : 0;
  }

  /**
   * Get current cache performance metrics
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset performance metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      hitRate: 0,
      averageQueryTime: 0,
      averageCacheHitTime: 0,
      averageFullRagTime: 0,
    };
    this.totalQueryTime = 0;
    this.totalCacheHitTime = 0;
    this.totalFullRagTime = 0;
  }

  /**
   * Clear all cache for a specific assistant
   */
  async clearAssistantCache(assistantId: string): Promise<number> {
    return await queryCacheService.clearAssistantCache(assistantId);
  }

  /**
   * Perform cache maintenance (cleanup expired entries)
   */
  async performMaintenance(): Promise<{
    expiredEntriesDeleted: number;
    cacheStats: Awaited<ReturnType<typeof queryCacheService.getCacheStats>>;
  }> {
    console.log('🧹 Performing RAG cache maintenance...');

    const expiredEntriesDeleted = await queryCacheService.cleanupExpiredCache();
    const cacheStats = await queryCacheService.getCacheStats();

    console.log(`✅ Cache maintenance completed: ${expiredEntriesDeleted} expired entries deleted`);

    return {
      expiredEntriesDeleted,
      cacheStats,
    };
  }

  /**
   * Get detailed cache statistics
   */
  async getCacheStats(): Promise<{
    performanceMetrics: CacheMetrics;
    storageStats: Awaited<ReturnType<typeof queryCacheService.getCacheStats>>;
  }> {
    const storageStats = await queryCacheService.getCacheStats();

    return {
      performanceMetrics: this.getMetrics(),
      storageStats,
    };
  }

  /**
   * Configure cache settings
   */
  configureCacheSettings(settings: {
    similarityThreshold?: number;
    autoMaintenance?: boolean;
    maintenanceInterval?: number;
  }): void {
    const { similarityThreshold, autoMaintenance, maintenanceInterval } = settings;

    if (similarityThreshold !== undefined) {
      queryCacheService.setSimilarityThreshold(similarityThreshold);
      console.log(`🎛️ Cache similarity threshold set to ${similarityThreshold}`);
    }

    if (autoMaintenance && maintenanceInterval) {
      // Set up automatic cache maintenance
      setInterval(() => {
        this.performMaintenance().catch(error => {
          console.error('Auto maintenance failed:', error);
        });
      }, maintenanceInterval);

      console.log(`⏰ Auto maintenance enabled: every ${maintenanceInterval}ms`);
    }
  }

  /**
   * Warm up the cache by pre-generating embeddings for common queries
   */
  async warmupCache(commonQueries: string[], _assistantId: string): Promise<void> {
    console.log(`🔥 Warming up cache with ${commonQueries.length} common queries...`);

    for (const query of commonQueries) {
      try {
        // Just generate embeddings to preload the model
        await generateEmbedding(query, 'query');
        console.log(`✅ Warmed up query: "${query}"`);
      } catch (error) {
        console.warn(`⚠️ Failed to warm up query "${query}":`, error);
      }
    }

    console.log('🔥 Cache warmup completed');
  }
}

// Singleton instance for global use - NEW VERSION
export const ragCacheManagerV2 = new RagCacheManager();
