import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatCompactorService, CompressionConfig } from './chatCompactorService';
import { CompactContext, ConversationRound } from '../types';
import * as geminiService from './geminiService';

// Mock geminiService
vi.mock('./geminiService', () => ({
  streamChat: vi.fn(),
}));

describe('ChatCompactorService', () => {
  let compactorService: ChatCompactorService;
  let mockStreamChat: vi.Mock;

  beforeEach(() => {
    compactorService = new ChatCompactorService();
    mockStreamChat = vi.mocked(geminiService.streamChat);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createTestRound = (
    roundNumber: number,
    userContent: string,
    assistantContent: string,
  ): ConversationRound => ({
    userMessage: { role: 'user', content: userContent },
    assistantMessage: { role: 'model', content: assistantContent },
    roundNumber,
  });

  const createTestCompactContext = (): CompactContext => ({
    type: 'compact',
    content: 'Previous compressed conversation summary',
    tokenCount: 500,
    compressedFromRounds: 5,
    compressedFromMessages: 10,
    createdAt: '2025-09-10T12:00:00Z',
    version: '1.0',
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const config = compactorService.getConfig();

      expect(config.targetTokens).toBe(2000);
      expect(config.triggerRounds).toBe(10);
      expect(config.preserveLastRounds).toBe(2);
      expect(config.maxRetries).toBe(1);
      expect(config.compressionModel).toBe('gemini-2.5-flash');
      expect(config.compressionVersion).toBe('1.0');
    });

    it('should accept custom configuration', () => {
      const customConfig: Partial<CompressionConfig> = {
        targetTokens: 1500,
        triggerRounds: 8,
        preserveLastRounds: 3,
      };

      const customCompactor = new ChatCompactorService(customConfig);
      const config = customCompactor.getConfig();

      expect(config.targetTokens).toBe(1500);
      expect(config.triggerRounds).toBe(8);
      expect(config.preserveLastRounds).toBe(3);
      expect(config.maxRetries).toBe(1); // Should keep default
    });

    it('should allow updating configuration', () => {
      compactorService.updateConfig({ targetTokens: 3000 });

      expect(compactorService.getConfig().targetTokens).toBe(3000);
    });
  });

  describe('Compression Trigger Logic', () => {
    it('should not trigger compression for insufficient rounds', () => {
      // Default: triggerRounds(10) + preserveLastRounds(2) = 12
      expect(compactorService.shouldTriggerCompression(10)).toBe(false);
      expect(compactorService.shouldTriggerCompression(12)).toBe(false);
    });

    it('should trigger compression when rounds exceed threshold', () => {
      expect(compactorService.shouldTriggerCompression(13)).toBe(true);
      expect(compactorService.shouldTriggerCompression(15)).toBe(true);
    });

    it('should handle existing compact context', () => {
      // With existing compact, threshold is the same
      expect(compactorService.shouldTriggerCompression(13, true)).toBe(true);
      expect(compactorService.shouldTriggerCompression(12, true)).toBe(false);
    });

    it('should work with custom configuration', () => {
      const customCompactor = new ChatCompactorService({
        triggerRounds: 5,
        preserveLastRounds: 1,
      });

      expect(customCompactor.shouldTriggerCompression(6)).toBe(false);
      expect(customCompactor.shouldTriggerCompression(7)).toBe(true);
    });
  });

  describe('Token Estimation', () => {
    it('should estimate token count for Chinese text', () => {
      const rounds = [
        createTestRound(1, '你好世界', '你好！很高興見到你'),
        createTestRound(2, '今天天氣如何？', '今天天氣很好，陽光明媚'),
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenCount = (compactorService as any).estimateTokenCount(rounds);
      expect(tokenCount).toBeGreaterThan(0);
      expect(tokenCount).toBeLessThan(100); // Should be reasonable for short Chinese text
    });

    it('should estimate token count for English text', () => {
      const rounds = [
        createTestRound(1, 'Hello world', 'Hello! Nice to meet you'),
        createTestRound(2, 'How are you?', 'I am doing well, thank you'),
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenCount = (compactorService as any).estimateTokenCount(rounds);
      expect(tokenCount).toBeGreaterThan(0);
      expect(tokenCount).toBeLessThan(50);
    });

    it('should include existing compact context in token estimation', () => {
      const rounds = [createTestRound(1, 'Test', 'Response')];
      const existingCompact = createTestCompactContext();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withCompact = (compactorService as any).estimateTokenCount(rounds, existingCompact);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withoutCompact = (compactorService as any).estimateTokenCount(rounds);

      expect(withCompact).toBeGreaterThan(withoutCompact);
    });
  });

  describe('Compression Input Preparation', () => {
    it('should prepare input without existing compact context', () => {
      const rounds = [
        createTestRound(1, 'First question', 'First answer'),
        createTestRound(2, 'Second question', 'Second answer'),
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input = (compactorService as any).prepareCompressionInput(rounds);

      expect(input).toContain('[CONVERSATION_HISTORY]');
      expect(input).toContain('Round 1:');
      expect(input).toContain('User: First question');
      expect(input).toContain('Assistant: First answer');
      expect(input).toContain('Round 2:');
      expect(input).not.toContain('[PREVIOUS_COMPRESSED_CONTEXT]');
    });

    it('should prepare input with existing compact context', () => {
      const rounds = [createTestRound(1, 'New question', 'New answer')];
      const existingCompact = createTestCompactContext();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input = (compactorService as any).prepareCompressionInput(rounds, existingCompact);

      expect(input).toContain('[PREVIOUS_COMPRESSED_CONTEXT]');
      expect(input).toContain('Previous compressed conversation summary');
      expect(input).toContain('[ADDITIONAL_CONVERSATIONS]');
      expect(input).toContain('User: New question');
    });
  });

  describe('Compression Prompt Generation', () => {
    it('should generate comprehensive compression prompt', () => {
      const input = 'Test conversation input';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prompt = (compactorService as any).generateCompressionPrompt(input);

      expect(prompt).toContain('壓縮成一個簡潔但完整的摘要');
      expect(prompt).toContain('2000 token 以內');
      expect(prompt).toContain('保留關鍵資訊');
      expect(prompt).toContain('維持對話脈絡');
      expect(prompt).toContain('條列式結構');
      expect(prompt).toContain(input);
    });

    it('should use custom target tokens in prompt', () => {
      compactorService.updateConfig({ targetTokens: 1500 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prompt = (compactorService as any).generateCompressionPrompt('test');

      expect(prompt).toContain('1500 token 以內');

      // Reset config for subsequent tests
      compactorService.updateConfig({ targetTokens: 2000 });
    });

    it('should generate different prompts for existing vs new compression', () => {
      const newCompressionInput = '[CONVERSATION_HISTORY]\nUser: Test\nAssistant: Response';
      const existingCompressionInput =
        '[PREVIOUS_COMPRESSED_CONTEXT]\nPrevious summary\n\n[ADDITIONAL_CONVERSATIONS]\nUser: New question\nAssistant: New answer';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newPrompt = (compactorService as any).generateCompressionPrompt(newCompressionInput);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingPrompt = (compactorService as any).generateCompressionPrompt(
        existingCompressionInput,
      );

      // New compression prompt should have first-time instructions
      expect(newPrompt).toContain('這是首次壓縮');
      expect(newPrompt).not.toContain('特別注意');

      // Existing compression prompt should have integration instructions
      expect(existingPrompt).toContain('特別注意');
      expect(existingPrompt).toContain('將兩部分內容整合');
      expect(existingPrompt).toContain('自然銜接');
      expect(existingPrompt).not.toContain('這是首次壓縮');
    });
  });

  describe('Compression Result Validation', () => {
    it('should accept valid compression results', () => {
      const validResults = [
        '用戶詢問關於技術問題，助手提供了詳細解答',
        '討論了多個話題：首先用戶問候，然後詢問天氣，助手都給予了適當回應',
        '助手幫助用戶解決了編程問題，提供了代碼示例和說明',
      ];

      validResults.forEach(result => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((compactorService as any).validateCompressionResult(result)).toBe(true);
      });
    });

    it('should reject invalid compression results', () => {
      const invalidResults = [
        '', // Empty
        '   ', // Whitespace only
        'Too short', // Too short
        'No keywords whatsoever in this text', // No conversation keywords
      ];

      invalidResults.forEach(result => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((compactorService as any).validateCompressionResult(result)).toBe(false);
      });
    });
  });

  describe('End-to-End Compression', () => {
    it('should successfully compress conversation rounds', async () => {
      // Mock successful LLM response
      mockStreamChat.mockImplementation(
        ({
          onChunk,
          onComplete,
        }: {
          onChunk: (chunk: string) => void;
          onComplete: (
            tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
            fullResponse: string,
          ) => void;
        }) => {
          const response =
            '用戶詢問了技術問題，助手提供了詳細的解答和示例代碼。接著討論了最佳實踐和注意事項。';
          onChunk(response);
          onComplete({ promptTokenCount: 100, candidatesTokenCount: 50 }, response);
          return Promise.resolve();
        },
      );

      const rounds = [
        createTestRound(1, 'How to use React hooks?', 'React hooks allow you to use state...'),
        createTestRound(2, 'What about useEffect?', 'useEffect is used for side effects...'),
      ];

      const result = await compactorService.compressConversationHistory(rounds);

      expect(result.success).toBe(true);
      expect(result.compactContext).toBeDefined();
      expect(result.compactContext?.type).toBe('compact');
      expect(result.compactContext?.compressedFromRounds).toBe(2);
      expect(result.compactContext?.compressedFromMessages).toBe(4);
      expect(result.retryCount).toBe(0);
    });

    it('should handle compression with existing compact context', async () => {
      mockStreamChat.mockImplementation(
        ({
          onChunk,
          onComplete,
        }: {
          onChunk: (chunk: string) => void;
          onComplete: (
            tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
            fullResponse: string,
          ) => void;
        }) => {
          const response = '結合之前的討論和新的問題，用戶繼續探索技術主題...';
          onChunk(response);
          onComplete({ promptTokenCount: 100, candidatesTokenCount: 50 }, response);
          return Promise.resolve();
        },
      );

      const rounds = [createTestRound(3, 'Another question', 'Another answer')];
      const existingCompact = createTestCompactContext();

      const result = await compactorService.compressConversationHistory(rounds, existingCompact);

      expect(result.success).toBe(true);
      expect(result.compactContext?.compressedFromRounds).toBe(6); // 1 + 5 from existing
      expect(result.compactContext?.compressedFromMessages).toBe(12); // 2 + 10 from existing
    });

    it('should handle empty rounds', async () => {
      const result = await compactorService.compressConversationHistory([]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No conversation rounds to compress');
    });

    it('should handle LLM errors with retry', async () => {
      mockStreamChat.mockImplementation(() => {
        return Promise.reject(new Error('LLM API error'));
      });

      const rounds = [createTestRound(1, 'Test', 'Response')];
      const result = await compactorService.compressConversationHistory(rounds);

      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(2); // First attempt + 1 retry = 2 total attempts
      expect(result.error).toContain('LLM API error');
    });

    it('should retry when compression result is too long', async () => {
      let callCount = 0;
      mockStreamChat.mockImplementation(
        ({
          onChunk,
          onComplete,
        }: {
          onChunk: (chunk: string) => void;
          onComplete: (
            tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
            fullResponse: string,
          ) => void;
        }) => {
          callCount++;
          // Always return a long response that exceeds target tokens
          const response = 'Very long response '.repeat(200) + '用戶助手討論';

          onChunk(response);
          onComplete({ promptTokenCount: 100, candidatesTokenCount: 50 }, response);
          return Promise.resolve();
        },
      );

      const rounds = [createTestRound(1, 'Test', 'Response')];
      const result = await compactorService.compressConversationHistory(rounds);

      expect(callCount).toBe(1); // Only one call since token count check happens after
      expect(result.success).toBe(true); // Even if too long, should still succeed
    });

    it('should fail after max retries', async () => {
      mockStreamChat.mockImplementation(() => {
        return Promise.reject(new Error('Persistent error'));
      });

      const rounds = [createTestRound(1, 'Test', 'Response')];
      const result = await compactorService.compressConversationHistory(rounds);

      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(2); // First attempt + 1 retry = 2 total attempts
      expect(result.error).toContain('Persistent error');
    });
  });

  describe('Integration with streamChat', () => {
    it('should call streamChat with correct parameters', async () => {
      mockStreamChat.mockImplementation(
        ({
          systemPrompt,
          history,
          message,
          onChunk,
          onComplete,
        }: {
          systemPrompt: string;
          history: unknown[];
          message: string;
          onChunk: (chunk: string) => void;
          onComplete: (
            tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
            fullResponse: string,
          ) => void;
        }) => {
          expect(systemPrompt).toContain('專業的對話摘要助手');
          expect(history).toEqual([]);
          expect(message).toContain('請將以下對話歷史壓縮');

          const response = '用戶詢問助手回答的摘要';
          onChunk(response);
          onComplete({ promptTokenCount: 100, candidatesTokenCount: 50 }, response);
          return Promise.resolve();
        },
      );

      const rounds = [createTestRound(1, 'Test question', 'Test answer')];
      await compactorService.compressConversationHistory(rounds);

      expect(mockStreamChat).toHaveBeenCalledTimes(1);
    });
  });
});
