import { Assistant, ChatSession, RagChunk } from '../../../types';

export const createMockRagChunk = (overrides: Partial<RagChunk> = {}): RagChunk => ({
  fileName: 'test-document.pdf',
  content: 'This is test content for RAG chunk.',
  vector: [0.1, 0.2, 0.3, 0.4, 0.5],
  ...overrides,
});

export const createMockAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  id: 'test-assistant-1',
  name: 'Test Assistant',
  description: 'A helpful test assistant for unit testing',
  systemPrompt: 'You are a helpful test assistant.',
  ragChunks: [],
  createdAt: Date.now(),
  ...overrides,
});

export const createMockAssistantWithRag = (overrides: Partial<Assistant> = {}): Assistant => {
  const ragChunks = [
    createMockRagChunk({ fileName: 'document1.pdf' }),
    createMockRagChunk({
      fileName: 'document2.docx',
      content: 'Different content for second chunk',
    }),
  ];

  return createMockAssistant({
    ragChunks,
    ...overrides,
  });
};

export const createMockChatSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: 'test-session-1',
  assistantId: 'test-assistant-1',
  title: 'Test Chat Session',
  messages: [],
  createdAt: Date.now(),
  tokenCount: 0,
  ...overrides,
});

export const createMockChatSessionWithMessages = (
  overrides: Partial<ChatSession> = {},
): ChatSession => ({
  ...createMockChatSession(),
  messages: [
    {
      role: 'user',
      content: 'Hello, test assistant!',
    },
    {
      role: 'model',
      content: 'Hello! How can I help you today?',
    },
  ],
  title: 'Test Chat with Messages',
  tokenCount: 25,
  ...overrides,
});

export const TEST_ASSISTANTS = {
  basic: createMockAssistant({
    id: 'edit-test-assistant-1', // Match test's expected ID for Basic Assistant
    name: 'Basic Assistant',
    description: 'A simple test assistant',
  }),
  withRag: createMockAssistantWithRag({
    name: 'RAG Assistant',
    description: 'An assistant with knowledge documents',
  }),
  shared: createMockAssistant({
    name: 'Shared Assistant',
    description: 'A publicly shared assistant',
    isShared: true,
  }),
};

export const TEST_SESSIONS = {
  empty: createMockChatSession({
    title: 'New Chat',
  }),
  withMessages: createMockChatSessionWithMessages({
    title: 'Active Chat',
  }),
  old: createMockChatSession({
    title: 'Old Chat',
    createdAt: Date.now() - 86400000, // 1 day ago
  }),
};
