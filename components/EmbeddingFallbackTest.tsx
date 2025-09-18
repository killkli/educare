import React, { useState } from 'react';
import {
  generateEmbeddingWithTimeout,
  generateEmbeddingRobust,
  cosineSimilarity,
} from '../services/embeddingService';

interface TestResult {
  id: number;
  name: string;
  vector?: number[];
  method?: string;
  processingTime?: number;
  error?: string;
}

export const EmbeddingFallbackTest: React.FC = () => {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [testText, setTestText] = useState('這是一個測試文本用來驗證 embedding fallback 機制');

  const addResult = (result: TestResult) => {
    setTestResults(prev => [...prev, result]);
  };

  const clearResults = () => {
    setTestResults([]);
  };

  const runTests = async () => {
    setIsRunning(true);
    clearResults();

    try {
      // Test 1: Normal timeout (should work or fallback quickly)
      addResult({ id: 1, name: 'Test 1: 正常 5 秒 timeout' });
      try {
        const result1 = await generateEmbeddingWithTimeout(testText, 'document', 5);
        addResult({
          id: 2,
          name: '✅ Test 1 結果',
          vector: result1.vector.slice(0, 5), // Show first 5 dimensions
          method: result1.method,
          processingTime: result1.processingTime,
        });
      } catch (error) {
        addResult({
          id: 2,
          name: '❌ Test 1 失敗',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Test 2: Very short timeout (should fallback to simple)
      addResult({ id: 3, name: 'Test 2: 0.1 秒 timeout (應觸發 fallback)' });
      try {
        const result2 = await generateEmbeddingWithTimeout(testText, 'document', 0.01);
        addResult({
          id: 4,
          name: '✅ Test 2 結果',
          vector: result2.vector.slice(0, 5),
          method: result2.method,
          processingTime: result2.processingTime,
        });
      } catch (error) {
        addResult({
          id: 4,
          name: '❌ Test 2 失敗',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Test 3: Robust wrapper
      addResult({ id: 5, name: 'Test 3: Robust wrapper' });
      try {
        const result3 = await generateEmbeddingRobust(testText, 'document');
        addResult({
          id: 6,
          name: '✅ Test 3 結果',
          vector: result3.slice(0, 5),
          method: 'robust-wrapper',
        });
      } catch (error) {
        addResult({
          id: 6,
          name: '❌ Test 3 失敗',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Test 4: Compare similarity
      const browserResult = testResults.find(r => r.id === 2);
      const simpleResult = testResults.find(r => r.id === 4);

      if (browserResult?.vector && simpleResult?.vector) {
        const similarity = cosineSimilarity(browserResult.vector, simpleResult.vector);
        addResult({
          id: 7,
          name: `📊 相似度比較: ${similarity.toFixed(4)}`,
        });
      }

      addResult({ id: 8, name: '🎉 所有測試完成！' });
    } catch (error) {
      addResult({
        id: 99,
        name: '❌ 測試過程發生錯誤',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className='max-w-4xl mx-auto p-6'>
      <h1 className='text-2xl font-bold mb-6'>Embedding Fallback 測試</h1>

      {/* Test Input */}
      <div className='mb-6'>
        <label className='block text-sm font-medium text-gray-700 mb-2'>測試文本</label>
        <textarea
          value={testText}
          onChange={e => setTestText(e.target.value)}
          className='w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
          rows={3}
          placeholder='輸入要測試的文本...'
        />
      </div>

      {/* Controls */}
      <div className='flex gap-3 mb-6'>
        <button
          onClick={runTests}
          disabled={isRunning || !testText.trim()}
          className='px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed'
        >
          {isRunning ? '執行中...' : '開始測試'}
        </button>

        <button
          onClick={clearResults}
          disabled={isRunning}
          className='px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed'
        >
          清除結果
        </button>
      </div>

      {/* Results */}
      <div className='space-y-3'>
        <h2 className='text-xl font-semibold'>測試結果</h2>

        {testResults.length === 0 && (
          <div className='text-gray-500 italic'>點擊「開始測試」來執行 embedding fallback 測試</div>
        )}

        {testResults.map(result => (
          <div key={result.id} className='p-4 border border-gray-200 rounded-lg bg-gray-50'>
            <div className='font-medium text-gray-900'>{result.name}</div>

            {result.method && (
              <div className='text-sm text-gray-600 mt-1'>
                方法: <span className='font-mono'>{result.method}</span>
              </div>
            )}

            {result.processingTime && (
              <div className='text-sm text-gray-600'>
                處理時間: <span className='font-mono'>{result.processingTime}ms</span>
              </div>
            )}

            {result.vector && (
              <div className='text-sm text-gray-600'>
                向量前 5 維:{' '}
                <span className='font-mono'>
                  [{result.vector.map(v => v.toFixed(4)).join(', ')}...]
                </span>
              </div>
            )}

            {result.error && (
              <div className='text-sm text-red-600 bg-red-50 p-2 rounded mt-2'>
                錯誤: {result.error}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Instructions */}
      <div className='mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg'>
        <h3 className='font-semibold text-blue-800 mb-2'>測試說明</h3>
        <ul className='text-sm text-blue-700 space-y-1'>
          <li>• Test 1: 正常的 5 秒 timeout，應該成功或快速 fallback</li>
          <li>• Test 2: 0.1 秒極短 timeout，應該立即 fallback 到簡單算法</li>
          <li>• Test 3: 使用 robust wrapper，確保向後兼容</li>
          <li>• 相似度比較: 檢查不同方法生成的向量相似程度</li>
        </ul>
      </div>
    </div>
  );
};
