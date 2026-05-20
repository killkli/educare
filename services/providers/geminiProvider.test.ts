import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from './geminiProvider';
import { ApiKeyManager } from '../apiKeyManager';

describe('GeminiProvider', () => {
  const originalProcess = globalThis.process;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.process = {
      env: {},
    } as typeof process;
  });

  afterEach(() => {
    globalThis.process = originalProcess;
    vi.restoreAllMocks();
  });

  it('awaits lazy initialization before creating a chat stream', async () => {
    const provider = new GeminiProvider();

    vi.spyOn(ApiKeyManager, 'getGeminiApiKey').mockImplementation(() => 'AIzaSy123456789012345678901234567890123');
    vi.spyOn(ApiKeyManager, 'hasGeminiApiKey').mockReturnValue(true);

    const fakeStream = (async function* () {
      yield { text: 'hello', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    })();

    const sendMessageStream = vi.fn().mockResolvedValue(fakeStream);
    const create = vi.fn().mockReturnValue({
      sendMessageStream,
    });

    const chats = {
      create,
    };

    const aiConstructor = vi.fn().mockImplementation(() => ({
      chats,
    }));

    const initializeSpy = vi
      .spyOn(provider, 'initialize')
      .mockImplementation(async config => {
        await Promise.resolve();
        Object.assign(provider as object, {
          config,
          initializationAttempted: true,
          initializationPromise: Promise.resolve(),
          ai: { chats },
        });
      });

    const responses = [];
    for await (const chunk of provider.streamChat({
      message: 'Hi',
      history: [],
      systemPrompt: 'You are helpful.',
      model: 'gemini-2.5-flash',
    })) {
      responses.push(chunk);
    }

    expect(initializeSpy).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(sendMessageStream).toHaveBeenCalledWith({ message: 'Hi' });
    expect(responses[0]?.text).toBe('hello');
    expect(responses.at(-1)?.isComplete).toBe(true);
    expect(aiConstructor).not.toHaveBeenCalled();
  });
});
