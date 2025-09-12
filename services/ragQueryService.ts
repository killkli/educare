import { RagChunk } from '../types';
import { generateEmbedding, cosineSimilarity, rerankChunks } from './embeddingService';
import { searchSimilarChunks } from './tursoService';

/**
 * RAG Query Result
 */
export interface RagQueryResult {
  results: RagChunk[];
  queryTime: number;
  source: 'turso' | 'indexeddb' | 'empty';
  metadata: {
    totalCandidates: number;
    filteredCandidates: number;
    finalResults: number;
  };
}

/**
 * RAG Query Options
 */
export interface RagQueryOptions {
  vectorSearchLimit?: number;
  rerankLimit?: number;
  enableReranking?: boolean;
  minSimilarity?: number;
}

/**
 * Core RAG Query Service - handles the original RAG flow
 * This maintains the exact same logic as the original ChatContainer/SessionManager
 */
export class RagQueryService {
  /**
   * Perform RAG query using the original flow:
   * 1. Try Turso vector search first
   * 2. Fallback to IndexedDB if Turso fails
   * 3. Apply reranking if enabled
   */
  async performRagQuery(
    query: string,
    assistantId: string,
    ragChunks: RagChunk[],
    options: RagQueryOptions = {},
  ): Promise<RagQueryResult> {
    const {
      vectorSearchLimit = 50,
      rerankLimit = 5,
      enableReranking = true,
      minSimilarity = 0.3,
    } = options;

    const startTime = Date.now();

    try {
      console.log(`🎯 [RAG QUERY] Starting query: "${query}"`);

      // Step 1: Generate query embedding
      const queryVector = await generateEmbedding(query, 'query');

      // Step 2: Try Turso vector search first (original behavior)
      console.log('🌐 [RAG QUERY] Attempting Turso vector search...');
      const tursoResults = await searchSimilarChunks(assistantId, queryVector, vectorSearchLimit);

      if (tursoResults.length > 0) {
        return await this.processTursoResults(query, tursoResults, {
          rerankLimit,
          enableReranking,
          minSimilarity,
          startTime,
        });
      }

      // Step 3: Fallback to IndexedDB (original behavior)
      console.log('⚠️ [RAG QUERY] Turso search returned no results, falling back to IndexedDB...');
      if (ragChunks.length > 0) {
        return await this.processLocalChunks(query, queryVector, ragChunks, {
          vectorSearchLimit,
          rerankLimit,
          enableReranking,
          minSimilarity,
          startTime,
        });
      }

      // Step 4: No results found
      console.log(
        '❌ [RAG QUERY] No context found - neither Turso nor IndexedDB had relevant data',
      );
      return {
        results: [],
        queryTime: Date.now() - startTime,
        source: 'empty',
        metadata: {
          totalCandidates: 0,
          filteredCandidates: 0,
          finalResults: 0,
        },
      };
    } catch (error) {
      console.error('❌ [RAG QUERY] Error in RAG query:', error);
      throw error;
    }
  }

