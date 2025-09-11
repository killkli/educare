import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XLMRobertaModel, AutoTokenizer } from '@huggingface/transformers';
import { rerankChunks, preloadRerankerModel } from './embeddingService';
import { RagChunk } from '../types';

// Mock the transformers library
vi.mock('@huggingface/transformers', async () => {
  const actual = await vi.importActual('@huggingface/transformers');
  return {
    ...actual,
    XLMRobertaModel: {
      from_pretrained: vi.fn(),
    },
    AutoTokenizer: {
      from_pretrained: vi.fn(),
    },
    env: {
      allowLocalModels: false,
    },
  };
});

const mockXLMRobertaModel = XLMRobertaModel as unknown as {
  from_pretrained: ReturnType<typeof vi.fn>;
};
const mockAutoTokenizer = AutoTokenizer as unknown as {
  from_pretrained: ReturnType<typeof vi.fn>;
};

// Helper function to reset singleton instances
const resetRerankerSingleton = () => {
  const RerankerSingletonModule = require('./embeddingService');
  if (RerankerSingletonModule.RerankerSingleton) {
    RerankerSingletonModule.RerankerSingleton.modelInstance = null;
    RerankerSingletonModule.RerankerSingleton.tokenizerInstance = null;
    RerankerSingletonModule.RerankerSingleton.initPromise = null;
  }
};

