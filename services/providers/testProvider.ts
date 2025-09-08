import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';

// Simple test provider that doesn't use any external dependencies
export class TestProvider implements LLMProvider {
  readonly name = 'test';
  readonly displayName = 'Test Provider';
  readonly supportedModels = ['test-model'];
  readonly requiresApiKey = false;
  readonly supportsLocalMode = true;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  isAvailable(): boolean {
    return true; // Always available for testing
  }

  reinitialize(): void {
    // Nothing to do
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    const response = `Test response to: ${params.message}`;

    // Simulate streaming by yielding chunks
    for (let i = 0; i < response.length; i += 5) {
      const chunk = response.slice(i, i + 5);

      yield {
        text: chunk,
        isComplete: false,
        metadata: {
          model: 'test-model',
          provider: this.name,
        },
      };

      // Small delay to simulate real streaming
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Final completion message
    yield {
      text: '',
      isComplete: true,
      metadata: {
        promptTokenCount: 10,
        candidatesTokenCount: response.length,
        model: 'test-model',
        provider: this.name,
      },
    };
  }
}
