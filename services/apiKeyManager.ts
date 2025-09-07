/**
 * API KEY 管理服務
 * 處理雙層 API KEY 架構：
 * 1. 內建只讀權限（Turso 只讀）- 所有人都可以讀取分享的助理
 * 2. 用戶提供（Gemini + Turso 讀寫）- 儲存在 LocalStorage
 */

// LocalStorage 鍵值
const STORAGE_KEYS = {
  GEMINI_API_KEY: 'user_gemini_api_key',
  TURSO_WRITE_API_KEY: 'user_turso_write_api_key',
  // 不再需要 TURSO_WRITE_URL，因為使用共用 URL
} as const;

export interface UserApiKeys {
  geminiApiKey?: string;
  tursoWriteApiKey?: string;
  // 不再需要 tursoWriteUrl，因為使用共用 URL
}

/**
 * API KEY 管理器
 */
export class ApiKeyManager {
  /**
   * 檢查是否有用戶設定的 Gemini API KEY
   */
  static hasGeminiApiKey(): boolean {
    return !!this.getGeminiApiKey();
  }

  /**
   * 檢查是否有用戶設定的 Turso 寫入權限
   */
  static hasTursoWriteAccess(): boolean {
    return !!this.getTursoWriteApiKey();
  }

  /**
   * 獲取 Gemini API KEY (用戶設定)
   */
  static getGeminiApiKey(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }
    return localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY);
  }

  /**
   * 獲取 Turso 寫入 API KEY (用戶設定)
   */
  static getTursoWriteApiKey(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }
    return localStorage.getItem(STORAGE_KEYS.TURSO_WRITE_API_KEY);
  }

  // 不再需要獨立的 getTursoWriteUrl()，因為使用共用 URL

  /**
   * 獲取 Turso 只讀配置 (內建)
   */
  static getTursoReadConfig(): { url: string; authToken: string } | null {
    // 從編譯時內建的配置 - 使用共用 URL 和只讀 API KEY
    const url = process.env.TURSO_URL;
    const authToken = process.env.TURSO_READ_API_KEY;

    if (!url || !authToken) {
      console.warn('內建 Turso 只讀配置不存在');
      return null;
    }

    return { url, authToken };
  }

  /**
   * 獲取 Turso 寫入配置 (用戶設定)
   */
  static getTursoWriteConfig(): { url: string; authToken: string } | null {
    const authToken = this.getTursoWriteApiKey();

    if (!authToken) {
      return null;
    }

    // 使用共用的 URL，但是用戶提供的寫入權限 API KEY
    const url = process.env.TURSO_URL;
    if (!url) {
      return null;
    }

    return { url, authToken };
  }

  /**
   * 設定用戶 API KEY
   */
  static setUserApiKeys(keys: UserApiKeys): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (keys.geminiApiKey) {
      localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, keys.geminiApiKey);
    } else {
      localStorage.removeItem(STORAGE_KEYS.GEMINI_API_KEY);
    }

    if (keys.tursoWriteApiKey) {
      localStorage.setItem(STORAGE_KEYS.TURSO_WRITE_API_KEY, keys.tursoWriteApiKey);
    } else {
      localStorage.removeItem(STORAGE_KEYS.TURSO_WRITE_API_KEY);
    }

    // 不再儲存 URL，因為使用共用 URL
  }

  /**
   * 清除所有用戶 API KEY
   */
  static clearUserApiKeys(): void {
    if (typeof window === 'undefined') {
      return;
    }

    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  }

  /**
   * 獲取所有用戶 API KEY
   */
  static getUserApiKeys(): UserApiKeys {
    return {
      geminiApiKey: this.getGeminiApiKey() || undefined,
      tursoWriteApiKey: this.getTursoWriteApiKey() || undefined,
      // 不再返回 URL，因為使用共用 URL
    };
  }

  /**
   * 檢查 API KEY 格式是否有效
   */
  static validateGeminiApiKey(apiKey: string): boolean {
    // Gemini API KEY 通常以 AIzaSy 開頭
    return /^AIzaSy[A-Za-z0-9_-]{33}$/.test(apiKey);
  }

  /**
   * 檢查 Turso API KEY 格式是否有效
   */
  static validateTursoApiKey(apiKey: string): boolean {
    // Turso JWT token 格式檢查
    try {
      const parts = apiKey.split('.');
      return parts.length === 3 && parts.every(part => part.length > 0);
    } catch {
      return false;
    }
  }

  // 不再需要 validateTursoUrl()，因為使用內建 URL
}

export default ApiKeyManager;
