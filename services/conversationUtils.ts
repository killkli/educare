import { ChatMessage } from '../types';

/**
 * 代表一輪完整的對話 (使用者訊息 + AI回覆)
 */
export interface ConversationRound {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  roundNumber: number;
}

/**
 * 計算訊息陣列中的完整對話輪次數
 *
 * @param messages - 聊天訊息陣列
 * @returns 完整對話輪次數 (只計算有配對的使用者-AI對話)
 *
 * @example
 * // 完整的對話: user -> model -> user -> model = 2輪
 * const messages = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'model', content: 'Hi there!' },
 *   { role: 'user', content: 'How are you?' },
 *   { role: 'model', content: 'I am fine!' }
 * ];
 * countConversationRounds(messages); // 返回 2
 */
export function countConversationRounds(messages: ChatMessage[]): number {
  if (messages.length === 0) {
    return 0;
  }

  let rounds = 0;
  let expectingUserMessage = true;

  for (const message of messages) {
    if (expectingUserMessage && message.role === 'user') {
      expectingUserMessage = false; // 下一個期待 model 回覆
    } else if (!expectingUserMessage && message.role === 'model') {
      rounds++; // 完成一輪對話
      expectingUserMessage = true; // 下一個期待 user 訊息
    }
    // 如果順序不對，保持當前狀態繼續尋找正確的配對
  }

  return rounds;
}

/**
 * 獲取最後 N 輪完整對話的訊息
 *
 * @param messages - 聊天訊息陣列
 * @param rounds - 要保留的輪次數
 * @returns 最後 N 輪對話的訊息陣列
 *
 * @example
 * // 保留最後 1 輪對話
 * const messages = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'model', content: 'Hi!' },
 *   { role: 'user', content: 'Bye' },
 *   { role: 'model', content: 'Goodbye!' }
 * ];
 * getLastNRounds(messages, 1);
 * // 返回: [{ role: 'user', content: 'Bye' }, { role: 'model', content: 'Goodbye!' }]
 */
export function getLastNRounds(messages: ChatMessage[], rounds: number): ChatMessage[] {
  if (rounds <= 0 || messages.length === 0) {
    return [];
  }

  const conversationRounds = groupMessagesByRounds(messages);
  const lastRounds = conversationRounds.slice(-rounds);

  const result: ChatMessage[] = [];
  for (const round of lastRounds) {
    result.push(round.userMessage, round.assistantMessage);
  }

  return result;
}

/**
 * 將訊息陣列按對話輪次分組
 *
 * @param messages - 聊天訊息陣列
 * @returns 對話輪次陣列，每個輪次包含配對的使用者和AI訊息
 *
 * @example
 * const messages = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'model', content: 'Hi!' },
 *   { role: 'user', content: 'How are you?' },
 *   { role: 'model', content: 'Good!' }
 * ];
 * groupMessagesByRounds(messages);
 * // 返回: [
 * //   { userMessage: {...'Hello'}, assistantMessage: {...'Hi!'}, roundNumber: 1 },
 * //   { userMessage: {...'How are you?'}, assistantMessage: {...'Good!'}, roundNumber: 2 }
 * // ]
 */
export function groupMessagesByRounds(messages: ChatMessage[]): ConversationRound[] {
  if (messages.length === 0) {
    return [];
  }

  const rounds: ConversationRound[] = [];
  let currentUserMessage: ChatMessage | null = null;
  let roundNumber = 1;

  for (const message of messages) {
    if (message.role === 'user') {
      // 如果已經有未配對的用戶訊息，跳過（處理連續的user訊息）
      if (currentUserMessage === null) {
        currentUserMessage = message;
      }
    } else if (message.role === 'model' && currentUserMessage !== null) {
      // 找到配對的AI回覆，建立一輪對話
      rounds.push({
        userMessage: currentUserMessage,
        assistantMessage: message,
        roundNumber: roundNumber++,
      });
      currentUserMessage = null;
    }
  }

  return rounds;
}

/**
 * 檢查訊息陣列是否包含未完成的對話
 * (最後一條訊息是使用者訊息但沒有AI回覆)
 *
 * @param messages - 聊天訊息陣列
 * @returns 如果有未完成的對話返回該使用者訊息，否則返回 null
 */
export function getIncompleteRound(messages: ChatMessage[]): ChatMessage | null {
  if (messages.length === 0) {
    return null;
  }

  const lastMessage = messages[messages.length - 1];

  // 如果最後一條是使用者訊息，檢查是否有對應的AI回覆
  if (lastMessage.role === 'user') {
    // 檢查是否這是一個未配對的使用者訊息
    const rounds = groupMessagesByRounds(messages);
    const totalPairedMessages = rounds.length * 2;

    if (messages.length > totalPairedMessages) {
      return lastMessage;
    }
  }

  return null;
}

/**
 * 系統訊息型別 (用於壓縮上下文)
 */
export interface SystemMessage {
  role: 'system';
  content: string;
}

/**
 * 重建訊息歷史，整合壓縮上下文和最近對話
 *
 * @param compactContext - 壓縮的對話摘要
 * @param recentRounds - 最近的完整對話輪次
 * @param incompleteMessage - 未完成的使用者訊息 (可選)
 * @returns 重建的訊息陣列
 */
export function reconstructHistory(
  compactContext: string | null,
  recentRounds: ConversationRound[],
  incompleteMessage?: ChatMessage,
): (ChatMessage | SystemMessage)[] {
  const messages: (ChatMessage | SystemMessage)[] = [];

  // 加入壓縮上下文 (如果存在)
  if (compactContext) {
    messages.push({
      role: 'system' as const,
      content: `[COMPRESSED_CONTEXT] ${compactContext}`,
    } as SystemMessage);
  }

  // 加入最近的完整對話
  for (const round of recentRounds) {
    messages.push(round.userMessage, round.assistantMessage);
  }

  // 加入未完成的使用者訊息 (如果存在)
  if (incompleteMessage) {
    messages.push(incompleteMessage);
  }

  return messages;
}
