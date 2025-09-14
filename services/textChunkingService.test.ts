import { describe, it, expect } from 'vitest';
import {
  cleanChineseSpacing,
  estimateTokens,
  chunkText,
  DEFAULT_CHUNKING_OPTIONS,
} from './textChunkingService';

describe('cleanChineseSpacing', () => {
  it('should remove unnecessary spaces between Chinese characters', () => {
    const input = '这 是 一 个 测 试 文 本';
    const expected = '这是一个测试文本';
    expect(cleanChineseSpacing(input)).toBe(expected);
  });

  it('should preserve spaces between Chinese and English', () => {
    const input = '这是 English 文本';
    const expected = '这是 English 文本';
    expect(cleanChineseSpacing(input)).toBe(expected);
  });

  it('should remove spaces between Chinese characters and punctuation', () => {
    const input = '你好 ， 世界 ！ 这是 测试 。';
    const expected = '你好，世界！这是测试。';
    expect(cleanChineseSpacing(input)).toBe(expected);
  });

  it('should preserve spaces between English words', () => {
    const input = 'This   is   English   text';
    const expected = 'This is English text';
    expect(cleanChineseSpacing(input)).toBe(expected);
  });

  it('should handle mixed Chinese and English correctly', () => {
    const input = '我在 使用 GitHub 进行 开发';
    const expected = '我在使用 GitHub 进行开发';
    expect(cleanChineseSpacing(input)).toBe(expected);
  });

  it('should preserve line breaks and paragraph structure', () => {
    const input = '第一段 文本\n\n第二段 文本\n最后一段';
    const expected = '第一段文本\n\n第二段文本\n最后一段';
    expect(cleanChineseSpacing(input)).toBe(expected);
  });

  it('should handle empty string', () => {
    expect(cleanChineseSpacing('')).toBe('');
  });

  it('should handle PDF extraction artifacts with excessive spacing', () => {
    const input = '人 工 智 能 （ Artificial Intelligence ） 是 计 算 机 科 学 的 一 个 分 支';
    const expected = '人工智能（Artificial Intelligence）是计算机科学的一个分支';
    expect(cleanChineseSpacing(input)).toBe(expected);
  });

  it('should handle numbers mixed with Chinese', () => {
    const input = '2024 年 是 重要 的 一 年';
    const expected = '2024年是重要的一年';
    expect(cleanChineseSpacing(input)).toBe(expected);
  });
});

describe('chunkText with Chinese spacing cleanup', () => {
  it('should clean Chinese spacing before chunking', () => {
    const input =
      '这 是 一 个 很 长 的 中 文 文 本 ，需 要 进 行 分 块 处 理 。' +
      '我 们 希 望 能 够 正 确 处 理 中 文 字 符 间 的 空 白 。';

    const result = chunkText(input, { maxTokens: 50, overlapTokens: 10 });

    // Verify that the chunks don't contain excessive spaces between Chinese characters
    result.chunks.forEach(chunk => {
      expect(chunk).not.toMatch(/[\u4e00-\u9fff] [\u4e00-\u9fff]/);
    });
  });

  it('should preserve Chinese-English boundaries in chunks', () => {
    const input = '这是 AI 人工智能 技术， machine learning 机器学习 很 重要。';

    const result = chunkText(input, { maxTokens: 30, overlapTokens: 5 });

    result.chunks.forEach(chunk => {
      // Should have space between Chinese and English
      if (chunk.includes('AI')) {
        expect(chunk).toMatch(/这是 AI/);
      }
      if (chunk.includes('machine learning')) {
        expect(chunk).toMatch(/machine learning 机器学习/);
      }
    });
  });
});

describe('estimateTokens with cleaned text', () => {
  it('should provide more accurate token estimates after cleaning', () => {
    const spacedText = '这 是 一 个 测 试 文 本';
    const cleanText = '这是一个测试文本';

    const spacedTokens = estimateTokens(spacedText);
    const cleanTokens = estimateTokens(cleanText);

    // Clean text should have fewer estimated tokens due to removed spaces
    expect(cleanTokens).toBeLessThan(spacedTokens);
  });
});

describe('integration with document parsing workflow', () => {
  it('should work seamlessly with the complete text processing pipeline', () => {
    // Simulate PDF extraction with excessive spaces
    const pdfLikeText =
      '人 工 智 能 技 术 发 展 迅 速 。 Machine Learning 和 Deep Learning 是 核 心 技 术 。';

    // Process through our pipeline
    const result = chunkText(pdfLikeText, DEFAULT_CHUNKING_OPTIONS);

    // Verify chunks are properly cleaned
    result.chunks.forEach(chunk => {
      expect(chunk).not.toMatch(/[\u4e00-\u9fff] [\u4e00-\u9fff]/); // No spaces between Chinese chars
      expect(chunk).toMatch(/Machine Learning/); // English words properly spaced
      expect(chunk).toMatch(/Deep Learning/); // English words properly spaced
    });

    // Verify token estimation is more accurate
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.averageTokensPerChunk).toBeGreaterThan(0);
  });
});
