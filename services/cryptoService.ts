/**
 * WebCrypto 加密服務
 * 用於安全地在 URL 中傳輸 API 金鑰
 */

export interface EncryptedData {
  iv: string;
  data: string;
  salt: string;
}

export class CryptoService {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;
  private static readonly IV_LENGTH = 12;
  private static readonly SALT_LENGTH = 16;

  /**
   * 從密碼生成加密金鑰
   */
  private static async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    // 導入密碼作為原始金鑰材料
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );

    // 使用 PBKDF2 派生實際的加密金鑰
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: this.ALGORITHM, length: this.KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * 加密 API 金鑰數據
   */
  static async encryptApiKeys(
    apiKeys: { geminiApiKey?: string; tursoWriteApiKey?: string },
    password: string,
  ): Promise<string> {
    try {
      // 生成隨機 salt 和 IV
      const salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
      const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));

      // 派生加密金鑰
      const key = await this.deriveKey(password, salt);

      // 準備要加密的數據
      const dataToEncrypt = JSON.stringify(apiKeys);
      const encoder = new TextEncoder();
      const data = encoder.encode(dataToEncrypt);

      // 執行加密
      const encryptedBuffer = await crypto.subtle.encrypt(
        {
          name: this.ALGORITHM,
          iv: iv,
        },
        key,
        data,
      );

      // 將結果編碼為 base64 URL-safe 字符串
      const encrypted: EncryptedData = {
        iv: this.arrayBufferToBase64Url(iv),
        data: this.arrayBufferToBase64Url(encryptedBuffer),
        salt: this.arrayBufferToBase64Url(salt),
      };

      return this.arrayBufferToBase64Url(new TextEncoder().encode(JSON.stringify(encrypted)));
    } catch (error) {
      console.error('加密失敗:', error);
      throw new Error('無法加密 API 金鑰');
    }
  }

  /**
   * 解密 API 金鑰數據
   */
  static async decryptApiKeys(
    encryptedString: string,
    password: string,
  ): Promise<{ geminiApiKey?: string; tursoWriteApiKey?: string }> {
    try {
      // 解析加密數據
      const decodedData = new TextDecoder().decode(this.base64UrlToArrayBuffer(encryptedString));
      const encrypted: EncryptedData = JSON.parse(decodedData);

      // 轉換回 ArrayBuffer
      const salt = this.base64UrlToArrayBuffer(encrypted.salt);
      const iv = this.base64UrlToArrayBuffer(encrypted.iv);
      const data = this.base64UrlToArrayBuffer(encrypted.data);

      // 派生解密金鑰
      const key = await this.deriveKey(password, new Uint8Array(salt));

      // 執行解密
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: this.ALGORITHM,
          iv: iv,
        },
        key,
        data,
      );

      // 解析解密後的數據
      const decoder = new TextDecoder();
      const decryptedString = decoder.decode(decryptedBuffer);
      return JSON.parse(decryptedString);
    } catch (error) {
      console.error('解密失敗:', error);
      throw new Error('無法解密 API 金鑰，請檢查密碼是否正確');
    }
  }

  /**
   * 生成用於分享的 URL
   */
  static generateSharingUrl(encryptedData: string, _password: string): string {
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      keys: encryptedData,
      // 不在 URL 中包含密碼，需要用戶手動輸入
    });

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * 從 URL 中提取加密的 API 金鑰
   */
  static extractKeysFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get('keys');
  }

  /**
   * 生成隨機密碼
   */
  static generateRandomPassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * 將 ArrayBuffer 轉換為 URL-safe base64 字符串
   */
  private static arrayBufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * 將 URL-safe base64 字符串轉換為 ArrayBuffer
   */
  private static base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
    // 還原 padding
    const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/') + padding;

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export default CryptoService;
