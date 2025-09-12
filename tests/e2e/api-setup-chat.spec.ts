import { test, expect } from '@playwright/test';

test.describe('OpenRouter API Setup and Chat Flow', () => {
  test('should use real OpenRouter API key, fetch models, select free model, and complete chat', async ({
    page,
  }) => {
    test.setTimeout(180000); // Increase timeout for real API calls

    // Check if OPENROUTER_API_KEY is available
    const openrouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterApiKey) {
      test.skip('OPENROUTER_API_KEY environment variable is required for this test');
    }

    // Handle any dialogs (e.g., alerts from test connection)
    page.on('dialog', dialog => dialog.accept());
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('networkidle');

    // Open settings
    await page.waitForSelector('button:has-text("設定")', { timeout: 60000 });
    await page.click('button:has-text("設定")');
    await expect(page.locator('h2:has-text("設定")')).toBeVisible({ timeout: 60000 });

    // Open provider settings
    await page.waitForSelector('button:has-text("AI 服務商設定")', { timeout: 60000 });
    await page.click('button:has-text("AI 服務商設定")', { force: true });
    await expect(page.locator('h2:has-text("AI 服務商設定")')).toBeVisible({ timeout: 60000 });

    // Find and configure OpenRouter provider
    // Enable the provider toggle for OpenRouter
    await page
      .locator('div.space-y-4 > div:has-text("OpenRouter") label.flex.items-center.cursor-pointer')
      .click();
    await page.waitForTimeout(1000);

    // Expand the OpenRouter section by clicking on it
    await page.locator('div.space-y-4 > div:has-text("OpenRouter") div.p-6.cursor-pointer').click();
    await page.waitForTimeout(1000);

    // Fill API Key with real key from environment
    const apiKeyInput = page.locator('input[placeholder*="OpenRouter API Key"]');
    await expect(apiKeyInput).toBeVisible({ timeout: 60000 });
    await apiKeyInput.fill(openrouterApiKey!);

    // First click "獲取模型列表" button to fetch real models from API
    const fetchModelsButton = page.locator(
      'div.space-y-4 > div:has-text("OpenRouter") button:has-text("🔄 獲取模型列表")',
    );
    await expect(fetchModelsButton).toBeVisible({ timeout: 60000 });
    await fetchModelsButton.click();

    // Wait for loading to complete - look for the button to not be in loading state
    await page.waitForTimeout(5000); // Wait for API call to complete

    // Wait for the "獲取中" text to disappear and button to be re-enabled
    await page.waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const hasLoadingButton = buttons.some(
          btn => btn.textContent && btn.textContent.includes('獲取中'),
        );
        return !hasLoadingButton; // Return true when loading is complete
      },
      { timeout: 30000 },
    );

    await page.waitForTimeout(2000); // Additional wait for dropdown to populate

    // Now look for the model select dropdown with real API models
    const modelSelect = page.locator('div.space-y-4 > div:has-text("OpenRouter") select');
    await expect(modelSelect).toBeVisible({ timeout: 60000 });

    // Get all available options from the real API response
    const options = await modelSelect.locator('option').allTextContents();
    console.log('Real API available models:', options);

    // Look for free models in the real API response
    const freeModel = options.find(
      option =>
        option.toLowerCase().includes('free') ||
        option.toLowerCase().includes('gemma') ||
        (option.toLowerCase().includes('llama') && option.toLowerCase().includes('8b')) ||
        (option.toLowerCase().includes('qwen') && option.toLowerCase().includes('free')),
    );

    if (freeModel) {
      await modelSelect.selectOption({ label: freeModel });
      console.log(`Selected free model from real API: ${freeModel}`);
    } else {
      // Look for commonly free models by pattern matching
      const likelyFreeModel = options.find(
        option =>
          option.toLowerCase().includes('gemma') ||
          option.toLowerCase().includes('llama') ||
          option.toLowerCase().includes('qwen') ||
          (option.toLowerCase().includes('mistral') && option.toLowerCase().includes('7b')),
      );

      if (likelyFreeModel) {
        await modelSelect.selectOption({ label: likelyFreeModel });
        console.log(`Selected likely free model from real API: ${likelyFreeModel}`);
      } else {
        // Fallback to first non-default model
        if (options.length > 1) {
          await modelSelect.selectOption({ index: 1 });
          console.log(`Selected fallback model from real API: ${options[1]}`);
        }
      }
    }

    // Select OpenRouter as active provider in the active providers grid
    await page
      .locator('div.mb-8 > div.grid > div.p-4:has(span.font-semibold:has-text("OpenRouter"))')
      .click();
    await page.waitForTimeout(1000);

    // Close provider settings modal
    await page
      .locator('button:has([stroke="currentColor"]):has([d*="M6 18L18 6M6 6l12 12"])')
      .click();
    await page.waitForTimeout(1000);

    // Create new assistant
    await page.waitForSelector('button:has(svg[viewBox="0 0 24 24"]:has([d*="M12 4v16m8-8H4"]))', {
      timeout: 60000,
    });
    await page
      .locator('button:has(svg[viewBox="0 0 24 24"]:has([d*="M12 4v16m8-8H4"]))')
      .first()
      .click();
    await page.waitForTimeout(1000);

    // Fill out the assistant form
    await page.waitForSelector('input, textarea', { timeout: 60000 });
    await page.locator('input').first().fill('OpenRouter Test Assistant');
    await page
      .locator('input, textarea')
      .nth(1)
      .fill('Assistant for testing OpenRouter integration with real API');

    const systemPromptTextarea = page.locator('textarea').last();
    await systemPromptTextarea.clear();
    await systemPromptTextarea.fill(
      'You are a helpful assistant. Please respond briefly to test the OpenRouter API integration.',
    );

    // Save the assistant
    await page.locator('button:has-text("保存助理")').click();
    await page.waitForTimeout(2000);

    // Wait for chat interface to be ready
    await page.waitForSelector('[aria-label="聊天記錄"]', { timeout: 60000 });

    // Start new chat
    await page.locator('button:has-text("新增聊天")').click();
    await expect(page.locator('textarea[placeholder*="訊息"]')).toBeVisible({ timeout: 60000 });

    // Send test message using Shift+Enter
    const testMessage = 'Hello! Please respond with "TEST PASSED" if you can read this.';
    await page.locator('textarea[placeholder*="訊息"]').fill(testMessage);
    await page.locator('textarea[placeholder*="訊息"]').press('Shift+Enter');

    // Verify user message was sent and appears in chat
    await expect(page.locator(`text=${testMessage}`)).toBeVisible({ timeout: 10000 });

    // Wait for AI response with longer timeout for real API call
    // Look for a valid AI response that's not an error message
    await page.waitForFunction(
      () => {
        // Get all text elements that could contain chat messages
        const allElements = Array.from(document.querySelectorAll('*'));
        const messageElements = allElements.filter(el => {
          const text = el.textContent || '';
          return (
            text.trim().length > 0 &&
            !text.includes('Hello! Please respond with "TEST PASSED"') && // Not our sent message
            !text.includes('API KEY') && // Not API key related
            !text.includes('設定') && // Not settings
            !text.includes('button') && // Not button text
            !text.includes('placeholder') && // Not form placeholders
            !text.includes('Error') && // Not error messages
            !text.includes('錯誤') && // Not Chinese error messages
            !text.includes('失敗') && // Not failure messages
            !text.includes('無法') && // Not "unable to" messages
            !text.includes('請') && // Not instruction messages like "請輸入"
            (text.includes('TEST PASSED') || // Expected response
              text.includes('Hello') || // Response to greeting
              text.includes('Hi') || // Another greeting response
              text.toLowerCase().includes('yes') ||
              text.toLowerCase().includes('read') ||
              (text.length > 15 && text.split(' ').length > 3))
          ); // Substantial multi-word response
        });

        // Also check if we have streaming response indicators
        const hasValidResponse = messageElements.some(el => {
          const text = el.textContent || '';
          return (
            text.length > 10 &&
            !text.includes('OpenRouter') && // Not provider name
            !text.includes('模型') && // Not model selection text
            (text.includes('TEST PASSED') ||
              text.toLowerCase().includes('hello') ||
              text.toLowerCase().includes('hi') ||
              text.length > 20)
          ); // Longer response indicating actual AI generation
        });

        console.log('Checking for AI response...', {
          messageCount: messageElements.length,
          hasValidResponse,
        });
        return hasValidResponse;
      },
      { timeout: 60000 },
    );

    // Additional verification: wait for textarea to be re-enabled (indicating streaming completed)
    await page.waitForFunction(
      () => {
        const textarea = document.querySelector('textarea[placeholder*="訊息"]');
        return textarea && !textarea.disabled;
      },
      { timeout: 10000 },
    );

    console.log('✅ AI response detected and validated successfully');

    // Optional: Try to capture the actual response for logging
    try {
      const responseText = await page.evaluate(() => {
        const allElements = Array.from(document.querySelectorAll('*'));
        const responseElement = allElements.find(el => {
          const text = el.textContent || '';
          return (
            text.length > 20 &&
            !text.includes('Hello! Please respond with "TEST PASSED"') &&
            !text.includes('設定') &&
            !text.includes('API')
          );
        });
        return responseElement
          ? responseElement.textContent
          : 'Response detected but content not captured';
      });
      console.log('AI Response content:', responseText.substring(0, 100) + '...');
    } catch {
      console.log('Response detected successfully but could not capture text');
    }

    console.log('OpenRouter API integration test completed successfully');
  });
});
