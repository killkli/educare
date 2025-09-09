import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamChat, reinitializeGemini } from './geminiService';
import { ChatMessage } from '../types';
import { ApiKeyManager } from './apiKeyManager';

vi.mock('./apiKeyManager');

// Mock Google GenAI
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(() => ({
    chat: vi.fn(() => ({
      sendMessageStream: vi.fn(),
    })),
  })),
}));

describe('Gemini Service', () => {
  const mockMessages: ChatMessage[] = [
    {
      role: 'user',
      content: 'Hello',
    },
    {
      role: 'model',
      content: 'Hi there!',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ApiKeyManager.getGeminiApiKey).mockReturnValue('test-api-key');
    vi.mocked(ApiKeyManager.hasGeminiApiKey).mockReturnValue(true);
    reinitializeGemini();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('streamChat', () => {
    it.skip('should stream response from Gemini API', async () => {
      const mockStream = async function* () {
        yield { text: () => 'Hello' };
        yield { text: () => ' world' };
      };
      const { GoogleGenAI } = await import('@google/genai');
      const mockChat = {
        sendMessageStream: vi.fn().mockResolvedValue(mockStream()),
      };
      vi.mocked(GoogleGenAI).mockReturnValue({
        _apiKey: 'test-api-key',
        chats: {
          create: vi.fn().mockReturnValue(mockChat),
        },
      } as unknown as InstanceType<typeof GoogleGenAI>);

      const chunks: string[] = [];
      const onChunk = vi.fn((chunk: string) => chunks.push(chunk));

      await streamChat({
        systemPrompt: 'Test prompt',
        ragContext: '',
        history: mockMessages,
        message: 'Test message',
        onChunk,
        onComplete: vi.fn(),
      });

      expect(mockChat.sendMessageStream).toHaveBeenCalled();
      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('should handle API errors gracefully', async () => {
      const { GoogleGenAI } = await import('@google/genai');
      const mockChat = {
        sendMessageStream: vi.fn().mockRejectedValue(new Error('API Error')),
      };
      vi.mocked(GoogleGenAI).mockReturnValue({
        chats: {
          create: vi.fn().mockReturnValue(mockChat),
        },
      } as unknown as InstanceType<typeof GoogleGenAI>);

      const onChunk = vi.fn();

      await expect(
        streamChat({
          systemPrompt: 'Test prompt',
          ragContext: '',
          history: mockMessages,
          message: 'Test message',
          onChunk,
          onComplete: vi.fn(),
        }),
      ).rejects.toThrow('API Error');
    });
  });
});