describe('RerankerSingleton', () => {
  const mockChunks: RagChunk[] = [
    {
      fileName: 'file1.txt',
      content: 'This document explains machine learning fundamentals and neural networks.',
      vector: [0.1, 0.2, 0.3],
      relevanceScore: 0,
    },
    {
      fileName: 'file2.txt',
      content: 'A guide to cooking pasta and Italian cuisine recipes.',
      vector: [0.4, 0.5, 0.6],
      relevanceScore: 0,
    },
    {
      fileName: 'file3.txt',
      content: 'Deep learning architectures including transformers and attention mechanisms.',
      vector: [0.7, 0.8, 0.9],
      relevanceScore: 0,
    },
  ];

  const mockQuery = 'machine learning algorithms';

  beforeEach(() => {
    vi.clearAllMocks();
    resetRerankerSingleton();
  });

  afterEach(() => {
    resetRerankerSingleton();
  });

  it('should return empty array if chunks is empty', async () => {
    const result = await rerankChunks(mockQuery, []);
    expect(result).toEqual([]);

    // Should not try to load model or tokenizer
    expect(mockXLMRobertaModel.from_pretrained).not.toHaveBeenCalled();
    expect(mockAutoTokenizer.from_pretrained).not.toHaveBeenCalled();
  });

  it('should load reranker with WebGPU and process chunks correctly', async () => {
    const mockModel = {
      call: vi.fn().mockResolvedValue({
        logits: {
          sigmoid: () => ({
            tolist: () => [[0.85], [0.23], [0.91]], // ML chunks score higher than cooking
          }),
        },
      }),
    };

    const mockTokenizer = vi.fn().mockReturnValue({
      input_ids: [[1, 2, 3]], // Mock tokenized inputs
      attention_mask: [[1, 1, 1]],
    });

    mockXLMRobertaModel.from_pretrained.mockResolvedValue(mockModel);
    mockAutoTokenizer.from_pretrained.mockResolvedValue(mockTokenizer);

    const result = await rerankChunks(mockQuery, mockChunks, 2);

    // Verify model loading with WebGPU
    expect(mockXLMRobertaModel.from_pretrained).toHaveBeenCalledWith(
      'jinaai/jina-reranker-v2-base-multilingual',
      {
        device: 'webgpu',
        dtype: 'q8',
        progress_callback: undefined,
      },
    );
    expect(mockAutoTokenizer.from_pretrained).toHaveBeenCalledWith(
      'jinaai/jina-reranker-v2-base-multilingual',
    );

    // Verify tokenization with text pairs
    expect(mockTokenizer).toHaveBeenCalledWith([mockQuery, mockQuery, mockQuery], {
      text_pair: [
        'This document explains machine learning fundamentals and neural networks.',
        'A guide to cooking pasta and Italian cuisine recipes.',
        'Deep learning architectures including transformers and attention mechanisms.',
      ],
      padding: true,
      truncation: true,
    });

    // Verify results are sorted by relevance score (descending) and limited to topK
    expect(result).toHaveLength(2);
    expect(result[0].relevanceScore).toBe(0.91); // Deep learning chunk (highest)
    expect(result[1].relevanceScore).toBe(0.85); // ML fundamentals chunk (second)
    expect(result[0].content).toContain('Deep learning architectures');
    expect(result[1].content).toContain('machine learning fundamentals');

    // Cooking chunk should be filtered out (lowest score)
    expect(result.find(chunk => chunk.content.includes('cooking'))).toBeUndefined();
  });

  it('should fallback to CPU if WebGPU fails', async () => {
    const mockModel = {
      call: vi.fn().mockResolvedValue({
        logits: {
          sigmoid: () => ({
            tolist: () => [[0.72], [0.15]],
          }),
        },
      }),
    };

    const mockTokenizer = vi.fn().mockReturnValue({
      input_ids: [[1, 2, 3]],
      attention_mask: [[1, 1, 1]],
    });

    // Mock WebGPU failure, CPU success
    mockXLMRobertaModel.from_pretrained
      .mockRejectedValueOnce(new Error('WebGPU not supported'))
      .mockResolvedValueOnce(mockModel);
    mockAutoTokenizer.from_pretrained.mockResolvedValue(mockTokenizer);

    const testChunks = mockChunks.slice(0, 2); // Use only 2 chunks
    const result = await rerankChunks(mockQuery, testChunks, 2);

    // Verify WebGPU attempt
    expect(mockXLMRobertaModel.from_pretrained).toHaveBeenNthCalledWith(
      1,
      'jinaai/jina-reranker-v2-base-multilingual',
      {
        device: 'webgpu',
        dtype: 'q8',
        progress_callback: undefined,
      },
    );

    // Verify CPU fallback
    expect(mockXLMRobertaModel.from_pretrained).toHaveBeenNthCalledWith(
      2,
      'jinaai/jina-reranker-v2-base-multilingual',
      {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: undefined,
      },
    );

    expect(result).toHaveLength(2);
    expect(result[0].relevanceScore).toBe(0.72); // Higher score first
    expect(result[1].relevanceScore).toBe(0.15);
  });

  it('should handle text pair tokenization correctly', async () => {
    const mockModel = {
      call: vi.fn().mockResolvedValue({
        logits: {
          sigmoid: () => ({
            tolist: () => [[0.45], [0.88], [0.62]],
          }),
        },
      }),
    };

    const mockTokenizer = vi.fn().mockReturnValue({
      input_ids: [[1, 2, 3, 4, 5]],
      attention_mask: [[1, 1, 1, 1, 1]],
    });

    mockXLMRobertaModel.from_pretrained.mockResolvedValue(mockModel);
    mockAutoTokenizer.from_pretrained.mockResolvedValue(mockTokenizer);

    const result = await rerankChunks(mockQuery, mockChunks, 3);

    // Verify tokenizer called with proper text pair structure
    expect(mockTokenizer).toHaveBeenCalledWith(
      [mockQuery, mockQuery, mockQuery], // Queries repeated for each document
      {
        text_pair: [mockChunks[0].content, mockChunks[1].content, mockChunks[2].content],
        padding: true,
        truncation: true,
      },
    );

    // Verify model inference
    expect(mockModel.call).toHaveBeenCalledWith({
      input_ids: [[1, 2, 3, 4, 5]],
      attention_mask: [[1, 1, 1, 1, 1]],
    });

    // Verify results sorted by relevance score (descending)
    expect(result).toHaveLength(3);
    expect(result[0].relevanceScore).toBe(0.88); // Cooking (highest unexpectedly)
    expect(result[1].relevanceScore).toBe(0.62); // Deep learning
    expect(result[2].relevanceScore).toBe(0.45); // ML fundamentals
  });

  it('should limit to topK chunks', async () => {
    const mockModel = {
      call: vi.fn().mockResolvedValue({
        logits: {
          sigmoid: () => ({
            tolist: () => [[0.52], [0.73], [0.94]],
          }),
        },
      }),
    };

    const mockTokenizer = vi.fn().mockReturnValue({
      input_ids: [[1, 2, 3]],
      attention_mask: [[1, 1, 1]],
    });

    mockXLMRobertaModel.from_pretrained.mockResolvedValue(mockModel);
    mockAutoTokenizer.from_pretrained.mockResolvedValue(mockTokenizer);

    const result = await rerankChunks(mockQuery, mockChunks, 2);

    expect(result).toHaveLength(2); // Limited to topK=2
    expect(result[0].relevanceScore).toBe(0.94); // Highest score
    expect(result[1].relevanceScore).toBe(0.73); // Second highest

    // Third chunk (0.52) should be filtered out by topK limit
    expect(result.every(chunk => (chunk.relevanceScore ?? 0) >= 0.73)).toBe(true);
  });

  it('should throw if both WebGPU and CPU fail', async () => {
    const webGpuError = new Error('WebGPU initialization failed');
    const cpuError = new Error('CPU/WASM initialization failed');

    mockXLMRobertaModel.from_pretrained
      .mockRejectedValueOnce(webGpuError)
      .mockRejectedValueOnce(cpuError);

    await expect(rerankChunks(mockQuery, mockChunks)).rejects.toThrow(
      'Re-ranker failed: WebGPU Error: WebGPU initialization failed, CPU Error: CPU/WASM initialization failed',
    );
  });

  it('should handle single chunk correctly', async () => {
    const mockModel = {
      call: vi.fn().mockResolvedValue({
        logits: {
          sigmoid: () => ({
            tolist: () => [[0.67]],
          }),
        },
      }),
    };

    const mockTokenizer = vi.fn().mockReturnValue({
      input_ids: [[1, 2, 3]],
      attention_mask: [[1, 1, 1]],
    });

    mockXLMRobertaModel.from_pretrained.mockResolvedValue(mockModel);
    mockAutoTokenizer.from_pretrained.mockResolvedValue(mockTokenizer);

    const singleChunk = [mockChunks[0]];
    const result = await rerankChunks(mockQuery, singleChunk, 5);

    expect(result).toHaveLength(1);
    expect(result[0].relevanceScore).toBe(0.67);
    expect(result[0].fileName).toBe('file1.txt');

    // Verify tokenizer was called with single query-document pair
    expect(mockTokenizer).toHaveBeenCalledWith([mockQuery], {
      text_pair: [singleChunk[0].content],
      padding: true,
      truncation: true,
    });
  });

  it('should handle edge case where sigmoid returns undefined scores', async () => {
    const mockModel = {
      call: vi.fn().mockResolvedValue({
        logits: {
          sigmoid: () => ({
            tolist: () => [[undefined], [0.75]],
          }),
        },
      }),
    };

    const mockTokenizer = vi.fn().mockReturnValue({
      input_ids: [[1, 2, 3]],
      attention_mask: [[1, 1, 1]],
    });

    mockXLMRobertaModel.from_pretrained.mockResolvedValue(mockModel);
    mockAutoTokenizer.from_pretrained.mockResolvedValue(mockTokenizer);

    const testChunks = mockChunks.slice(0, 2);
    const result = await rerankChunks(mockQuery, testChunks, 2);

    expect(result).toHaveLength(2);
    expect(result[0].relevanceScore).toBe(0.75); // Valid score first
    expect(result[1].relevanceScore).toBe(0); // undefined score defaults to 0
  });
});

