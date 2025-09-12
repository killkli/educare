import { RagChunk } from '../types';
import { generateEmbedding, rerankChunks } from './embeddingService';
import { queryCacheService } from './queryCacheService';

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
 * RAG Cache Manager - High-level interface for cached RAG operations
 * Handles the complete flow of query caching, similarity search, and reranking
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
   * Cached RAG query - checks cache first, falls back to full RAG if needed
   */
  async performCachedRagQuery(
    query: string,
    assistantId: string,
    ragChunks: RagChunk[],
    options: {
      similarityThreshold?: number;
      rerankLimit?: number;
      enableReranking?: boolean;
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
  }> {
    const startTime = Date.now();
    this.metrics.totalQueries++;

    const {
      similarityThreshold = 0.9,
      rerankLimit = 5,
      enableReranking = true,
      enableCache = true,
    } = options;

    try {
      if (!enableCache) {
        // Skip cache, go directly to full RAG
        const results = await this.performFullRag(
          query,
          assistantId,
          ragChunks,
          rerankLimit,
          enableReranking,
        );
        const queryTime = Date.now() - startTime;
        this.updateMetrics(false, queryTime);
        return {
          results,
          fromCache: false,
          queryTime,
        };
      }

      // Step 1: Generate query embedding
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

      // Cache miss - perform full RAG and cache the result
      console.log(`💾 RAG Cache Miss - performing full RAG for: "${query}"`);

      const results = await this.performFullRag(
        query,
        assistantId,
        ragChunks,
        rerankLimit,
        enableReranking,
      );

      // Cache the results for future queries
      await queryCacheService.cacheQueryResult(query, queryEmbedding, results, assistantId);

      const queryTime = Date.now() - startTime;
      this.updateMetrics(false, queryTime);

      console.log(`✅ RAG query completed and cached in ${queryTime}ms`);

      return {
        results,
        fromCache: false,
        queryTime,
      };
    } catch (error) {
      console.error('Error in cached RAG query:', error);

      // Fallback to full RAG without caching on error
      try {
        const results = await this.performFullRag(
          query,
          assistantId,
          ragChunks,
          rerankLimit,
          enableReranking,
        );
        const queryTime = Date.now() - startTime;
        this.updateMetrics(false, queryTime);

        return {
          results,
          fromCache: false,
          queryTime,
        };
      } catch (fallbackError) {
        console.error('Fallback RAG query also failed:', fallbackError);
        throw fallbackError;
      }
    }
  }

  /**
   * Perform full RAG query (similarity search + optional reranking)
   */
  private async performFullRag(
    query: string,
    assistantId: string,
    ragChunks: RagChunk[],
    rerankLimit: number,
    enableReranking: boolean,
  ): Promise<RagChunk[]> {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query, 'query');

    // Search for similar chunks using cosine similarity
    let similarChunks: RagChunk[] = [];
    const maxSimilarities = 20;
    for (const chunk of ragChunks) {
      if (!chunk.vector) {
        continue;
      }
      const similarity = this.calculateSimilarity(queryEmbedding, chunk.vector);
      if (similarity > 0.5) {
        // Basic threshold
        similarChunks.push({ ...chunk, relevanceScore: similarity });
      }
    }

    // Sort by relevance
    similarChunks.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    similarChunks = similarChunks.slice(0, maxSimilarities);

    if (similarChunks.length === 0) {
      console.log('No relevant chunks found for query');
      return [];
    }

    console.log(`🔍 Found ${similarChunks.length} similar chunks`);

    if (!enableReranking) {
      return similarChunks.slice(0, rerankLimit);
    }

    // Rerank the similar chunks
    const rerankedChunks = await rerankChunks(query, similarChunks, rerankLimit);

    console.log(`🔄 Reranked to top ${rerankedChunks.length} chunks`);

    return rerankedChunks;
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

// Singleton instance for global use
export const ragCacheManager = new RagCacheManager();
