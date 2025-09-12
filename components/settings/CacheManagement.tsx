import React, { useState, useEffect } from 'react';
import { ragCacheManagerV2 } from '../../services/ragCacheManagerV2';
import { cacheConfigService } from '../../services/cacheConfigService';

interface CacheStats {
  performanceMetrics: {
    totalQueries: number;
    cacheHits: number;
    cacheMisses: number;
    hitRate: number;
    averageQueryTime: number;
    averageCacheHitTime: number;
    averageFullRagTime: number;
  };
  storageStats: {
    totalEntries: number;
    entriesByAssistant: Record<string, number>;
    oldestEntry: number | null;
    newestEntry: number | null;
  };
}

interface CacheManagementProps {
  showHeader?: boolean;
  className?: string;
}

export const CacheManagement: React.FC<CacheManagementProps> = ({
  showHeader = true,
  className = 'p-6 max-w-4xl mx-auto',
}) => {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [similarityThreshold, setSimilarityThreshold] = useState(
    cacheConfigService.getSimilarityThreshold(),
  );
  const [clearingCache, setClearingCache] = useState(false);

  const refreshStats = async () => {
    setLoading(true);
    try {
      const cacheStats = await ragCacheManagerV2.getCacheStats();
      setStats(cacheStats);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const performMaintenance = async () => {
    setLoading(true);
    try {
      const result = await ragCacheManagerV2.performMaintenance();
      console.log('Maintenance completed:', result);
      await refreshStats(); // Refresh stats after maintenance
    } catch (error) {
      console.error('Maintenance failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearAssistantCache = async (assistantId: string) => {
    setClearingCache(true);
    try {
      const deletedCount = await ragCacheManagerV2.clearAssistantCache(assistantId);
      console.log(`Cleared ${deletedCount} entries for assistant ${assistantId}`);
      await refreshStats();
    } catch (error) {
      console.error('Failed to clear cache:', error);
    } finally {
      setClearingCache(false);
    }
  };

  const updateSimilarityThreshold = () => {
    cacheConfigService.setSimilarityThreshold(similarityThreshold);
    console.log(`Similarity threshold updated to ${similarityThreshold}`);
  };

  const resetMetrics = () => {
    ragCacheManagerV2.resetMetrics();
    refreshStats();
  };

  useEffect(() => {
    refreshStats();
    // Sync with current config
    setSimilarityThreshold(cacheConfigService.getSimilarityThreshold());
  }, []);

  const formatTime = (ms: number) => {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) {
      return 'N/A';
    }
    return new Date(timestamp).toLocaleString();
  };

  const getPerformanceColor = (hitRate: number) => {
    if (hitRate >= 0.5) {
      return 'text-green-400';
    }
    if (hitRate >= 0.3) {
      return 'text-yellow-400';
    }
    return 'text-red-400';
  };

  return (
    <div className={className}>
      {showHeader && (
        <div className='flex justify-between items-center mb-6'>
          <h2 className='text-2xl font-bold text-white'>RAG 緩存管理</h2>
          <div className='flex space-x-3'>
            <button
              onClick={refreshStats}
              disabled={loading}
              className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50'
            >
              {loading ? '更新中...' : '刷新統計'}
            </button>
            <button
              onClick={performMaintenance}
              disabled={loading}
              className='px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50'
            >
              執行維護
            </button>
          </div>
        </div>
      )}

      {lastUpdated && (
        <p className='text-gray-400 text-sm mb-4'>最後更新: {lastUpdated.toLocaleString()}</p>
      )}

      {stats && (
        <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
          {/* Performance Metrics */}
          <div className='bg-gray-800 p-6 rounded-lg'>
            <h3 className='text-xl font-semibold text-white mb-4 flex items-center'>
              📊 效能統計
              <button
                onClick={resetMetrics}
                className='ml-auto text-sm px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700'
              >
                重置
              </button>
            </h3>
            <div className='space-y-3'>
              <div className='flex justify-between'>
                <span className='text-gray-300'>總查詢數:</span>
                <span className='text-white font-mono'>
                  {stats.performanceMetrics.totalQueries}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-gray-300'>緩存命中:</span>
                <span className='text-green-400 font-mono'>
                  {stats.performanceMetrics.cacheHits}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-gray-300'>緩存未命中:</span>
                <span className='text-red-400 font-mono'>
                  {stats.performanceMetrics.cacheMisses}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-gray-300'>命中率:</span>
                <span
                  className={`font-mono ${getPerformanceColor(stats.performanceMetrics.hitRate)}`}
                >
                  {(stats.performanceMetrics.hitRate * 100).toFixed(1)}%
                </span>
              </div>
              <hr className='border-gray-600' />
              <div className='flex justify-between'>
                <span className='text-gray-300'>平均查詢時間:</span>
                <span className='text-white font-mono'>
                  {formatTime(stats.performanceMetrics.averageQueryTime)}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-gray-300'>平均緩存命中時間:</span>
                <span className='text-green-400 font-mono'>
                  {formatTime(stats.performanceMetrics.averageCacheHitTime)}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-gray-300'>平均完整 RAG 時間:</span>
                <span className='text-orange-400 font-mono'>
                  {formatTime(stats.performanceMetrics.averageFullRagTime)}
                </span>
              </div>
            </div>

            {stats.performanceMetrics.totalQueries > 0 && (
              <div className='mt-4 p-3 bg-gray-700 rounded'>
                <div className='text-sm text-gray-300 mb-2'>效能提升</div>
                <div className='text-green-400 font-semibold'>
                  緩存平均節省:{' '}
                  {formatTime(
                    stats.performanceMetrics.averageFullRagTime -
                      stats.performanceMetrics.averageCacheHitTime,
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Storage Stats */}
          <div className='bg-gray-800 p-6 rounded-lg'>
            <h3 className='text-xl font-semibold text-white mb-4'>💾 存儲統計</h3>
            <div className='space-y-3'>
              <div className='flex justify-between'>
                <span className='text-gray-300'>總緩存條目:</span>
                <span className='text-white font-mono'>{stats.storageStats.totalEntries}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-gray-300'>最早條目:</span>
                <span className='text-white font-mono text-sm'>
                  {formatDate(stats.storageStats.oldestEntry)}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-gray-300'>最新條目:</span>
                <span className='text-white font-mono text-sm'>
                  {formatDate(stats.storageStats.newestEntry)}
                </span>
              </div>
            </div>

            {Object.keys(stats.storageStats.entriesByAssistant).length > 0 && (
              <div className='mt-4'>
                <h4 className='text-lg font-semibold text-white mb-2'>各助手緩存分佈</h4>
                <div className='space-y-2 max-h-32 overflow-y-auto'>
                  {Object.entries(stats.storageStats.entriesByAssistant).map(
                    ([assistantId, count]) => (
                      <div key={assistantId} className='flex justify-between items-center'>
                        <span className='text-gray-300 text-sm truncate flex-1'>
                          {assistantId.substring(0, 8)}...
                        </span>
                        <div className='flex items-center space-x-2'>
                          <span className='text-white font-mono text-sm'>{count}</span>
                          <button
                            onClick={() => clearAssistantCache(assistantId)}
                            disabled={clearingCache}
                            className='px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50'
                          >
                            清除
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Configuration */}
          <div className='bg-gray-800 p-6 rounded-lg'>
            <h3 className='text-xl font-semibold text-white mb-4'>⚙️ 緩存設定</h3>
            <div className='space-y-4'>
              <div>
                <label className='block text-gray-300 text-sm mb-2'>
                  相似度閾值 (當前: {similarityThreshold})
                </label>
                <div className='flex items-center space-x-3'>
                  <input
                    type='range'
                    min='0.7'
                    max='0.99'
                    step='0.01'
                    value={similarityThreshold}
                    onChange={e => setSimilarityThreshold(parseFloat(e.target.value))}
                    className='flex-1'
                  />
                  <button
                    onClick={updateSimilarityThreshold}
                    className='px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700'
                  >
                    更新
                  </button>
                </div>
                <div className='text-xs text-gray-400 mt-1'>越高越嚴格 (建議: 0.9+)</div>
              </div>

              <div className='pt-3 border-t border-gray-600'>
                <h4 className='text-sm font-semibold text-white mb-2'>緩存策略說明</h4>
                <ul className='text-sm text-gray-400 space-y-1'>
                  <li>• 相似度 &gt; {similarityThreshold} 才命中緩存</li>
                  <li>• 每個助手最多 1000 條記錄</li>
                  <li>• 30天未訪問自動清理</li>
                  <li>• 使用 LRU 策略管理容量</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className='bg-gray-800 p-6 rounded-lg'>
            <h3 className='text-xl font-semibold text-white mb-4'>🚀 快速操作</h3>
            <div className='space-y-3'>
              <button
                onClick={performMaintenance}
                disabled={loading}
                className='w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50'
              >
                🧹 執行緩存清理
              </button>

              <div className='text-xs text-gray-400'>清理過期條目並優化存儲</div>

              <hr className='border-gray-600' />

              <div className='text-sm text-gray-300'>
                <strong>調試工具:</strong>
              </div>

              <button
                onClick={() => {
                  console.log('Current cache stats:', stats);
                  console.log('RagCacheManagerV2 instance:', ragCacheManagerV2);
                }}
                className='w-full px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700'
              >
                🔍 輸出調試信息
              </button>
            </div>
          </div>
        </div>
      )}

      {!stats && !loading && (
        <div className='text-center py-12'>
          <p className='text-gray-400'>無法加載緩存統計</p>
          <button
            onClick={refreshStats}
            className='mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700'
          >
            重試
          </button>
        </div>
      )}

      {loading && !stats && (
        <div className='text-center py-12'>
          <div className='inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500'></div>
          <p className='text-gray-400 mt-4'>加載統計中...</p>
        </div>
      )}
    </div>
  );
};
