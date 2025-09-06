import { pipeline, env, FeatureExtractionPipeline } from '@huggingface/transformers';

// Skip local model check to use CDN-hosted models
env.allowLocalModels = false;

// Define the prefixes as recommended for the embedding model
const prefixes = {
  query: "task: search result | query: ",
  document: "title: none | text: ",
};

// FIX: Refactored to use the transformers.js pipeline API.
// This is a more robust, higher-level abstraction for feature extraction (embeddings)
// and resolves the TypeScript errors related to call signatures and invalid options
// in the low-level AutoModel/AutoTokenizer API.
class EmbeddingSingleton {
  static model_id = "onnx-community/embeddinggemma-300m-ONNX";
  // FIX: Use the specific FeatureExtractionPipeline type for the singleton instance.
  // This resolves the type assignment error from the pipeline() function and the "union type too complex" error.
  static instance: Promise<FeatureExtractionPipeline> | null = null;

  static async getInstance(progress_callback?: (progress: any) => void) {
    if (this.instance === null) {
      // Use a feature-extraction pipeline for creating embeddings
      this.instance = pipeline('feature-extraction', this.model_id, {
        // FIX: Removed 'quantized: true' as it was causing a TypeScript error,
        // indicating it's not a recognized property in the current version's PretrainedModelOptions.
        progress_callback,
        device: 'webgpu',
      });
    }
    return this.instance;
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
  progress_callback?: (progress: any) => void
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
