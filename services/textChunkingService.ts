/**
 * Text Chunking Service
 *
 * Provides intelligent text chunking for mixed Chinese/English content
 * with accurate token estimation and smart overlap handling.
 */

export interface ChunkingOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

export interface ChunkingResult {
  chunks: string[];
  totalTokens: number;
  averageTokensPerChunk: number;
}

/**
 * Estimates token count for mixed Chinese/English text
 *
 * @param text - Input text to estimate tokens for
 * @returns Estimated token count
 */
export const estimateTokens = (text: string): number => {
  // Count Chinese characters (CJK Unicode ranges)
  const chineseCharCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
  // Count non-Chinese characters
  const nonChineseCharCount = text.length - chineseCharCount;

  // Chinese: ~1.5 tokens per character, English: ~4 characters per token
  return Math.ceil(chineseCharCount * 1.5 + nonChineseCharCount / 4);
};

/**
 * Splits text into sentences supporting both Chinese and English punctuation
 *
 * @param text - Input text to split
 * @returns Array of sentences
 */
export const splitIntoSentences = (text: string): string[] => {
  // Enhanced sentence splitting for Chinese and English
  return text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？\n]+(?:\n|$)/g) || [];
};

/**
 * Gets overlap text that fits within token limit by working backwards from the end
 *
 * @param text - Source text to create overlap from
 * @param maxTokens - Maximum tokens allowed in overlap
 * @returns Overlap text that fits within token limit
 */
export const getOverlapText = (text: string, maxTokens: number): string => {
  const sentences = splitIntoSentences(text);
  let overlapText = '';
  let tokenCount = 0;

  // Start from the end and work backwards
  for (let i = sentences.length - 1; i >= 0; i--) {
    const sentence = sentences[i];
    const sentenceTokens = estimateTokens(sentence);

    if (tokenCount + sentenceTokens <= maxTokens) {
      overlapText = sentence + overlapText;
      tokenCount += sentenceTokens;
    } else {
      break;
    }
  }

  return overlapText;
};

/**
 * Chunks text into segments with intelligent overlap handling
 *
 * @param text - Input text to chunk
 * @param options - Chunking configuration options
 * @returns Chunking result with chunks and metadata
 */
export const chunkText = (text: string, options: ChunkingOptions = {}): ChunkingResult => {
  const { maxTokens = 1024, overlapTokens = 102 } = options;

  const sentences = splitIntoSentences(text);
  const chunks: string[] = [];
  let currentChunk = '';
  let currentTokenCount = 0;
  let totalTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    if (sentenceTokens === 0) {
      continue;
    }

    if (currentTokenCount + sentenceTokens > maxTokens && currentTokenCount > 0) {
      const trimmedChunk = currentChunk.trim();
      chunks.push(trimmedChunk);
      totalTokens += estimateTokens(trimmedChunk);

      // Create overlap by finding the last few sentences that fit within overlap limit
      const overlapText = getOverlapText(currentChunk, overlapTokens);
      currentChunk = overlapText;
      currentTokenCount = estimateTokens(overlapText);
    }

    currentChunk += sentence;
    currentTokenCount += sentenceTokens;
  }

  if (currentTokenCount > 0) {
    const trimmedChunk = currentChunk.trim();
    chunks.push(trimmedChunk);
    totalTokens += estimateTokens(trimmedChunk);
  }

  return {
    chunks,
    totalTokens,
    averageTokensPerChunk: chunks.length > 0 ? Math.round(totalTokens / chunks.length) : 0,
  };
};

/**
 * Default chunking options for RAG applications
 */
export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  maxTokens: 1024,
  overlapTokens: 102, // ~10% overlap
};
