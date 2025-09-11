export interface RagChunk {
  fileName: string;
  content: string;
  vector?: number[];
  relevanceScore?: number;
}

export interface Assistant {
  id: string;
  name: string;
  description: string; // 給使用者看的友善描述
  systemPrompt: string; // 給 AI 的內部指令
  ragChunks?: RagChunk[];
  createdAt: number;
  isShared?: boolean;
  shareId?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

/**
 * 壓縮上下文介面 - 儲存壓縮後的對話摘要
 */
export interface CompactContext {
  type: 'compact';
  content: string; // 壓縮後的摘要內容
  tokenCount: number; // 摘要的 token 數量
  compressedFromRounds: number; // 壓縮了多少輪對話
  compressedFromMessages: number; // 壓縮了多少條訊息
  createdAt: string; // 壓縮時間 (ISO string)
  version: string; // 壓縮版本（用於未來升級）
}

/**
 * 對話輪次介面 - 代表一輪完整的對話 (使用者訊息 + AI回覆)
 */
export interface ConversationRound {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  roundNumber: number;
}

export interface ChatSession {
  id: string;
  assistantId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt?: number;
  tokenCount: number;
  // 壓縮相關欄位
  compactContext?: CompactContext; // 壓縮的對話上下文
  lastCompactionAt?: string; // 最後壓縮時間 (ISO string)
}

/**
 * RAG 設定介面 - 使用者可配置的全域 RAG 設定
 */
export interface RagSettings {
  /** 向量搜尋結果數量 (預設: 20) */
  vectorSearchLimit: number;
  /** 是否啟用重新排序 (預設: true) */
  enableReranking: boolean;
  /** 重新排序後保留的結果數量 (預設: 5) */
  rerankLimit: number;
  /** 最低相似度閾值 (預設: 0.3) */
  minSimilarity: number;
}
