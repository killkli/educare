import { createClient } from '@libsql/client';
import { ApiKeyManager } from './apiKeyManager';

// 建立客戶端實例的工廠函數 - 支援動態配置
const createTursoClient = (mode: 'read' | 'write') => {
  let config;

  if (mode === 'write') {
    // 寫入模式：使用用戶提供的配置
    const writeConfig = ApiKeyManager.getTursoWriteConfig();
    if (!writeConfig) {
      throw new Error('請先在設定中配置 Turso 寫入權限才能儲存資料。');
    }
    config = writeConfig;
  } else {
    // 讀取模式：優先使用用戶配置，否則使用內建只讀配置
    const userConfig = ApiKeyManager.getTursoWriteConfig();
    const readConfig = ApiKeyManager.getTursoReadConfig();
    config = userConfig || readConfig;

    if (!config) {
      throw new Error('無法連接到 Turso 資料庫，請檢查配置。');
    }
  }

  return createClient({
    url: config.url,
    authToken: config.authToken,
  });
};

// 獲取讀取客戶端（優先用戶配置，後備內建只讀）
const getReadClient = () => createTursoClient('read');

// 獲取寫入客戶端（必須用戶配置）
const getWriteClient = () => createTursoClient('write');

/**
 * 檢查是否可以寫入 Turso
 */
export const canWriteToTurso = (): boolean => {
  return ApiKeyManager.hasTursoWriteAccess();
};

/**
 * 檢查是否可以從 Turso 讀取
 */
export const canReadFromTurso = (): boolean => {
  return ApiKeyManager.hasTursoWriteAccess() || !!ApiKeyManager.getTursoReadConfig();
};

export interface TursoAssistant {
  id: string;
  name: string;
  description: string; // 給使用者看的友善描述
  systemPrompt: string; // 給 AI 的內部指令
  createdAt: number;
}

export interface TursoRagChunk {
  id: string;
  assistantId: string;
  fileName: string;
  content: string;
  createdAt: number;
}

export interface SimilarChunk {
  fileName: string;
  content: string;
  similarity: number;
}

// 初始化資料庫結構
export const initializeDatabase = async (): Promise<void> => {
  try {
    const client = getWriteClient(); // 需要寫入權限來建立表格

    // 建立助手資料表
    await client.execute(`
      CREATE TABLE IF NOT EXISTS assistants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        system_prompt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // 建立 RAG chunks 資料表，包含向量欄位
    await client.execute(`
      CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY,
        assistant_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding F32_BLOB(768),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE
      )
    `);

    // 建立向量索引
    await client.execute(`
      CREATE INDEX IF NOT EXISTS rag_chunks_vector_idx 
      ON rag_chunks (libsql_vector_idx(embedding, 'metric=cosine'))
    `);

    console.log('Turso database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Turso database:', error);
    throw error;
  }
};

// 儲存助手到 Turso - 避免使用 INSERT OR REPLACE 防止觸發 CASCADE 刪除 RAG chunks
export const saveAssistantToTurso = async (assistant: TursoAssistant): Promise<void> => {
  const client = getWriteClient(); // 需要寫入權限

  try {
    // 首先檢查助手是否已存在
    const existingResult = await client.execute({
      sql: 'SELECT id FROM assistants WHERE id = ?',
      args: [assistant.id],
    });

    if (existingResult.rows.length > 0) {
      // 如果已存在，只更新名稱、描述和系統提示，保持 created_at 不變
      await client.execute({
        sql: `UPDATE assistants 
              SET name = ?, description = ?, system_prompt = ?
              WHERE id = ?`,
        args: [assistant.name, assistant.description, assistant.systemPrompt, assistant.id],
      });
    } else {
      // 如果不存在，插入新記錄
      await client.execute({
        sql: `INSERT INTO assistants (id, name, description, system_prompt, created_at) 
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          assistant.id,
          assistant.name,
          assistant.description,
          assistant.systemPrompt,
          assistant.createdAt,
        ],
      });
    }
  } catch (error) {
    console.error('Failed to save assistant to Turso:', error);
    throw error;
  }
};

// 儲存 RAG chunk 含向量到 Turso
export const saveRagChunkToTurso = async (
  chunk: TursoRagChunk,
  embedding: number[],
): Promise<void> => {
  const client = getWriteClient(); // 需要寫入權限

  try {
    const vectorString = `[${embedding.join(',')}]`;

    await client.execute({
      sql: `INSERT OR REPLACE INTO rag_chunks (id, assistant_id, file_name, content, embedding, created_at) 
            VALUES (?, ?, ?, ?, vector(?), ?)`,
      args: [
        chunk.id,
        chunk.assistantId,
        chunk.fileName,
        chunk.content,
        vectorString,
        chunk.createdAt,
      ],
    });
  } catch (error) {
    console.error('Failed to save RAG chunk to Turso:', error);
    throw error;
  }
};

