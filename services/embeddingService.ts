import {
  pipeline,
  env,
  FeatureExtractionPipeline,
  AutoTokenizer,
  XLMRobertaModel,
} from '@huggingface/transformers';
import { RagChunk } from '../types';

// Skip local model check to use CDN-hosted models
env.allowLocalModels = false;

// Define the prefixes as recommended for the embedding model
const prefixes = {
  query: 'task: search result | query: ',
  document: 'title: none | text: ',
};

// FIX: Refactored to use the transformers.js pipeline API.
// This is a more robust, higher-level abstraction for feature extraction (embeddings)
// and resolves the TypeScript errors related to call signatures and invalid options
// in the low-level AutoModel/AutoTokenizer API.
class EmbeddingSingleton {
  static model_id = 'onnx-community/embeddinggemma-300m-ONNX';
  // FIX: Use the specific FeatureExtractionPipeline type for the singleton instance.
  // This resolves the type assignment error from the pipeline() function and the "union type too complex" error.
  static instance: Promise<FeatureExtractionPipeline> | null = null;

  static async getInstance(progress_callback?: (progress: unknown) => void) {
    if (this.instance === null) {
      // First try WebGPU with quantization, fallback to CPU with quantization if WebGPU fails
      this.instance = this.createPipelineWithFallback(progress_callback);
    }
    return this.instance;
  }

  private static async createPipelineWithFallback(
    progress_callback?: (progress: unknown) => void,
  ): Promise<FeatureExtractionPipeline> {
    // Try WebGPU first with q4 quantization
    try {
      console.log('🚀 Attempting to initialize embedding model with WebGPU...');
      const webgpuPipeline = await pipeline('feature-extraction', this.model_id, {
        progress_callback,
        device: 'webgpu',
        dtype: 'q4' as 'fp32' | 'fp16' | 'q8' | 'q4' | 'bnb4' | 'q4f16', // Force q4 quantization
      });
      console.log('✅ WebGPU embedding model initialized successfully');
      return webgpuPipeline;
    } catch (webgpuError) {
      console.warn('⚠️ WebGPU initialization failed, falling back to CPU:', webgpuError);

      // Fallback to default device (CPU) with q4 quantization
      try {
        console.log('🔄 Initializing embedding model with CPU fallback...');
        const cpuPipeline = await pipeline('feature-extraction', this.model_id, {
          progress_callback,
          // No device specified = default CPU device
          dtype: 'q4' as 'fp32' | 'fp16' | 'q8' | 'q4' | 'bnb4' | 'q4f16', // Use q4 quantization for better performance
        });
        console.log('✅ CPU embedding model initialized successfully');
        return cpuPipeline;
      } catch (cpuError) {
        console.error('❌ Both WebGPU and CPU initialization failed:', cpuError);
        throw new Error(
          `Failed to initialize embedding model. WebGPU error: ${webgpuError}. CPU error: ${cpuError}`,
        );
      }
    }
  }
}

/**
 * Generates a vector embedding for a given text string.
 * @param text The text to embed.
 * @param type The type of text, which determines the prefix to use.
 * @param progress_callback Optional callback to report model loading progress.
 * @returns A promise that resolves to an array of numbers representing the embedding.
 */
export const generateEmbedding = async (
  text: string,
  type: 'query' | 'document',
  progress_callback?: (progress: unknown) => void,
): Promise<number[]> => {
  // Get the singleton instance of the pipeline
  const extractor = await EmbeddingSingleton.getInstance(progress_callback);

  const prefixedText = prefixes[type] + text;

  // Generate embedding using the pipeline.
  // The pipeline handles tokenization, model inference, pooling, and normalization internally.
  const output = await extractor(prefixedText, { pooling: 'mean', normalize: true });

  return Array.from(output.data);
};

/**
 * Preloads the embedding model without generating any embeddings.
 * This allows the model to be loaded in the background during app startup.
 * @param progress_callback Optional callback to report model loading progress.
 * @returns Promise that resolves when the model is loaded and ready.
 */
export const preloadEmbeddingModel = async (
  progress_callback?: (progress: unknown) => void,
): Promise<void> => {
  try {
    console.log('🔄 Starting embedding model preload...');
    await EmbeddingSingleton.getInstance(progress_callback);
    console.log('✅ Embedding model preloaded successfully');
  } catch (error) {
    console.error('❌ Failed to preload embedding model:', error);
    throw error;
  }
};

/**
 * Checks if the embedding model is already loaded and ready to use.
 * @returns True if the model is loaded, false otherwise.
 */
export const isEmbeddingModelLoaded = (): boolean => {
  return EmbeddingSingleton.instance !== null;
};

export const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

class RerankerSingleton {
  static model_id = 'jinaai/jina-reranker-v2-base-multilingual';
  static modelInstance: XLMRobertaModel | null = null;
  static tokenizerInstance: AutoTokenizer | null = null;
  static initPromise: Promise<{ model: XLMRobertaModel; tokenizer: AutoTokenizer }> | null = null;

  static async getInstance(progress_callback?: (progress: unknown) => void) {
    if (this.initPromise === null) {
      this.initPromise = this.createInstanceWithFallback(progress_callback);
    }
    return this.initPromise;
  }

