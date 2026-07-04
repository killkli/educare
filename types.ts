export interface RagChunk {
  fileName: string;
  content: string;
  vector?: number[];
  relevanceScore?: number;
}

export interface QueryCacheEntry {
  id: string; // UUID
  queryText: string; // 原始查詢文字
  queryEmbedding: number[]; // 查詢的向量表示
  rerankedResults: RagChunk[]; // rerank 後的結果
  assistantId: string; // 所屬助手ID
  timestamp: number; // 創建時間戳
  hitCount: number; // 命中次數
  lastAccessTime: number; // 最後訪問時間
}

export interface Assistant {
  id: string;
  name: string;
  description: string; // 給使用者看的友善描述
  systemPrompt: string; // 給 AI 的內部指令
  ragChunks?: RagChunk[];
  createdAt: number;
  isShared?: boolean;
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
  activeProjectId?: string | null;
  // 壓縮相關欄位
  compactContext?: CompactContext; // 壓縮的對話上下文
  lastCompactionAt?: string; // 最後壓縮時間 (ISO string)
}

export type HtmlProjectStatus = 'draft' | 'ready' | 'error';
export type HtmlProjectFileKind = 'html' | 'css' | 'js' | 'json' | 'svg' | 'asset' | 'md';
export type HtmlProjectPreviewUrlType = 'blob' | 'data';

export interface HtmlProject {
  id: string;
  assistantId: string;
  sessionId?: string | null;
  name: string;
  description?: string;
  entryFile: string;
  status: HtmlProjectStatus;
  previewVersion: number;
  assetPaths: string[];
  createdAt: number;
  updatedAt: number;
  lastPrompt?: string;
  lastBuildError?: string | null;
  tags?: string[];
}

export type HtmlProjectTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface HtmlProjectTodo {
  projectId: string;
  id: string;
  title: string;
  description?: string;
  status: HtmlProjectTodoStatus;
  order: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface HtmlProjectTodoSummary {
  projectId: string;
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  allComplete: boolean;
}

export interface HtmlProjectFile {
  projectId: string;
  path: string;
  kind: HtmlProjectFileKind;
  content: string;
  encoding?: 'utf-8' | 'base64';
  dependencies?: string[];
  size: number;
  updatedAt: number;
}

export interface HtmlProjectSnapshot {
  projectId: string;
  version: number;
  files: string[];
  createdAt: number;
  note?: string;
}

export interface HtmlProjectFileDescriptor {
  path: string;
  kind: HtmlProjectFileKind;
  size: number;
  updatedAt: number;
  dependencies?: string[];
}

export interface HtmlProjectPreviewArtifact {
  projectId: string;
  previewVersion: number;
  entryFile: string;
  previewReady: boolean;
  previewUrlType: HtmlProjectPreviewUrlType;
  html: string;
  url?: string;
  warnings: string[];
  error?: string | null;
  generatedAt: number;
}

export interface HtmlProjectWorkspaceUpdate {
  activeProjectId: string | null;
  preview: HtmlProjectPreviewArtifact | null;
  activityMessage: string;
}

export interface HtmlProjectToolExecutionResult {
  toolName: string;
  summary: string;
  result: Record<string, unknown>;
  workspace: HtmlProjectWorkspaceUpdate;
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

export interface EmbeddingConfig {
  timeoutSeconds: number; // Timeout for browser embedding in seconds
  fallbackToSimple: boolean; // Whether to fallback to simple text similarity
  showMethodUsed: boolean; // Show which embedding method was used (dev mode)
}

export interface EmbeddingResult {
  vector: number[];
  method: 'browser-webgpu' | 'browser-cpu' | 'simple';
  processingTime: number;
}
