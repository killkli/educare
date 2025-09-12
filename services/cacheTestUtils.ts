/// <reference lib="dom" />
/// <reference lib="web" />

// No declaration needed, using window.performance in tests

import { ragCacheManagerV2 } from './ragCacheManagerV2';
import { RagChunk } from '../types';

/**
 * Benchmark test result
 */
interface BenchmarkResult {
  testName: string;
  totalQueries: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  averageQueryTime: number;
  averageCacheHitTime: number;
  averageFullRagTime: number;
  performanceGain: number; // Percentage improvement
  results: Array<{
    query: string;
    fromCache: boolean;
    queryTime: number;
    similarity?: number;
  }>;
}

/**
 * Test data for cache benchmarking
 */
const testQueries = [
  // Similar questions that should hit cache
  '公司的年假政策是什麼？',
  '年假政策的詳細規定為何？',
  '關於年假的規定',
  '請問年假怎麼申請？',
  '年假申請流程是什麼？',

  // Different topic
  '公司的加班費怎麼計算？',
  '加班費計算方式',
  '加班補償規定',

  // Another different topic
  '請假需要什麼手續？',
  '病假申請流程',
  '事假怎麼請？',

  // Technical questions
  '系統登入問題',
  '密碼忘記怎麼辦？',
  '帳號被鎖定',

  // Benefits related
  '員工福利有哪些？',
  '保險相關規定',
  '退休金制度',
];

/**
 * Generate mock RAG chunks for testing
 */
function generateMockRagChunks(): RagChunk[] {
  return [
    {
      fileName: 'employee-handbook.pdf',
      content:
        '年假申請流程：員工需於休假前7天提出申請，填寫年假申請表，經主管核准後送人資部登記。年假天數依照勞基法規定，服務滿一年者給予7天年假。',
      vector: new Array(128).fill(0).map(() => Math.random()),
    },
    {
      fileName: 'overtime-policy.pdf',
      content:
        '加班費計算：平日加班前2小時以1.33倍計算，超過2小時以1.66倍計算。假日加班一律以2倍計算。加班需事前申請並獲得主管核准。',
      vector: new Array(128).fill(0).map(() => Math.random()),
    },
    {
      fileName: 'leave-policy.pdf',
      content:
        '請假規定：病假需附醫師證明，事假需提前3天申請。請假超過3天需填寫長期請假單。所有請假都需要主管簽核。',
      vector: new Array(128).fill(0).map(() => Math.random()),
    },
    {
      fileName: 'it-support.pdf',
      content:
        '系統登入問題：忘記密碼請聯絡IT部門重設，帳號被鎖定請提供員工編號申請解鎖。系統維護時間為每日凌晨2-4點。',
      vector: new Array(128).fill(0).map(() => Math.random()),
    },
    {
      fileName: 'benefits.pdf',
      content:
        '員工福利：包含勞健保、團體保險、年終獎金、員工旅遊、健康檢查等。退休金依勞退新制提撥，公司額外提撥2%。',
      vector: new Array(128).fill(0).map(() => Math.random()),
    },
  ];
}

/**
 * Run cache benchmark test
 */
export async function runCacheBenchmark(
  testName = 'Cache Performance Test',
  queries: string[] = testQueries,
  assistantId = 'test-assistant-benchmark',
): Promise<BenchmarkResult> {
  console.log(`🧪 Starting cache benchmark: ${testName}`);

  // Clear existing cache for this test
  await ragCacheManagerV2.clearAssistantCache(assistantId);
  ragCacheManagerV2.resetMetrics();

  const mockRagChunks = generateMockRagChunks();
  const results: BenchmarkResult['results'] = [];

  console.log(`📝 Testing with ${queries.length} queries and ${mockRagChunks.length} RAG chunks`);

  // Run queries twice to test cache behavior
  const allQueries = [...queries, ...queries]; // Run each query twice

  for (let i = 0; i < allQueries.length; i++) {
    const query = allQueries[i];
    const isSecondRun = i >= queries.length;

    console.log(
      `🔍 Query ${i + 1}/${allQueries.length}: "${query}" ${isSecondRun ? '(cache test)' : '(first run)'}`,
    );

    try {
      const startTime = Date.now();

      const result = await ragCacheManagerV2.performCachedRagQuery(
        query,
        assistantId,
        mockRagChunks,
        {
          similarityThreshold: 0.9,
          rerankLimit: 5,
          enableReranking: true,
          enableCache: true,
        },
      );

      const endTime = Date.now();
      const actualQueryTime = endTime - startTime;

      results.push({
        query: `${query} ${isSecondRun ? '(2nd)' : '(1st)'}`,
        fromCache: result.fromCache,
        queryTime: actualQueryTime,
        similarity: result.cacheStats?.similarity,
      });

      console.log(`${result.fromCache ? '🎯 HIT' : '💾 MISS'} - ${actualQueryTime}ms`);

      // Small delay between queries to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`❌ Query failed: "${query}"`, error);
      results.push({
        query: `${query} (ERROR)`,
        fromCache: false,
        queryTime: 0,
      });
    }
  }

  // Get final metrics
  const metrics = ragCacheManagerV2.getMetrics();

  const performanceGain =
    metrics.averageFullRagTime > 0
      ? ((metrics.averageFullRagTime - metrics.averageCacheHitTime) / metrics.averageFullRagTime) *
        100
      : 0;

  const benchmarkResult: BenchmarkResult = {
    testName,
    totalQueries: metrics.totalQueries,
    cacheHits: metrics.cacheHits,
    cacheMisses: metrics.cacheMisses,
    hitRate: metrics.hitRate,
    averageQueryTime: metrics.averageQueryTime,
    averageCacheHitTime: metrics.averageCacheHitTime,
    averageFullRagTime: metrics.averageFullRagTime,
    performanceGain,
    results,
  };

  console.log('✅ Benchmark completed:');
  console.log(`   Total queries: ${benchmarkResult.totalQueries}`);
  console.log(
    `   Cache hits: ${benchmarkResult.cacheHits} (${(benchmarkResult.hitRate * 100).toFixed(1)}%)`,
  );
  console.log(`   Average query time: ${benchmarkResult.averageQueryTime.toFixed(1)}ms`);
  console.log(`   Performance gain: ${benchmarkResult.performanceGain.toFixed(1)}%`);

  return benchmarkResult;
}

