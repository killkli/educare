/**
 * Centralized cache configuration service
 * Manages all cache-related settings in one place
 */

export interface CacheConfig {
  /** Similarity threshold for cache hits (0-1) */
  similarityThreshold: number;
  /** Maximum cache entries per assistant */
  maxEntriesPerAssistant: number;
  /** Cache expiration time in days */
  expirationDays: number;
  /** Enable automatic cache maintenance */
  autoMaintenance: boolean;
  /** Auto maintenance interval in ms */
  maintenanceInterval: number;
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  similarityThreshold: 0.9, // High threshold for precise cache hits
  maxEntriesPerAssistant: 1000,
  expirationDays: 30,
  autoMaintenance: true,
  maintenanceInterval: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Cache configuration service
 */
export class CacheConfigService {
  private config: CacheConfig = { ...DEFAULT_CACHE_CONFIG };
  private readonly STORAGE_KEY = 'educare_cache_config';

  constructor() {
    this.loadConfig();
  }

  /**
   * Get current cache configuration
   */
  getConfig(): CacheConfig {
    return { ...this.config };
  }

  /**
   * Get similarity threshold
   */
  getSimilarityThreshold(): number {
    return this.config.similarityThreshold;
  }

  /**
   * Update similarity threshold
   */
  setSimilarityThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      console.warn(`Invalid similarity threshold: ${threshold}. Using default.`);
      return;
    }
    this.config.similarityThreshold = threshold;
    this.saveConfig();
    console.log(`🎛️ Cache similarity threshold updated to ${threshold}`);
  }

  /**
   * Update cache configuration
   */
  updateConfig(updates: Partial<CacheConfig>): void {
    const oldConfig = { ...this.config };

    // Validate and update configuration
    if (updates.similarityThreshold !== undefined) {
      if (updates.similarityThreshold < 0 || updates.similarityThreshold > 1) {
        console.warn(
          `Invalid similarity threshold: ${updates.similarityThreshold}. Keeping current value.`,
        );
        delete updates.similarityThreshold;
      }
    }

    if (updates.maxEntriesPerAssistant !== undefined && updates.maxEntriesPerAssistant < 1) {
      console.warn(
        `Invalid max entries: ${updates.maxEntriesPerAssistant}. Keeping current value.`,
      );
      delete updates.maxEntriesPerAssistant;
    }

    if (updates.expirationDays !== undefined && updates.expirationDays < 1) {
      console.warn(`Invalid expiration days: ${updates.expirationDays}. Keeping current value.`);
      delete updates.expirationDays;
    }

    this.config = { ...this.config, ...updates };
    this.saveConfig();

    console.log('🎛️ Cache configuration updated:', {
      changed: Object.keys(updates),
      from: oldConfig,
      to: this.config,
    });
  }

  /**
   * Reset to default configuration
   */
  resetToDefaults(): void {
    this.config = { ...DEFAULT_CACHE_CONFIG };
    this.saveConfig();
    console.log('🔄 Cache configuration reset to defaults');
  }

  /**
   * Load configuration from localStorage
   */
  private loadConfig(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsedConfig = JSON.parse(stored);

        // Validate stored configuration
        this.config = {
          similarityThreshold:
            this.validateNumber(parsedConfig.similarityThreshold, 0, 1) ??
            DEFAULT_CACHE_CONFIG.similarityThreshold,
          maxEntriesPerAssistant:
            this.validateNumber(parsedConfig.maxEntriesPerAssistant, 1) ??
            DEFAULT_CACHE_CONFIG.maxEntriesPerAssistant,
          expirationDays:
            this.validateNumber(parsedConfig.expirationDays, 1) ??
            DEFAULT_CACHE_CONFIG.expirationDays,
          autoMaintenance:
            typeof parsedConfig.autoMaintenance === 'boolean'
              ? parsedConfig.autoMaintenance
              : DEFAULT_CACHE_CONFIG.autoMaintenance,
          maintenanceInterval:
            this.validateNumber(parsedConfig.maintenanceInterval, 1000) ??
            DEFAULT_CACHE_CONFIG.maintenanceInterval,
        };

        console.log('📦 Cache configuration loaded from localStorage');
      }
    } catch (error) {
      console.warn('Failed to load cache configuration from localStorage:', error);
      this.config = { ...DEFAULT_CACHE_CONFIG };
    }
  }

  /**
   * Save configuration to localStorage
   */
  private saveConfig(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.config));
    } catch (error) {
      console.error('Failed to save cache configuration to localStorage:', error);
    }
  }

  /**
   * Validate number within range
   */
  private validateNumber(value: unknown, min: number, max?: number): number | null {
    if (typeof value !== 'number' || isNaN(value) || value < min) {
      return null;
    }
    if (max !== undefined && value > max) {
      return null;
    }
    return value;
  }
}

// Singleton instance
export const cacheConfigService = new CacheConfigService();