// 使用 Turso 向量搜尋取代原本的相似度計算
export const searchSimilarChunks = async (
  assistantId: string,
  queryEmbedding: number[],
  topK = 3,
): Promise<SimilarChunk[]> => {
  try {
    const client = getReadClient(); // 只需要讀取權限

    console.log(
      `🔍 [TURSO VECTOR SEARCH] Starting search for assistant: ${assistantId}, topK: ${topK}`,
    );

    const vectorString = `[${queryEmbedding.join(',')}]`;

    // 使用 vector_distance_cos 函數取得實際的相似度分數
    const result = await client.execute({
      sql: `SELECT file_name, content, 
                   1 - vector_distance_cos(embedding, vector(?)) AS similarity
            FROM rag_chunks 
            WHERE assistant_id = ?
            ORDER BY similarity DESC 
            LIMIT ?`,
      args: [vectorString, assistantId, topK],
    });

    const chunks = result.rows.map(row => ({
      fileName: row.file_name as string,
      content: row.content as string,
      similarity: row.similarity as number,
    }));

    console.log(
      `✅ [TURSO VECTOR SEARCH] Found ${chunks.length} chunks:`,
      chunks.map(c => ({
        fileName: c.fileName,
        similarity: c.similarity.toFixed(4),
        contentLength: c.content.length,
      })),
    );

    return chunks;
  } catch (error) {
    console.error('❌ [TURSO VECTOR SEARCH] Failed to search similar chunks:', error);
    return []; // 如果搜尋失敗，回傳空陣列
  }
};

// 取得助手資料
export const getAssistantFromTurso = async (id: string): Promise<TursoAssistant | null> => {
  try {
    const client = getReadClient(); // 只需要讀取權限

    const result = await client.execute({
      sql: 'SELECT * FROM assistants WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) || '', // 提供預設值以防舊資料
      systemPrompt: row.system_prompt as string,
      createdAt: row.created_at as number,
    };
  } catch (error) {
    console.error('Failed to get assistant from Turso:', error);
    return null;
  }
};

// 檢查助手是否存在於 Turso 中
export const checkAssistantExistsInTurso = async (id: string): Promise<boolean> => {
  try {
    const client = getReadClient();

    const result = await client.execute({
      sql: 'SELECT COUNT(*) as count FROM assistants WHERE id = ?',
      args: [id],
    });

    const count = result.rows[0]?.count as number;
    return count > 0;
  } catch (error) {
    console.error('Failed to check if assistant exists in Turso:', error);
    return false; // 如果檢查失敗，預設為不存在
  }
};

// 取得所有助手
export const getAllAssistantsFromTurso = async (): Promise<TursoAssistant[]> => {
  try {
    const client = getReadClient(); // 只需要讀取權限

    const result = await client.execute('SELECT * FROM assistants ORDER BY created_at DESC');

    return result.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) || '', // 提供預設值以防舊資料
      systemPrompt: row.system_prompt as string,
      createdAt: row.created_at as number,
    }));
  } catch (error) {
    console.error('Failed to get all assistants from Turso:', error);
    return [];
  }
};

// 刪除助手及其相關資料
export const deleteAssistantFromTurso = async (id: string): Promise<void> => {
  const client = getWriteClient(); // 需要寫入權限

  try {
    // 由於設定了 FOREIGN KEY ON DELETE CASCADE，刪除助手會自動刪除相關的 RAG chunks 和對話記錄
    await client.execute({
      sql: 'DELETE FROM assistants WHERE id = ?',
      args: [id],
    });
  } catch (error) {
    console.error('Failed to delete assistant from Turso:', error);
    throw error;
  }
};

// 取得助手的 RAG chunks 數量
export const getRagChunkCount = async (assistantId: string): Promise<number> => {
  try {
    const client = getReadClient(); // 只需要讀取權限

    const result = await client.execute({
      sql: 'SELECT COUNT(*) as count FROM rag_chunks WHERE assistant_id = ?',
      args: [assistantId],
    });

    return result.rows[0].count as number;
  } catch (error) {
    console.error('Failed to get RAG chunk count:', error);
    return 0;
  }
};

// 清除助手的所有 RAG chunks
export const clearAssistantRagChunks = async (assistantId: string): Promise<void> => {
  const client = getWriteClient(); // 需要寫入權限

  try {
    await client.execute({
      sql: 'DELETE FROM rag_chunks WHERE assistant_id = ?',
      args: [assistantId],
    });
  } catch (error) {
    console.error('Failed to clear assistant RAG chunks:', error);
    throw error;
  }
};
