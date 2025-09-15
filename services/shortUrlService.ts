import { createClient } from '@libsql/client';
import { ApiKeyManager } from './apiKeyManager';

// 短網址數據結構
export interface ShortUrlData {
  shortCode: string;
  assistantId: string;
  encryptedKeys?: string; // 加密的 API 金鑰數據
  createdAt: number;
  expiresAt?: number; // 可選的過期時間
  clickCount: number;
  lastClickedAt?: number;
}

// 建立客戶端實例
const createTursoClient = (mode: 'read' | 'write') => {
  let config;

  if (mode === 'write') {
    const writeConfig = ApiKeyManager.getTursoWriteConfig();
    if (!writeConfig) {
      throw new Error('請先在設定中配置 Turso 寫入權限才能儲存短網址資料。');
    }
    config = writeConfig;
  } else {
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

const getReadClient = () => createTursoClient('read');
const getWriteClient = () => createTursoClient('write');

// Base62 編碼字符集
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * 生成隨機的 Base62 短代碼
 */
const generateShortCode = (length = 8): string => {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BASE62_CHARS.charAt(Math.floor(Math.random() * BASE62_CHARS.length));
  }
  return result;
};

/**
 * 生成短網址
 */
export const generateShortUrl = async (
  assistantId: string,
  encryptedKeys?: string,
  expiresInDays?: number,
): Promise<string> => {
  const client = getWriteClient();
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const shortCode = generateShortCode();
    const createdAt = Date.now();
    const expiresAt = expiresInDays ? createdAt + expiresInDays * 24 * 60 * 60 * 1000 : null;

    try {
      // 嘗試插入新的短網址記錄
      await client.execute({
        sql: `INSERT INTO short_urls (short_code, assistant_id, encrypted_keys, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [shortCode, assistantId, encryptedKeys || null, createdAt, expiresAt],
      });

      console.log(`✅ Generated short URL: ${shortCode} for assistant: ${assistantId}`);
      return shortCode;
    } catch (error: unknown) {
      if (error instanceof Error && error.message?.includes('UNIQUE constraint failed')) {
        // 短代碼已存在，重試
        attempts++;
        console.log(
          `⚠️ Short code ${shortCode} already exists, retrying... (${attempts}/${maxAttempts})`,
        );
        continue;
      }
      // 其他錯誤，直接拋出
      console.error('❌ Failed to generate short URL:', error);
      throw error;
    }
  }

  throw new Error('Unable to generate unique short code after maximum attempts');
};

/**
 * 解析短網址獲取原始數據
 */
export const resolveShortUrl = async (shortCode: string): Promise<ShortUrlData | null> => {
  try {
    const client = getReadClient();

    const result = await client.execute({
      sql: 'SELECT * FROM short_urls WHERE short_code = ?',
      args: [shortCode],
    });

    if (result.rows.length === 0) {
      console.log(`❌ Short URL not found: ${shortCode}`);
      return null;
    }

    const row = result.rows[0];
    const shortUrlData: ShortUrlData = {
      shortCode: row.short_code as string,
      assistantId: row.assistant_id as string,
      encryptedKeys: (row.encrypted_keys as string) || undefined,
      createdAt: row.created_at as number,
      expiresAt: (row.expires_at as number) || undefined,
      clickCount: (row.click_count as number) || 0,
      lastClickedAt: (row.last_clicked_at as number) || undefined,
    };

    // 檢查是否已過期
    if (shortUrlData.expiresAt && Date.now() > shortUrlData.expiresAt) {
      console.log(`⚠️ Short URL expired: ${shortCode}`);
      return null;
    }

    console.log(`✅ Resolved short URL: ${shortCode} -> Assistant: ${shortUrlData.assistantId}`);
    return shortUrlData;
  } catch (error) {
    console.error('❌ Failed to resolve short URL:', error);
    return null;
  }
};

/**
 * 記錄短網址點擊
 */
export const recordShortUrlClick = async (shortCode: string): Promise<void> => {
  try {
    const client = getWriteClient();

    await client.execute({
      sql: `UPDATE short_urls
            SET click_count = click_count + 1, last_clicked_at = ?
            WHERE short_code = ?`,
      args: [Date.now(), shortCode],
    });

    console.log(`📊 Recorded click for short URL: ${shortCode}`);
  } catch (error) {
    console.error('❌ Failed to record short URL click:', error);
    // 不拋出錯誤，因為點擊記錄不是關鍵功能
  }
};

/**
 * 獲取助理的所有短網址
 */
export const getShortUrlsForAssistant = async (assistantId: string): Promise<ShortUrlData[]> => {
  try {
    const client = getReadClient();

    const result = await client.execute({
      sql: 'SELECT * FROM short_urls WHERE assistant_id = ? ORDER BY created_at DESC',
      args: [assistantId],
    });

    return result.rows.map(row => ({
      shortCode: row.short_code as string,
      assistantId: row.assistant_id as string,
      encryptedKeys: (row.encrypted_keys as string) || undefined,
      createdAt: row.created_at as number,
      expiresAt: (row.expires_at as number) || undefined,
      clickCount: (row.click_count as number) || 0,
      lastClickedAt: (row.last_clicked_at as number) || undefined,
    }));
  } catch (error) {
    console.error('❌ Failed to get short URLs for assistant:', error);
    return [];
  }
};

/**
 * 刪除短網址
 */
export const deleteShortUrl = async (shortCode: string): Promise<void> => {
  try {
    const client = getWriteClient();

    await client.execute({
      sql: 'DELETE FROM short_urls WHERE short_code = ?',
      args: [shortCode],
    });

    console.log(`🗑️ Deleted short URL: ${shortCode}`);
  } catch (error) {
    console.error('❌ Failed to delete short URL:', error);
    throw error;
  }
};

/**
 * 清理過期的短網址
 */
export const cleanupExpiredShortUrls = async (): Promise<number> => {
  try {
    const client = getWriteClient();
    const now = Date.now();

    const result = await client.execute({
      sql: 'DELETE FROM short_urls WHERE expires_at IS NOT NULL AND expires_at < ?',
      args: [now],
    });

    const deletedCount = result.rowsAffected || 0;
    console.log(`🧹 Cleaned up ${deletedCount} expired short URLs`);
    return deletedCount;
  } catch (error) {
    console.error('❌ Failed to cleanup expired short URLs:', error);
    return 0;
  }
};

/**
 * 獲取應用的 base URL（考慮 Vite 配置）
 */
const getBaseUrl = (): string => {
  // 從當前 pathname 獲取 base URL
  const pathname = window.location.pathname;

  // 如果 pathname 包含 base URL（如 /chatbot-test/），提取它
  // 否則使用根路徑 '/'
  const baseUrlMatch = pathname.match(/^(\/[^/]*\/)/);
  return baseUrlMatch ? baseUrlMatch[1] : '/';
};

/**
 * 構建完整的短網址
 */
export const buildShortUrl = (shortCode: string): string => {
  const baseUrl = getBaseUrl();
  return `${window.location.origin}${baseUrl}s/${shortCode}`;
};