  private static async createInstanceWithFallback(
    progress_callback?: (progress: unknown) => void,
  ): Promise<{ model: XLMRobertaModel; tokenizer: AutoTokenizer }> {
    try {
      console.log('🚀 Attempting to initialize re-ranker with WebGPU...');
      const model = await XLMRobertaModel.from_pretrained(this.model_id, {
        progress_callback,
        device: 'webgpu',
        dtype: 'q8' as const,
      });
      const tokenizer = await AutoTokenizer.from_pretrained(this.model_id);
      console.log('✅ WebGPU re-ranker initialized');
      this.modelInstance = model;
      this.tokenizerInstance = tokenizer;
      return { model, tokenizer };
    } catch (webgpuError) {
      console.warn('⚠️ WebGPU re-ranker failed, falling to CPU:', webgpuError);
      try {
        console.log('🔄 Initializing re-ranker with CPU...');
        const model = await XLMRobertaModel.from_pretrained(this.model_id, {
          progress_callback,
          device: 'wasm',
          dtype: 'q8' as const,
        });
        const tokenizer = await AutoTokenizer.from_pretrained(this.model_id);
        console.log('✅ CPU re-ranker initialized');
        this.modelInstance = model;
        this.tokenizerInstance = tokenizer;
        return { model, tokenizer };
      } catch (cpuError) {
        console.error('❌ Re-ranker init failed:', cpuError);
        throw new Error(`Re-ranker failed: WebGPU ${webgpuError}, CPU ${cpuError}`);
      }
    }
  }
}

export async function rerankChunks(
  query: string,
  chunks: RagChunk[],
  topK = 5,
  progress_callback?: (progress: unknown) => void,
): Promise<RagChunk[]> {
  if (chunks.length === 0) {
    return [];
  }

  const { model, tokenizer } = await RerankerSingleton.getInstance(progress_callback);

  // Extract document texts from chunks
  const documents = chunks.map(chunk => chunk.content);

  // Create query array (same query repeated for each document)
  const queries = new Array(documents.length).fill(query);

  // Tokenize with text pairs (query, document) - following jinaai_new.html pattern
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputs = (tokenizer as any)(queries, {
    text_pair: documents,
    padding: true,
    truncation: true,
  });

  // Get model predictions
  const { logits } = await model(inputs);

  // Apply sigmoid to get relevance scores
  const scores = logits.sigmoid().tolist();

  // Create scored chunks and sort by relevance score
  const scoredChunks = chunks.map((chunk, i) => ({
    ...chunk,
    relevanceScore: scores[i][0] || 0,
  }));

  // Sort by relevance score (descending) and return top-K
  return scoredChunks
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, topK);
}

export const preloadRerankerModel = async (
  progress_callback?: (progress: unknown) => void,
): Promise<void> => {
  try {
    console.log('🔄 Starting re-ranker preload...');
    await RerankerSingleton.getInstance(progress_callback);
    console.log('✅ Re-ranker preloaded');
  } catch (error) {
    console.error('❌ Re-ranker preload failed:', error);
    throw error;
  }
};
// Browser console test function for reranking
export const testRerankingInConsole = async () => {
  console.log('🧪 Testing reranking functionality...');

  // Test data
  const testQuery = '公司的年假政策是什麼？';
  const testChunks = [
    {
      id: '1',
      content: '公司年假申請流程：先填表 → 主管簽核 → HR 登錄',
      fileName: 'test.txt',
      chunkIndex: 0,
    },
    {
      id: '2',
      content: '年假是依照勞基法累積的，滿一年給 7 天',
      fileName: 'test.txt',
      chunkIndex: 1,
    },
    { id: '3', content: '公司提供免費午餐', fileName: 'test.txt', chunkIndex: 2 },
    { id: '4', content: '病假與事假需附證明文件', fileName: 'test.txt', chunkIndex: 3 },
    {
      id: '5',
      content: '加班補休的相關規定在員工手冊第 5 章',
      fileName: 'test.txt',
      chunkIndex: 4,
    },
  ];

  try {
    console.log('📝 Query:', testQuery);
    console.log(
      '📄 Test chunks:',
      testChunks.map(c => c.content),
    );

    console.log('🚀 Loading reranker model...');
    const startTime = Date.now();

    const rerankedChunks = await rerankChunks(testQuery, testChunks, 3, progress => {
      if (progress && typeof progress === 'object' && 'status' in progress) {
        console.log('📈 Loading progress:', progress);
      }
    });

    const endTime = Date.now();
    console.log(`⏱️  Reranking took ${endTime - startTime}ms`);

    console.log('🏆 Reranked results (top 3):');
    rerankedChunks.forEach((chunk, index) => {
      console.log(`${index + 1}. [Score: ${chunk.relevanceScore?.toFixed(4)}] ${chunk.content}`);
    });

    console.log('✅ Reranking test completed successfully!');
    return rerankedChunks;
  } catch (error) {
    console.error('❌ Reranking test failed:', error);
    throw error;
  }
};

// Make it available globally for console access
if (typeof window !== 'undefined') {
  (window as unknown as { testReranking: () => Promise<RagChunk[]> }).testReranking =
    testRerankingInConsole;
  console.log('🔧 Added testReranking() to window object for console testing');
}
