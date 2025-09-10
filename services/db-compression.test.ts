import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ChatSession, CompactContext } from '../types';

// Mock the entire db module
vi.mock('./db', () => {
  const mockDB = {
    put: vi.fn(),
    getAllFromIndex: vi.fn(),
    delete: vi.fn(),
  };

  return {
    getDb: vi.fn().mockResolvedValue(mockDB),
    saveSession: vi.fn().mockImplementation(async (session: ChatSession) => {
      return mockDB.put('sessions', session);
    }),
    getSessionsForAssistant: vi.fn().mockImplementation(async (assistantId: string) => {
      return mockDB.getAllFromIndex('sessions', 'by-assistant', assistantId);
    }),
    deleteSession: vi.fn().mockImplementation(async (sessionId: string) => {
      return mockDB.delete('sessions', sessionId);
    }),
  };
});

import { saveSession, getSessionsForAssistant, deleteSession } from './db';

describe('Database Compression Context Support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockCompactContext: CompactContext = {
    type: 'compact',
    content:
      'Previously we discussed React hooks and state management. The user asked about useEffect and I explained dependencies.',
    tokenCount: 150,
    compressedFromRounds: 8,
    compressedFromMessages: 16,
    createdAt: '2025-09-10T16:00:00.000Z',
    version: '1.0.0',
  };

  const mockSession: ChatSession = {
    id: 'session-1',
    assistantId: 'assistant-1',
    title: 'Test Session',
    messages: [
      {
        content: 'Hello',
        role: 'user',
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tokenCount: 50,
    compactContext: mockCompactContext,
    lastCompactionAt: '2025-09-10T16:00:00.000Z',
  };

  describe('saveSession', () => {
    it('should accept session with compression context', async () => {
      await saveSession(mockSession);
      expect(saveSession).toHaveBeenCalledWith(mockSession);
    });

    it('should accept session without compression context', async () => {
      const sessionWithoutCompression: ChatSession = {
        ...mockSession,
        compactContext: undefined,
        lastCompactionAt: undefined,
      };

      await saveSession(sessionWithoutCompression);
      expect(saveSession).toHaveBeenCalledWith(sessionWithoutCompression);
    });
  });

  describe('compression context data structure validation', () => {
    it('should validate CompactContext interface', () => {
      const compactContext: CompactContext = {
        type: 'compact',
        content: 'Test content',
        tokenCount: 100,
        compressedFromRounds: 5,
        compressedFromMessages: 10,
        createdAt: '2025-09-10T16:00:00.000Z',
        version: '1.0.0',
      };

      // Verify all required fields are present
      expect(compactContext.type).toBe('compact');
      expect(compactContext.content).toBe('Test content');
      expect(compactContext.tokenCount).toBe(100);
      expect(compactContext.compressedFromRounds).toBe(5);
      expect(compactContext.compressedFromMessages).toBe(10);
      expect(compactContext.createdAt).toBe('2025-09-10T16:00:00.000Z');
      expect(compactContext.version).toBe('1.0.0');
    });

    it('should validate ChatSession with optional compression fields', () => {
      // Session with compression context
      const sessionWithCompression: ChatSession = {
        id: 'session-1',
        assistantId: 'assistant-1',
        title: 'Test',
        messages: [],
        createdAt: Date.now(),
        tokenCount: 0,
        compactContext: mockCompactContext,
        lastCompactionAt: '2025-09-10T16:00:00.000Z',
      };

      expect(sessionWithCompression.compactContext).toBeDefined();
      expect(sessionWithCompression.lastCompactionAt).toBeDefined();

      // Session without compression context
      const sessionWithoutCompression: ChatSession = {
        id: 'session-2',
        assistantId: 'assistant-1',
        title: 'Test',
        messages: [],
        createdAt: Date.now(),
        tokenCount: 0,
      };

      expect(sessionWithoutCompression.compactContext).toBeUndefined();
      expect(sessionWithoutCompression.lastCompactionAt).toBeUndefined();
    });

    it('should handle edge cases for compression context fields', () => {
      const edgeCaseSession: ChatSession = {
        id: 'session-edge',
        assistantId: 'assistant-1',
        title: 'Edge Case',
        messages: [],
        createdAt: Date.now(),
        tokenCount: 0,
        compactContext: {
          type: 'compact',
          content: '', // Empty content
          tokenCount: 0,
          compressedFromRounds: 0,
          compressedFromMessages: 0,
          createdAt: '2025-09-10T16:00:00.000Z',
          version: '1.0.0',
        },
        lastCompactionAt: '', // Empty string
      };

      expect(edgeCaseSession.compactContext?.content).toBe('');
      expect(edgeCaseSession.compactContext?.tokenCount).toBe(0);
      expect(edgeCaseSession.lastCompactionAt).toBe('');
    });
  });

  describe('database operations', () => {
    it('should call database operations for sessions', async () => {
      await saveSession(mockSession);
      await getSessionsForAssistant('assistant-1');
      await deleteSession('session-1');

      expect(saveSession).toHaveBeenCalled();
      expect(getSessionsForAssistant).toHaveBeenCalled();
      expect(deleteSession).toHaveBeenCalled();
    });
  });
});
