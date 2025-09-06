export interface RagChunk {
  fileName: string;
  content: string;
  vector: number[];
}

export interface Assistant {
  id: string;
  name:string;
  systemPrompt: string;
  ragChunks: RagChunk[];
  createdAt: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface ChatSession {
  id: string;
  assistantId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  tokenCount: number;
}