describe('preloadRerankerModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRerankerSingleton();
  });

  afterEach(() => {
    resetRerankerSingleton();
  });

  it('should preload the reranker model successfully', async () => {
    const mockModel = { call: vi.fn() };
    const mockTokenizer = vi.fn();

    mockXLMRobertaModel.from_pretrained.mockResolvedValue(mockModel);
    mockAutoTokenizer.from_pretrained.mockResolvedValue(mockTokenizer);

    await preloadRerankerModel();

    expect(mockXLMRobertaModel.from_pretrained).toHaveBeenCalledWith(
      'jinaai/jina-reranker-v2-base-multilingual',
      {
        device: 'webgpu',
        dtype: 'q8',
        progress_callback: undefined,
      },
    );
    expect(mockAutoTokenizer.from_pretrained).toHaveBeenCalledWith(
      'jinaai/jina-reranker-v2-base-multilingual',
    );
  });

  it('should preload with progress callback', async () => {
    const mockModel = { call: vi.fn() };
    const mockTokenizer = vi.fn();
    const progressCallback = vi.fn();

    mockXLMRobertaModel.from_pretrained.mockResolvedValue(mockModel);
    mockAutoTokenizer.from_pretrained.mockResolvedValue(mockTokenizer);

    await preloadRerankerModel(progressCallback);

    expect(mockXLMRobertaModel.from_pretrained).toHaveBeenCalledWith(
      'jinaai/jina-reranker-v2-base-multilingual',
      {
        device: 'webgpu',
        dtype: 'q8',
        progress_callback: progressCallback,
      },
    );
  });

  it('should throw if preload fails', async () => {
    const error = new Error('Model loading failed');
    mockXLMRobertaModel.from_pretrained.mockRejectedValueOnce(error).mockRejectedValueOnce(error);

    await expect(preloadRerankerModel()).rejects.toThrow(
      'Re-ranker failed: WebGPU Error: Model loading failed, CPU Error: Model loading failed',
    );
  });

  it('should use singleton instance on subsequent calls', async () => {
    const mockModel = { call: vi.fn() };
    const mockTokenizer = vi.fn();

    mockXLMRobertaModel.from_pretrained.mockResolvedValue(mockModel);
    mockAutoTokenizer.from_pretrained.mockResolvedValue(mockTokenizer);

    // First call
    await preloadRerankerModel();
    // Second call
    await preloadRerankerModel();

    // Should only initialize once due to singleton pattern
    expect(mockXLMRobertaModel.from_pretrained).toHaveBeenCalledTimes(1);
    expect(mockAutoTokenizer.from_pretrained).toHaveBeenCalledTimes(1);
  });
});
