import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

interface ModelTestResult {
  modelName: string;
  response: string;
  responseTime: number;
  error?: string;
  timestamp: Date;
}

interface ComparisonTest {
  testName: string;
  prompt: string;
  expectedPatterns?: string[];
  category: 'creative' | 'factual' | 'coding' | 'reasoning';
}

test.describe('Model Comparison Testing Suite', () => {
  const testPrompts: ComparisonTest[] = [
    {
      testName: 'Creative Writing',
      prompt: '寫一個關於貓咪探險的短故事，大約50字。',
      category: 'creative',
    },
    {
      testName: 'Math Problem',
      prompt: '如果一個蘋果3元，買5個蘋果需要多少錢？請解釋計算過程。',
      expectedPatterns: ['15', '3 × 5', '3 * 5'],
      category: 'reasoning',
    },
    {
      testName: 'Code Generation',
      prompt: '用JavaScript寫一個函數來計算兩個數字的和。',
      expectedPatterns: ['function', '+', 'return'],
      category: 'coding',
    },
    {
      testName: 'Factual Question',
      prompt: '台灣的首都是哪裡？',
      expectedPatterns: ['台北', '台北市'],
      category: 'factual',
    },
    {
      testName: 'Complex Reasoning',
      prompt: '如果今天是星期三，那麼10天後是星期幾？請說明推理過程。',
      expectedPatterns: ['星期六', '週六'],
      category: 'reasoning',
    },
  ];

  const allModelResults: ModelTestResult[] = [];
  const testStartTime = new Date();

  test('should test multiple free models and collect results', async ({ page }) => {
    test.setTimeout(3600_000); // 5 minutes for comprehensive testing

    const openrouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterApiKey) {
      test.skip('OPENROUTER_API_KEY environment variable is required for this test');
    }

    // Handle dialogs
    page.on('dialog', dialog => dialog.accept());

    console.log('🚀 Starting Multi-Model Comparison Test');
    console.log(`📊 Testing ${testPrompts.length} different prompts`);

    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('networkidle');

    // Setup OpenRouter API
    await setupOpenRouterAPI(page, openrouterApiKey!);

    // Get available free models (models were already fetched in setupOpenRouterAPI)
    const freeModels = await getAvailableFreeModels(page);
    console.log(`🆓 Found ${freeModels.length} free models:`, freeModels);

    // Test each model with each prompt
    for (const model of freeModels) {
      console.log(`\n🤖 Testing model: ${model}`);

      // Select the model
      await selectModel(page, model);

      // Test each prompt
      for (const testPrompt of testPrompts) {
        console.log(`  📝 Testing: ${testPrompt.testName}`);
        const startTime = Date.now();

        try {
          const response = await testModelWithPrompt(page, testPrompt, model);
          const responseTime = Date.now() - startTime;

          const result: ModelTestResult = {
            modelName: model,
            response,
            responseTime,
            timestamp: new Date(),
          };

          allModelResults.push(result);
          console.log(
            `  ✅ ${testPrompt.testName}: ${responseTime}ms - Response preview: "${response.substring(0, 50)}..."`,
          );
        } catch (error) {
          const result: ModelTestResult = {
            modelName: model,
            response: '',
            responseTime: Date.now() - startTime,
            error: error?.toString(),
            timestamp: new Date(),
          };

          allModelResults.push(result);
          console.log(
            `  ❌ ${testPrompt.testName}: Failed after ${Date.now() - startTime}ms - Error: ${error}`,
          );

          // Take screenshot for debugging failed tests
          try {
            await page.screenshot({
              path: `test-reports/error-${model.replace(/[^a-zA-Z0-9]/g, '_')}-${testPrompt.testName.replace(/[^a-zA-Z0-9]/g, '_')}.png`,
              fullPage: true,
            });
          } catch (screenshotError) {
            console.log(`  📸 Could not take error screenshot: ${screenshotError}`);
          }
        }

        // Wait between tests to avoid rate limiting
        await page.waitForTimeout(2000);
      }
    }

    // Generate comparison report
    await generateComparisonReport(allModelResults, testPrompts);
    console.log('\n📈 Comparison report generated successfully!');
  });

  async function setupOpenRouterAPI(page: import('@playwright/test').Page, apiKey: string) {
    // Open settings
    await page.waitForSelector('button:has-text("設定")', { timeout: 90000 });
    await page.click('button:has-text("設定")');

    // Open provider settings
    await page.waitForSelector('button:has-text("AI 服務商設定")', { timeout: 90000 });
    await page.click('button:has-text("AI 服務商設定")', { force: true });

    // Enable OpenRouter
    await page
      .locator('div.space-y-4 > div:has-text("OpenRouter") label.flex.items-center.cursor-pointer')
      .click();
    await page.waitForTimeout(1000);

    // Expand OpenRouter section
    await page.locator('div.space-y-4 > div:has-text("OpenRouter") div.p-6.cursor-pointer').click();
    await page.waitForTimeout(1000);

    // Fill API Key
    const apiKeyInput = page.locator('input[placeholder*="OpenRouter API Key"]');
    await expect(apiKeyInput).toBeVisible({ timeout: 60000 });
    await apiKeyInput.fill(apiKey);

    // Select OpenRouter as active provider
    await page
      .locator('div.mb-8 > div.grid > div.p-4:has(span.font-semibold:has-text("OpenRouter"))')
      .click();

    // Close settings
    await page
      .locator('button:has([stroke="currentColor"]):has([d*="M6 18L18 6M6 6l12 12"])')
      .click();
    await page.waitForTimeout(1000);
  }

  async function getAvailableFreeModels(page: import('@playwright/test').Page): Promise<string[]> {
    // Re-open settings to get model list (models were already fetched in setupOpenRouterAPI)
    await page.click('button:has-text("設定")');
    await page.click('button:has-text("AI 服務商設定")', { force: true });
    await page.locator('div.space-y-4 > div:has-text("OpenRouter") div.p-6.cursor-pointer').click();

    // Fetch models
    const fetchModelsButton = page.locator(
      'div.space-y-4 > div:has-text("OpenRouter") button:has-text("🔄 獲取模型列表")',
    );
    await fetchModelsButton.click();
    await page.waitForTimeout(5000);

    // Wait for loading to complete
    await page.waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const hasLoadingButton = buttons.some(
          btn => btn.textContent && btn.textContent.includes('獲取中'),
        );
        return !hasLoadingButton;
      },
      { timeout: 30000 },
    );

    // Get the model list (should already be populated from setupOpenRouterAPI)
    const modelSelect = page.locator('div.space-y-4 > div:has-text("OpenRouter") select');
    await expect(modelSelect).toBeVisible({ timeout: 60000 });
    const options = await modelSelect.locator('option').allTextContents();
    console.log(`📋 Total models available: ${options.length}`);

    // Look for commonly free models by pattern matching
    const likelyFreeModels = options.filter(option => {
      const lowerOption = option.toLowerCase();
      return lowerOption.endsWith('free');
    });

    // Combine explicit and likely free models, removing duplicates
    const combinedFreeModels = [...new Set([...likelyFreeModels])];

    console.log(`📊 Found ${combinedFreeModels.length} potential free models:`, combinedFreeModels);

    // Close settings
    await page
      .locator('button:has([stroke="currentColor"]):has([d*="M6 18L18 6M6 6l12 12"])')
      .click();

    // Return ALL free models, with fallback to first few options if none detected
    if (combinedFreeModels.length > 0) {
      return combinedFreeModels.length > 10 ? combinedFreeModels.slice(1, 11) : combinedFreeModels;
    } else {
      console.log('⚠️ No free models detected, using first 3 options as fallback');
      return options.length > 3 ? options.slice(1, 4) : options; // Skip first (usually "Select model") option
    }
  }

  async function selectModel(page: import('@playwright/test').Page, modelName: string) {
    // Open settings
    await page.click('button:has-text("設定")');
    await page.click('button:has-text("AI 服務商設定")', { force: true });
    await page.locator('div.space-y-4 > div:has-text("OpenRouter") div.p-6.cursor-pointer').click();

    const fetchModelsButton = page.locator(
      'div.space-y-4 > div:has-text("OpenRouter") button:has-text("🔄 獲取模型列表")',
    );
    await fetchModelsButton.click();
    await page.waitForTimeout(5000);

    // Select the model
    const modelSelect = page.locator('div.space-y-4 > div:has-text("OpenRouter") select');
    await modelSelect.selectOption({ label: modelName });

    // Close settings
    await page
      .locator('button:has([stroke="currentColor"]):has([d*="M6 18L18 6M6 6l12 12"])')
      .click();
    await page.waitForTimeout(1000);
  }

  async function testModelWithPrompt(
    page: import('@playwright/test').Page,
    testPrompt: ComparisonTest,
    modelName: string,
  ): Promise<string> {
    // Create new assistant for this model test
    await page
      .locator('button:has(svg[viewBox="0 0 24 24"]:has([d*="M12 4v16m8-8H4"]))')
      .first()
      .click();
    await page.waitForTimeout(1000);

    // Fill assistant form
    await page.locator('input').first().fill(`${testPrompt.testName} - ${modelName}`);
    await page
      .locator('input, textarea')
      .nth(1)
      .fill(`Testing ${modelName} with ${testPrompt.category} prompt`);

    const systemPromptTextarea = page.locator('textarea').last();
    await systemPromptTextarea.clear();
    await systemPromptTextarea.fill(
      'You are a helpful assistant. Please provide clear and concise responses.',
    );

    // Save assistant
    await page.locator('button:has-text("保存助理")').click();
    await page.waitForTimeout(2000);

    // Wait for chat interface
    await page.waitForSelector('[aria-label="聊天記錄"]', { timeout: 60000 });

    // Start new chat
    await page.locator('button:has-text("新增聊天")').click();
    await expect(page.locator('textarea[placeholder*="訊息"]')).toBeVisible({ timeout: 60000 });

    // Send test prompt
    await page.locator('textarea[placeholder*="訊息"]').fill(testPrompt.prompt);
    await page.locator('textarea[placeholder*="訊息"]').press('Shift+Enter');

    // Wait for response with better logging
    console.log(`    🔄 Waiting for response from ${modelName}...`);

    try {
      await page.waitForFunction(
        () => {
          const textarea = document.querySelector('textarea[placeholder*="訊息"]');
          return textarea && !textarea.disabled;
        },
        { timeout: 120000 }, // Increased timeout to 2 minutes for slow models
      );
      console.log(`    ✅ Response received from ${modelName}`);
    } catch (timeoutError) {
      console.log(`    ⏰ Timeout waiting for response from ${modelName}`);
      throw new Error(`Timeout waiting for response from ${modelName}: ${timeoutError}`);
    }

    // Extract response from MessageBubble components (AI responses)
    const responseText = await page.evaluate(() => {
      // 尋找 AI 助理的回應訊息氣泡（包含 GeminiIcon 的）
      const messageBubbles = Array.from(document.querySelectorAll('div')).filter(el => {
        const hasGeminiIcon =
          el.querySelector('svg') &&
          (el.innerHTML.includes('GeminiIcon') ||
            el.classList.contains('from-gray-700') ||
            el.querySelector('.text-cyan-400'));
        const hasMessageContent = el.textContent && el.textContent.trim().length > 10;
        return hasGeminiIcon && hasMessageContent;
      });

      // 如果有 MessageBubble，提取最新的 AI 回應
      if (messageBubbles.length > 0) {
        const latestBubble = messageBubbles[messageBubbles.length - 1];
        const messageContent = latestBubble.textContent || '';

        // 過濾掉 UI 元素文字，只保留實際回應內容
        const cleanedContent = messageContent
          .replace(/複製訊息|複製回應|複製/g, '')
          .replace(/\d{2}:\d{2}/g, '') // 移除時間戳
          .replace(/正在輸入\.\.\./g, '')
          .trim();

        return cleanedContent.length > 10 ? cleanedContent : 'Response too short';
      }

      // 後備：尋找 StreamingResponse 組件
      const streamingElements = Array.from(document.querySelectorAll('div')).filter(el => {
        return (
          el.textContent &&
          el.textContent.includes('正在輸入') === false &&
          el.classList &&
          (el.classList.contains('bg-gray-800') ||
            el.classList.contains('backdrop-blur-sm') ||
            el.parentElement?.classList?.contains('justify-start'))
        );
      });

      if (streamingElements.length > 0) {
        const content = streamingElements[streamingElements.length - 1].textContent || '';
        const cleanedContent = content
          .replace(/複製/g, '')
          .replace(/\d{2}:\d{2}/g, '')
          .trim();
        return cleanedContent.length > 10
          ? cleanedContent
          : 'Streaming response captured but too short';
      }

      return 'No AI response captured - please check UI structure';
    });

    return responseText.trim();
  }

  async function generateComparisonReport(
    results: ModelTestResult[],
    testPrompts: ComparisonTest[],
  ) {
    const reportData = {
      testMetadata: {
        startTime: testStartTime,
        endTime: new Date(),
        totalTests: results.length,
        testPrompts: testPrompts,
      },
      modelResults: groupResultsByModel(results, testPrompts),
      analytics: generateAnalytics(results, testPrompts),
    };

    // Create reports directory
    const reportsDir = path.join(process.cwd(), 'test-reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Generate JSON report
    const jsonPath = path.join(reportsDir, `model-comparison-${Date.now()}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));

    // Generate HTML report
    const htmlPath = path.join(reportsDir, `model-comparison-${Date.now()}.html`);
    fs.writeFileSync(htmlPath, generateHTMLReport(reportData));

    console.log('📄 Reports saved:');
    console.log(`  JSON: ${jsonPath}`);
    console.log(`  HTML: ${htmlPath}`);
  }

  function groupResultsByModel(results: ModelTestResult[], testPrompts: ComparisonTest[]) {
    const grouped: Record<string, any> = {};

    results.forEach((result, index) => {
      const testIndex = index % testPrompts.length;
      const testPrompt = testPrompts[testIndex];

      if (!grouped[result.modelName]) {
        grouped[result.modelName] = {
          modelName: result.modelName,
          tests: {},
          averageResponseTime: 0,
          successRate: 0,
        };
      }

      grouped[result.modelName].tests[testPrompt.testName] = {
        prompt: testPrompt.prompt,
        category: testPrompt.category,
        response: result.response,
        responseTime: result.responseTime,
        error: result.error,
        timestamp: result.timestamp,
        score: calculateResponseScore(result, testPrompt),
      };
    });

    // Calculate averages
    Object.values(grouped).forEach((modelData: any) => {
      const tests = Object.values(modelData.tests);
      modelData.averageResponseTime =
        tests.reduce((sum: number, test: any) => sum + test.responseTime, 0) / tests.length;
      modelData.successRate =
        (tests.filter((test: any) => !test.error).length / tests.length) * 100;
    });

    return grouped;
  }

  function calculateResponseScore(result: ModelTestResult, testPrompt: ComparisonTest): number {
    if (result.error) {
      return 0;
    }

    let score = 50; // Base score

    // Response length (reasonable length gets points)
    if (result.response.length > 20 && result.response.length < 500) {
      score += 20;
    }

    // Expected patterns match
    if (testPrompt.expectedPatterns) {
      const matchCount = testPrompt.expectedPatterns.filter(pattern =>
        result.response.toLowerCase().includes(pattern.toLowerCase()),
      ).length;
      score += (matchCount / testPrompt.expectedPatterns.length) * 30;
    }

    return Math.min(100, score);
  }

  function generateAnalytics(results: ModelTestResult[], testPrompts: ComparisonTest[]) {
    const models = [...new Set(results.map(r => r.modelName))];

    return {
      modelCount: models.length,
      testCount: testPrompts.length,
      totalResponseTime: results.reduce((sum, r) => sum + r.responseTime, 0),
      averageResponseTime: results.reduce((sum, r) => sum + r.responseTime, 0) / results.length,
      successRate: (results.filter(r => !r.error).length / results.length) * 100,
      categoryBreakdown: testPrompts.reduce((acc: Record<string, number>, prompt) => {
        acc[prompt.category] = (acc[prompt.category] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  function generateHTMLReport(reportData: Record<string, any>): string {
    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI 模型比較報告</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 40px; }
        .header h1 { color: #2563eb; margin: 0 0 10px 0; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 40px; }
        .stat-card { background: #f8fafc; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-card h3 { margin: 0 0 10px 0; color: #64748b; font-size: 14px; font-weight: 500; }
        .stat-card .value { font-size: 24px; font-weight: 700; color: #1e293b; }
        .model-section { margin-bottom: 40px; }
        .model-header { background: #3b82f6; color: white; padding: 15px 20px; border-radius: 8px 8px 0 0; }
        .model-content { border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; }
        .test-result { padding: 20px; border-bottom: 1px solid #f1f5f9; }
        .test-result:last-child { border-bottom: none; }
        .test-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .test-title { font-weight: 600; color: #1e293b; }
        .test-meta { font-size: 12px; color: #64748b; }
        .category-badge { display: inline-block; background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 500; }
        .response-text { background: #f8fafc; padding: 15px; border-radius: 6px; margin-top: 10px; border-left: 4px solid #3b82f6; }
        .score { font-weight: 600; }
        .score.good { color: #059669; }
        .score.medium { color: #d97706; }
        .score.poor { color: #dc2626; }
        .error { color: #dc2626; font-style: italic; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 AI 模型比較測試報告</h1>
            <p>測試時間: ${reportData.testMetadata.startTime.toLocaleString('zh-TW')} - ${reportData.testMetadata.endTime.toLocaleString('zh-TW')}</p>
        </div>

        <div class="stats">
            <div class="stat-card">
                <h3>測試模型數量</h3>
                <div class="value">${reportData.analytics.modelCount}</div>
            </div>
            <div class="stat-card">
                <h3>測試項目數量</h3>
                <div class="value">${reportData.analytics.testCount}</div>
            </div>
            <div class="stat-card">
                <h3>平均回應時間</h3>
                <div class="value">${Math.round(reportData.analytics.averageResponseTime)}ms</div>
            </div>
            <div class="stat-card">
                <h3>成功率</h3>
                <div class="value">${Math.round(reportData.analytics.successRate)}%</div>
            </div>
        </div>

        ${Object.values(reportData.modelResults)
          .map(
            (model: any) => `
        <div class="model-section">
            <div class="model-header">
                <h2>${model.modelName}</h2>
                <div>平均回應時間: ${Math.round(model.averageResponseTime)}ms | 成功率: ${Math.round(model.successRate)}%</div>
            </div>
            <div class="model-content">
                ${Object.values(model.tests)
                  .map(
                    (test: any) => `
                <div class="test-result">
                    <div class="test-header">
                        <div class="test-title">${test.prompt}</div>
                        <div class="test-meta">
                            <span class="category-badge">${test.category}</span>
                            <span class="score ${test.score >= 80 ? 'good' : test.score >= 60 ? 'medium' : 'poor'}">
                                評分: ${Math.round(test.score)}/100
                            </span>
                            ${test.responseTime}ms
                        </div>
                    </div>
                    ${
                      test.error
                        ? `<div class="error">錯誤: ${test.error}</div>`
                        : `
                    <div class="response-text">${test.response}</div>
                    `
                    }
                </div>
                `,
                  )
                  .join('')}
            </div>
        </div>
        `,
          )
          .join('')}
    </div>
</body>
</html>`;
  }
});
