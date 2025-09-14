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
 * Removes unnecessary spaces between Chinese characters while preserving
 * necessary spaces for mixed Chinese/English content
 *
 * @param text - Input text to clean
 * @returns Text with cleaned Chinese character spacing
 */
export const cleanChineseSpacing = (text: string): string => {
  if (!text) {
    return text;
  }

  // Define Chinese character ranges (CJK Unified Ideographs and extensions)
  const chineseCharPattern = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

  // Define Chinese punctuation marks
  const chinesePunctuation = /[，。！？；：""''（）【】《》]/;

  // Define English letters, numbers, and common punctuation
  const englishPattern = /[a-zA-Z0-9]/;
  const englishPunctuation = /[.!?;:,'"()[\]{}]/;

  return text.replace(/[ \t]+/g, (match, offset) => {
    // Get characters before and after the space(s)
    const before = text[offset - 1];
    const after = text[offset + 1];

    if (!before || !after) {
      // Keep spaces at the beginning or end
      return match;
    }

    // Case 1: Both characters are Chinese - remove space
    if (chineseCharPattern.test(before) && chineseCharPattern.test(after)) {
      return '';
    }

    // Case 2: Chinese character and Chinese punctuation - remove space
    if (
      (chineseCharPattern.test(before) && chinesePunctuation.test(after)) ||
      (chinesePunctuation.test(before) && chineseCharPattern.test(after))
    ) {
      return '';
    }

    // Case 3: Chinese punctuation and English - remove space
    if (
      (chinesePunctuation.test(before) && englishPattern.test(after)) ||
      (englishPattern.test(before) && chinesePunctuation.test(after))
    ) {
      return '';
    }

    // Case 4: Numbers and Chinese characters - remove space
    if (
      (englishPattern.test(before) && chineseCharPattern.test(after)) ||
      (chineseCharPattern.test(before) && englishPattern.test(after))
    ) {
      // Special handling for numbers adjacent to Chinese
      if (/\d/.test(before) || /\d/.test(after)) {
        return '';
      }
      return ' '; // Keep space for other English-Chinese boundaries
    }

    // Case 5: Multiple spaces between English words - keep single space
    if (
      (englishPattern.test(before) || englishPunctuation.test(before)) &&
      (englishPattern.test(after) || englishPunctuation.test(after))
    ) {
      return ' ';
    }

    // Default: keep single space for other cases
    return ' ';
  });
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

  // Clean Chinese spacing before processing
  const cleanedText = cleanChineseSpacing(text);

  const sentences = splitIntoSentences(cleanedText);
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