  /**
   * Process Turso search results (original ChatContainer logic)
   */
  private async processTursoResults(
    query: string,
    tursoResults: Array<{ fileName: string; content: string; similarity: number }>,
    options: {
      rerankLimit: number;
      enableReranking: boolean;
      minSimilarity: number;
      startTime: number;
    },
  ): Promise<RagQueryResult> {
    const { rerankLimit, enableReranking, minSimilarity, startTime } = options;

    console.log(`📊 [RAG QUERY] Using TURSO results - Found ${tursoResults.length} chunks`);

    // Filter by similarity threshold
    const topChunks = tursoResults.filter(chunk => chunk.similarity > minSimilarity);
    console.log(
      `📊 [RAG QUERY] Filtered to ${topChunks.length} chunks with similarity > ${minSimilarity}`,
    );

    let finalChunks: RagChunk[] = topChunks.map(chunk => ({
      fileName: chunk.fileName,
      content: chunk.content,
      relevanceScore: chunk.similarity,
    }));

    // Apply reranking if enabled
    if (enableReranking && topChunks.length > 0) {
      console.log(`🔄 [RAG QUERY] Starting rerank with ${topChunks.length} chunks`);

      // Convert to RagChunk format for reranking
      const ragChunks = topChunks.map((chunk, index) => ({
        id: `${chunk.fileName}-${index}`,
        fileName: chunk.fileName,
        content: chunk.content,
        chunkIndex: index,
      }));

      const reRanked = await rerankChunks(query, ragChunks, rerankLimit);
      console.log(`🔄 [RAG QUERY] Re-ranked to ${reRanked.length} top chunks`);

      // Convert back to format with similarity score
      finalChunks = reRanked.map(chunk => ({
        ...chunk,
        relevanceScore: chunk.relevanceScore || 0,
      }));
    } else {
      // No reranking, just take top N
      finalChunks = finalChunks.slice(0, rerankLimit);
      console.log(`📊 [RAG QUERY] Reranking disabled, using top ${finalChunks.length} chunks`);
    }

    return {
      results: finalChunks,
      queryTime: Date.now() - startTime,
      source: 'turso',
      metadata: {
        totalCandidates: tursoResults.length,
        filteredCandidates: topChunks.length,
        finalResults: finalChunks.length,
      },
    };
  }

  /**
   * Process local IndexedDB chunks (original ChatContainer logic)
   */
  private async processLocalChunks(
    query: string,
    queryVector: number[],
    ragChunks: RagChunk[],
    options: {
      vectorSearchLimit: number;
      rerankLimit: number;
      enableReranking: boolean;
      minSimilarity: number;
      startTime: number;
    },
  ): Promise<RagQueryResult> {
    const { vectorSearchLimit, rerankLimit, enableReranking, minSimilarity, startTime } = options;

    console.log(
      `🔍 [RAG QUERY] Using INDEXEDDB fallback - Processing ${ragChunks.length} local chunks`,
    );

    // Calculate similarity scores
    const scoredChunks = ragChunks.map(chunk => ({
      ...chunk,
      relevanceScore: chunk.vector ? cosineSimilarity(queryVector, chunk.vector) : 0,
    }));

    // Sort and filter
    scoredChunks.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    const topChunks = scoredChunks.slice(0, vectorSearchLimit);
    const relevantChunks = topChunks.filter(chunk => (chunk.relevanceScore || 0) > minSimilarity);

    console.log(
      `📊 [RAG QUERY] IndexedDB filtered to ${relevantChunks.length} chunks with similarity > ${minSimilarity}`,
    );

    let finalChunks = relevantChunks;

    // Apply reranking if enabled
    if (enableReranking && relevantChunks.length > 0) {
      console.log('🔄 [RAG QUERY] Applying reranking to IndexedDB results...');
      const reRanked = await rerankChunks(
        query,
        relevantChunks.filter(c => c.vector),
        rerankLimit,
      );
      console.log(`🔄 [RAG QUERY] Re-ranked to ${reRanked.length} top chunks`);

      // Convert reRanked results back to the same format
      finalChunks = reRanked.map(chunk => ({
        ...chunk,
        relevanceScore: chunk.relevanceScore || 0,
      }));
    } else {
      // No reranking, just take top N
      finalChunks = relevantChunks.slice(0, rerankLimit);
      console.log(`📊 [RAG QUERY] Reranking disabled, using top ${finalChunks.length} chunks`);
    }

    return {
      results: finalChunks,
      queryTime: Date.now() - startTime,
      source: 'indexeddb',
      metadata: {
        totalCandidates: ragChunks.length,
        filteredCandidates: relevantChunks.length,
        finalResults: finalChunks.length,
      },
    };
  }

  /**
   * Convert RAG results to context string (shared utility)
   */
  resultsToContextString(results: RagChunk[]): string {
    if (results.length === 0) {
      return '';
    }

    const contextString = results
      .map(chunk => `From ${chunk.fileName}:\n${chunk.content}`)
      .join('\n\n---\n\n');

    console.log(
      `📝 [RAG QUERY] Final context: ${results.length} chunks, ${contextString.length} characters`,
    );
    return contextString;
  }
}

// Singleton instance
export const ragQueryService = new RagQueryService();
