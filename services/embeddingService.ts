import { pipeline, env, FeatureExtractionPipeline } from '@huggingface/transformers';

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
    progress_callback?: (progress: unknown) => void
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
          `Failed to initialize embedding model. WebGPU error: ${webgpuError}. CPU error: ${cpuError}`
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
  progress_callback?: (progress: unknown) => void
): Promise<number[]> => {
  // Get the singleton instance of the pipeline
  const extractor = await EmbeddingSingleton.getInstance(progress_callback);

  const prefixedText = prefixes[type] + text;

  // Generate embedding using the pipeline.
  // The pipeline handles tokenization, model inference, pooling, and normalization internally.
  const output = await extractor(prefixedText, { pooling: 'mean', normalize: true });

  return Array.from(output.data);
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
