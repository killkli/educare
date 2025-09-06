import React, { useState, useEffect } from 'react';
import { migrateIndexedDBToTurso, checkMigrationStatus, MigrationProgress } from '../services/migrationService';

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
    if (!migrationStatus?.hasIndexedDBData) return;

    setIsMigrating(true);
    setMigrationResult(null);
    setMigrationProgress(null);

    try {
      const result = await migrateIndexedDBToTurso((progress) => {
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
        error: `Migration failed: ${error}`
      });
    }

    setIsMigrating(false);
  };

  if (isLoading) {
    return (
      <div className="bg-gray-700 p-6 rounded-lg">
        <h3 className="text-lg font-semibold text-white mb-4">Data Migration</h3>
        <div className="text-gray-400">
          <div className="animate-pulse">Checking migration status...</div>
        </div>
      </div>
    );
  }

  if (!migrationStatus?.hasIndexedDBData) {
    return (
      <div className="bg-gray-700 p-6 rounded-lg">
        <h3 className="text-lg font-semibold text-white mb-4">Data Migration</h3>
        <div className="text-gray-400">
          <p>✅ No IndexedDB data found to migrate.</p>
          <p className="text-sm mt-2">Your data is already stored in Turso cloud database.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-700 p-6 rounded-lg">
      <h3 className="text-lg font-semibold text-white mb-4">Data Migration</h3>
      
      <div className="mb-4">
        <p className="text-gray-300 mb-2">
          📊 Data to Migrate to Turso Cloud:
        </p>
        <ul className="text-sm text-gray-400 space-y-1">
          <li>• {migrationStatus.assistantCount} assistant settings</li>
          <li>• {migrationStatus.totalChunks} RAG knowledge chunks</li>
        </ul>
        
        <div className="mt-3 p-3 bg-blue-800 bg-opacity-30 rounded-md border border-blue-600">
          <p className="text-blue-200 text-sm">
            🔒 <strong>Privacy Note:</strong> Only assistant settings and RAG data will be migrated. 
            Your chat history remains private on your device.
          </p>
        </div>
      </div>

      {!isMigrating && !migrationResult && (
        <div className="mb-4">
          <p className="text-yellow-400 text-sm mb-3">
            💡 Migrate assistant settings and RAG data to Turso for better vector search performance and cross-device sync.
          </p>
          <button
            onClick={handleMigration}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-md transition-colors"
          >
            Start Migration to Turso
          </button>
        </div>
      )}

      {isMigrating && migrationProgress && (
        <div className="mb-4">
          <div className="mb-3">
            <div className="flex justify-between text-sm text-gray-300 mb-1">
              <span>{migrationProgress.step}</span>
              <span>{migrationProgress.current}/{migrationProgress.total}</span>
            </div>
            <div className="w-full bg-gray-600 rounded-full h-2">
              <div 
                className="bg-cyan-500 h-2 rounded-full transition-all duration-300"
                style={{ 
                  width: migrationProgress.total > 0 
                    ? `${(migrationProgress.current / migrationProgress.total) * 100}%` 
                    : '0%' 
                }}
              />
            </div>
          </div>
          
          {migrationProgress.error && (
            <div className="text-red-400 text-sm">
              ⚠️ {migrationProgress.error}
            </div>
          )}
        </div>
      )}

      {migrationResult && (
        <div className={`mb-4 p-4 rounded-md ${
          migrationResult.success ? 'bg-green-800 border border-green-600' : 'bg-red-800 border border-red-600'
        }`}>
          <div className="flex items-start">
            <span className="text-2xl mr-2">
              {migrationResult.success ? '✅' : '❌'}
            </span>
            <div className="flex-1">
              <p className={`font-semibold ${
                migrationResult.success ? 'text-green-200' : 'text-red-200'
              }`}>
                {migrationResult.success ? 'Migration Completed!' : 'Migration Failed'}
              </p>
              
              {migrationResult.summary && (
                <pre className={`text-sm mt-2 whitespace-pre-wrap ${
                  migrationResult.success ? 'text-green-300' : 'text-red-300'
                }`}>
                  {migrationResult.summary}
                </pre>
              )}
              
              {migrationResult.error && (
                <details className="mt-2">
                  <summary className={`text-sm cursor-pointer ${
                    migrationResult.success ? 'text-green-300' : 'text-red-300'
                  }`}>
                    View Error Details
                  </summary>
                  <pre className={`text-xs mt-1 p-2 bg-gray-900 rounded whitespace-pre-wrap ${
                    migrationResult.success ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {migrationResult.error}
                  </pre>
                </details>
              )}
              
              {migrationResult.success && (
                <p className="text-green-300 text-sm mt-2">
                  🎉 Your data is now stored in Turso cloud database with native vector search!
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500">
        <p>ℹ️ This migration copies assistant settings and RAG data to Turso cloud database.</p>
        <p>Chat history stays private on your device. Your local data remains unchanged for safety.</p>
      </div>
    </div>
  );
};

export default MigrationPanel;