/**
 * Test similarity threshold effectiveness
 */
export async function testSimilarityThresholds(
  baseQuery = '公司的年假政策是什麼？',
  assistantId = 'similarity-test-assistant',
): Promise<
  Array<{
    threshold: number;
    testQuery: string;
    hit: boolean;
    similarity: number;
  }>
> {
  console.log('🎯 Testing similarity thresholds...');

  // await ragCacheManagerV2.clearAssistantCache(assistantId);
  const mockRagChunks = generateMockRagChunks();

  // First, cache the base query
  await ragCacheManagerV2.performCachedRagQuery(baseQuery, assistantId, mockRagChunks, {
    enableCache: true,
  });

  const testCases = [
    { threshold: 0.95, query: '年假政策的詳細規定為何？' },
    { threshold: 0.9, query: '關於年假的規定' },
    { threshold: 0.85, query: '請問年假怎麼申請？' },
    { threshold: 0.8, query: '年假申請流程' },
    { threshold: 0.7, query: '公司休假制度' },
  ];

  const results = [];

  for (const testCase of testCases) {
    ragCacheManagerV2.configureCacheSettings({
      similarityThreshold: testCase.threshold,
    });

    const result = await ragCacheManagerV2.performCachedRagQuery(
      testCase.query,
      assistantId,
      mockRagChunks,
      { enableCache: true },
    );

    const similarity = result.cacheStats?.similarity || 0;

    results.push({
      threshold: testCase.threshold,
      testQuery: testCase.query,
      hit: result.fromCache,
      similarity,
    });

    console.log(
      `Threshold ${testCase.threshold}: "${testCase.query}" → ${result.fromCache ? 'HIT' : 'MISS'} (similarity: ${similarity.toFixed(4)})`,
    );
  }

  return results;
}

/**
 * Memory usage test
 */
export async function testMemoryUsage(
  numQueries = 100,
  assistantId = 'memory-test-assistant',
): Promise<{
  initialMemory: number;
  finalMemory: number;
  memoryIncrease: number;
  queriesPerMB: number;
}> {
  console.log(`🧠 Testing memory usage with ${numQueries} queries...`);

  // Clear cache first
  await ragCacheManagerV2.clearAssistantCache(assistantId);

  const initialMemory = (window.performance?.memory?.usedJSHeapSize as number) || 0;
  const mockRagChunks = generateMockRagChunks();

  // Generate diverse queries to avoid too many cache hits
  const queries = [];
  for (let i = 0; i < numQueries; i++) {
    queries.push(
      `Test query ${i}: ${testQueries[i % testQueries.length]} - variation ${Math.floor(i / testQueries.length)}`,
    );
  }

  console.log('Running queries...');
  for (const query of queries) {
    await ragCacheManagerV2.performCachedRagQuery(query, assistantId, mockRagChunks, {
      enableCache: true,
    });

    // Small delay to prevent overwhelming
    if (queries.indexOf(query) % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  const finalMemory = (window.performance?.memory?.usedJSHeapSize as number) || 0;
  const memoryIncrease = finalMemory - initialMemory;
  const queriesPerMB = memoryIncrease > 0 ? numQueries / (memoryIncrease / 1024 / 1024) : 0;

  console.log('Memory test results:');
  console.log(`  Initial memory: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Final memory: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Queries per MB: ${queriesPerMB.toFixed(1)}`);

  return {
    initialMemory,
    finalMemory,
    memoryIncrease,
    queriesPerMB,
  };
}

/**
 * Export test functions to global scope for console access
 */
if (typeof window !== 'undefined') {
  (
    window as unknown as {
      cacheTests?: {
        runBenchmark: typeof runCacheBenchmark;
        testSimilarity: typeof testSimilarityThresholds;
        testMemory: typeof testMemoryUsage;
        manager: typeof ragCacheManagerV2;
      };
    }
  ).cacheTests = {
    runBenchmark: runCacheBenchmark,
    testSimilarity: testSimilarityThresholds,
    testMemory: testMemoryUsage,
    manager: ragCacheManagerV2,
  };
  console.log('🧪 Cache testing tools available as window.cacheTests');
}
