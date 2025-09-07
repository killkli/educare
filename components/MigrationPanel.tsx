import React, { useState, useEffect } from 'react';
import {
  migrateIndexedDBToTurso,
  checkMigrationStatus,
  MigrationProgress,
} from '../services/migrationService';

const MigrationPanel: React.FC = () => {
  const [migrationStatus, setMigrationStatus] = useState<{
    hasIndexedDBData: boolean;
    assistantCount: number;
    totalChunks: number;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [migrationResult, setMigrationResult] = useState<{
    success: boolean;
    summary?: string;
    error?: string;
  } | null>(null);

  // 檢查遷移狀態
  useEffect(() => {
    const checkStatus = async () => {
      setIsLoading(true);
      try {
        const status = await checkMigrationStatus();
        setMigrationStatus(status);
      } catch (error) {
        console.error('Failed to check migration status:', error);
      }
      setIsLoading(false);
    };

    checkStatus();
  }, []);

  const handleMigration = async () => {
    if (!migrationStatus?.hasIndexedDBData) {
      return;
    }

    setIsMigrating(true);
    setMigrationResult(null);
    setMigrationProgress(null);

    try {
      const result = await migrateIndexedDBToTurso(progress => {
        setMigrationProgress(progress);
      });

      setMigrationResult(result);

      // 重新檢查狀態
      const newStatus = await checkMigrationStatus();
      setMigrationStatus(newStatus);
    } catch (error) {
      console.error('Migration error:', error);
      setMigrationResult({
        success: false,
        error: `Migration failed: ${error}`,
      });
    }

    setIsMigrating(false);
  };

  if (isLoading) {
    return (
      <div className='bg-gray-700 p-6 rounded-lg'>
        <h3 className='text-lg font-semibold text-white mb-4'>資料遷移</h3>
        <div className='text-gray-400'>
          <div className='animate-pulse'>檢查遷移狀態...</div>
        </div>
      </div>
    );
  }

  if (!migrationStatus?.hasIndexedDBData) {
    return (
      <div className='bg-gray-700 p-6 rounded-lg'>
        <h3 className='text-lg font-semibold text-white mb-4'>資料遷移</h3>
        <div className='text-gray-400'>
          <p>✅ 沒有找到需要遷移的 IndexedDB 資料。</p>
          <p className='text-sm mt-2'>您的資料已儲存在 Turso 雲端資料庫中。</p>
        </div>
      </div>
    );
  }

  return (
    <div className='bg-gray-700 p-6 rounded-lg'>
      <h3 className='text-lg font-semibold text-white mb-4'>Data Migration</h3>

      <div className='mb-4'>
        <p className='text-gray-300 mb-2'>📊 要遷移到 Turso 雲端的資料：</p>
        <ul className='text-sm text-gray-400 space-y-1'>
          <li>• {migrationStatus.assistantCount} 個助理設定</li>
          <li>• {migrationStatus.totalChunks} 個 RAG 知識區塊</li>
        </ul>

        <div className='mt-3 p-3 bg-blue-800 bg-opacity-30 rounded-md border border-blue-600'>
          <p className='text-blue-200 text-sm'>
            🔒 <strong>隱私說明：</strong>僅會遷移助理設定和 RAG 資料。
            您的聊天記錄仍在您的裝置上保持私密。
          </p>
        </div>
      </div>

      {!isMigrating && !migrationResult && (
        <div className='mb-4'>
          <p className='text-yellow-400 text-sm mb-3'>
            💡 將助理設定和 RAG 資料遷移到 Turso，以獲得更好的向量搜尋效能 和跨裝置同步。
          </p>
          <button
            onClick={handleMigration}
            className='px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-md transition-colors'
          >
            開始遷移到 Turso
          </button>
        </div>
      )}

      {isMigrating && migrationProgress && (
        <div className='mb-4'>
          <div className='mb-3'>
            <div className='flex justify-between text-sm text-gray-300 mb-1'>
              <span>{migrationProgress.step}</span>
              <span>
                {migrationProgress.current}/{migrationProgress.total}
              </span>
            </div>
            <div className='w-full bg-gray-600 rounded-full h-2'>
              <div
                className='bg-cyan-500 h-2 rounded-full transition-all duration-300'
                style={{
                  width:
                    migrationProgress.total > 0
                      ? `${(migrationProgress.current / migrationProgress.total) * 100}%`
                      : '0%',
                }}
              />
            </div>
          </div>

          {migrationProgress.error && (
            <div className='text-red-400 text-sm'>⚠️ {migrationProgress.error}</div>
          )}
        </div>
      )}

      {migrationResult && (
        <div
          className={`mb-4 p-4 rounded-md ${
            migrationResult.success
              ? 'bg-green-800 border border-green-600'
              : 'bg-red-800 border border-red-600'
          }`}
        >
          <div className='flex items-start'>
            <span className='text-2xl mr-2'>{migrationResult.success ? '✅' : '❌'}</span>
            <div className='flex-1'>
              <p
                className={`font-semibold ${
                  migrationResult.success ? 'text-green-200' : 'text-red-200'
                }`}
              >
                {migrationResult.success ? '遷移完成！' : '遷移失敗'}
              </p>

              {migrationResult.summary && (
                <pre
                  className={`text-sm mt-2 whitespace-pre-wrap ${
                    migrationResult.success ? 'text-green-300' : 'text-red-300'
                  }`}
                >
                  {migrationResult.summary}
                </pre>
              )}

              {migrationResult.error && (
                <details className='mt-2'>
                  <summary
                    className={`text-sm cursor-pointer ${
                      migrationResult.success ? 'text-green-300' : 'text-red-300'
                    }`}
                  >
                    查看錯誤詳細資訊
                  </summary>
                  <pre
                    className={`text-xs mt-1 p-2 bg-gray-900 rounded whitespace-pre-wrap ${
                      migrationResult.success ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {migrationResult.error}
                  </pre>
                </details>
              )}

              {migrationResult.success && (
                <p className='text-green-300 text-sm mt-2'>
                  🎉 您的資料現在儲存在 Turso 雲端資料庫中，具有原生向量搜尋功能！
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className='text-xs text-gray-500'>
        <p>ℹ️ 此遷移會將助理設定和 RAG 資料複製到 Turso 雲端資料庫。</p>
        <p>聊天記錄仍在您的裝置上保持私密。為了安全起見，您的本地資料保持不變。</p>
      </div>
    </div>
  );
};

export default MigrationPanel;
