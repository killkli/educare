import { GoogleGenAI, Chat, GenerateContentResponse } from '@google/genai';
import { ChatMessage } from '../types';
import { ApiKeyManager } from './apiKeyManager';
import { getLastNRounds, getIncompleteRound } from './conversationUtils';

let ai: GoogleGenAI | null = null;
let initializationAttempted = false;

/**
 * 懶惰初始化並返回 GoogleGenAI 客戶端實例。
 * 優先使用用戶設定的 API KEY，其次使用內建的。
 * 如果初始化失敗（例如缺少 API 金鑰），返回 null。
 */
const getAi = (): GoogleGenAI | null => {
  if (!initializationAttempted) {
    initializationAttempted = true;
    // 優先使用用戶設定的 API KEY
    const userApiKey = ApiKeyManager.getGeminiApiKey();
    // 其次使用內建的 API KEY（應該是空的）
    const builtInApiKey =
      typeof process !== 'undefined' && process.env ? process.env.API_KEY : undefined;
    const apiKey = userApiKey || builtInApiKey;

    if (apiKey) {
      ai = new GoogleGenAI({ apiKey });
    } else {
      console.warn('No Gemini API key available. Please configure one in settings.');
    }
  }
  return ai;
};

/**
 * 檢查是否可以使用 Gemini 服務
 */
export const isGeminiAvailable = (): boolean => {
  return (
    ApiKeyManager.hasGeminiApiKey() || !!(typeof process !== 'undefined' && process.env?.API_KEY)
  );
};

/**
 * 重新初始化 Gemini 服務（當用戶更新 API KEY 時使用）
 */
export const reinitializeGemini = (): void => {
  ai = null;
  initializationAttempted = false;
};

export const streamChat = async ({
  systemPrompt,
  ragContext,
  history,
  message,
  onChunk,
  onComplete,
}: {
  systemPrompt: string;
  ragContext?: string;
  history: ChatMessage[];
  message: string;
  onChunk: (text: string) => void;
  onComplete: (
    metadata: { promptTokenCount: number; candidatesTokenCount: number },
    fullText: string,
  ) => void;
}) => {
  const genAI = getAi();

  if (!genAI) {
    throw new Error('請先在設定中配置 Gemini API KEY 才能使用聊天功能。');
  }

  // 再次檢查是否有可用的 API KEY
  if (!isGeminiAvailable()) {
    throw new Error('請先在設定中配置 Gemini API KEY 才能使用聊天功能。');
  }

  // 使用對話輪次邏輯取代原來的訊息數量限制
  const MAX_HISTORY_ROUNDS = 10;

  // 獲取最後 N 輪完整對話
  const recentRounds = getLastNRounds(history, MAX_HISTORY_ROUNDS);

  // 檢查是否有未完成的對話 (使用者訊息但沒有AI回覆)
  const incompleteMessage = getIncompleteRound(history);

  // 建構最終的歷史記錄
  let truncatedHistory = recentRounds;
  if (incompleteMessage) {
    truncatedHistory = [...recentRounds, incompleteMessage];
  }

  let finalSystemPrompt = systemPrompt;
  if (ragContext) {
    const ragPreamble = `Use the information from the following context to inform your response to the user's question. Provide a natural, conversational answer as if the information is part of your general knowledge, without mentioning the context or documents directly. If the answer is not found in the provided information, state that you don't have the relevant information to answer the question. <context> ${ragContext} </context>`;
    finalSystemPrompt = `${systemPrompt}\n\n${ragPreamble}`;
  }

  const chat: Chat = genAI.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: finalSystemPrompt,
    },
    history: truncatedHistory.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }],
    })),
  });

  const stream = await chat.sendMessageStream({ message: message });

  let aggregatedResponse: GenerateContentResponse | null = null;
  let fullResponseText = '';

  for await (const chunk of stream) {
    const chunkText = chunk.text;
    if (chunkText) {
      onChunk(chunkText);
      fullResponseText += chunkText;
    }
    aggregatedResponse = chunk;
  }

  if (aggregatedResponse && aggregatedResponse.usageMetadata) {
    onComplete(
      {
        promptTokenCount: aggregatedResponse.usageMetadata.promptTokenCount ?? 0,
        candidatesTokenCount: aggregatedResponse.usageMetadata.candidatesTokenCount ?? 0,
      },
      fullResponseText,
    );
  } else {
    onComplete({ promptTokenCount: 0, candidatesTokenCount: 0 }, fullResponseText);
  }
};
