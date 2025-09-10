import { describe, it, expect } from 'vitest';
import {
  countConversationRounds,
  getLastNRounds,
  groupMessagesByRounds,
  getIncompleteRound,
  reconstructHistory,
  type ConversationRound,
} from './conversationUtils';
import { ChatMessage } from '../types';

describe('conversationUtils', () => {
  const createMessage = (role: 'user' | 'model', content: string): ChatMessage => ({
    role,
    content,
  });

  describe('countConversationRounds', () => {
    it('should return 0 for empty array', () => {
      expect(countConversationRounds([])).toBe(0);
    });

    it('should count complete rounds correctly', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi there!'),
        createMessage('user', 'How are you?'),
        createMessage('model', 'I am fine!'),
      ];
      expect(countConversationRounds(messages)).toBe(2);
    });

    it('should not count incomplete rounds', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi there!'),
        createMessage('user', 'How are you?'), // 沒有AI回覆
      ];
      expect(countConversationRounds(messages)).toBe(1);
    });

    it('should handle single user message', () => {
      const messages = [createMessage('user', 'Hello')];
      expect(countConversationRounds(messages)).toBe(0);
    });

    it('should handle single model message', () => {
      const messages = [createMessage('model', 'Hi there!')];
      expect(countConversationRounds(messages)).toBe(0);
    });

    it('should handle consecutive user messages', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('user', 'Are you there?'),
        createMessage('model', 'Yes, I am here!'),
      ];
      expect(countConversationRounds(messages)).toBe(1);
    });

    it('should handle consecutive model messages', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi!'),
        createMessage('model', 'How can I help?'),
        createMessage('user', 'Thanks'),
        createMessage('model', 'You are welcome!'),
      ];
      expect(countConversationRounds(messages)).toBe(2);
    });
  });

  describe('getLastNRounds', () => {
    const messages = [
      createMessage('user', 'Hello'),
      createMessage('model', 'Hi!'),
      createMessage('user', 'How are you?'),
      createMessage('model', 'Good!'),
      createMessage('user', 'Nice weather'),
      createMessage('model', 'Indeed!'),
    ];

    it('should return empty array for rounds <= 0', () => {
      expect(getLastNRounds(messages, 0)).toEqual([]);
      expect(getLastNRounds(messages, -1)).toEqual([]);
    });

    it('should return empty array for empty messages', () => {
      expect(getLastNRounds([], 2)).toEqual([]);
    });

    it('should return last N rounds correctly', () => {
      const result = getLastNRounds(messages, 1);
      expect(result).toEqual([
        createMessage('user', 'Nice weather'),
        createMessage('model', 'Indeed!'),
      ]);
    });

    it('should return all rounds if N is larger than available', () => {
      const result = getLastNRounds(messages, 10);
      expect(result).toEqual(messages);
    });

    it('should return last 2 rounds correctly', () => {
      const result = getLastNRounds(messages, 2);
      expect(result).toEqual([
        createMessage('user', 'How are you?'),
        createMessage('model', 'Good!'),
        createMessage('user', 'Nice weather'),
        createMessage('model', 'Indeed!'),
      ]);
    });
  });

  describe('groupMessagesByRounds', () => {
    it('should return empty array for empty input', () => {
      expect(groupMessagesByRounds([])).toEqual([]);
    });

    it('should group complete rounds correctly', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi!'),
        createMessage('user', 'Bye'),
        createMessage('model', 'Goodbye!'),
      ];

      const result = groupMessagesByRounds(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        userMessage: createMessage('user', 'Hello'),
        assistantMessage: createMessage('model', 'Hi!'),
        roundNumber: 1,
      });
      expect(result[1]).toEqual({
        userMessage: createMessage('user', 'Bye'),
        assistantMessage: createMessage('model', 'Goodbye!'),
        roundNumber: 2,
      });
    });

    it('should ignore incomplete rounds', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi!'),
        createMessage('user', 'How are you?'), // 沒有AI回覆
      ];

      const result = groupMessagesByRounds(messages);
      expect(result).toHaveLength(1);
      expect(result[0].userMessage.content).toBe('Hello');
    });

    it('should handle consecutive user messages', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('user', 'Are you there?'), // 第二個user訊息會被跳過
        createMessage('model', 'Yes!'),
      ];

      const result = groupMessagesByRounds(messages);
      expect(result).toHaveLength(1);
      expect(result[0].userMessage.content).toBe('Hello');
      expect(result[0].assistantMessage.content).toBe('Yes!');
    });
  });

  describe('getIncompleteRound', () => {
    it('should return null for empty array', () => {
      expect(getIncompleteRound([])).toBeNull();
    });

    it('should return null for complete conversation', () => {
      const messages = [createMessage('user', 'Hello'), createMessage('model', 'Hi!')];
      expect(getIncompleteRound(messages)).toBeNull();
    });

    it('should return incomplete user message', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi!'),
        createMessage('user', 'How are you?'),
      ];

      const result = getIncompleteRound(messages);
      expect(result).toEqual(createMessage('user', 'How are you?'));
    });

    it('should return null if last message is from model', () => {
      const messages = [createMessage('user', 'Hello'), createMessage('model', 'Hi there!')];
      expect(getIncompleteRound(messages)).toBeNull();
    });
  });

  describe('reconstructHistory', () => {
    const rounds: ConversationRound[] = [
      {
        userMessage: createMessage('user', 'Hello'),
        assistantMessage: createMessage('model', 'Hi!'),
        roundNumber: 1,
      },
      {
        userMessage: createMessage('user', 'Bye'),
        assistantMessage: createMessage('model', 'Goodbye!'),
        roundNumber: 2,
      },
    ];

    it('should reconstruct history with only recent rounds', () => {
      const result = reconstructHistory(null, rounds);

      expect(result).toEqual([
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi!'),
        createMessage('user', 'Bye'),
        createMessage('model', 'Goodbye!'),
      ]);
    });

    it('should include compact context', () => {
      const compactContext = 'Previous conversation summary...';
      const result = reconstructHistory(compactContext, rounds);

      expect(result[0]).toEqual({
        role: 'system',
        content: '[COMPRESSED_CONTEXT] Previous conversation summary...',
      });
      expect(result).toHaveLength(5); // 1 system + 4 regular messages
    });

    it('should include incomplete message', () => {
      const incompleteMessage = createMessage('user', 'How are you?');
      const result = reconstructHistory(null, rounds, incompleteMessage);

      expect(result).toHaveLength(5);
      expect(result[4]).toEqual(incompleteMessage);
    });

    it('should handle all components together', () => {
      const compactContext = 'Summary...';
      const incompleteMessage = createMessage('user', 'New question');
      const result = reconstructHistory(compactContext, rounds, incompleteMessage);

      expect(result).toHaveLength(6);
      expect(result[0].role).toBe('system');
      expect(result[5]).toEqual(incompleteMessage);
    });

    it('should handle empty rounds', () => {
      const result = reconstructHistory('Summary...', []);

      expect(result).toEqual([
        {
          role: 'system',
          content: '[COMPRESSED_CONTEXT] Summary...',
        },
      ]);
    });
  });
});
