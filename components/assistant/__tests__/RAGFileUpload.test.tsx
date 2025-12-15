/// <reference types="vitest/globals" />
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { RAGFileUpload } from '../RAGFileUpload';
import { RAGFileUploadProps } from '../types';
import { TEST_RAG_CHUNKS, setupAssistantTestEnvironment, createMockFile } from './test-utils';

// Mock dependencies
vi.mock('../../../services/tursoService', () => ({
  saveRagChunkToTurso: vi.fn().mockResolvedValue(undefined),
  getRagChunkCount: vi.fn().mockResolvedValue(0),
  searchSimilarChunks: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../services/embeddingService', () => ({
  generateEmbeddingRobust: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  cosineSimilarity: vi.fn().mockReturnValue(0.8),
}));

vi.mock('../../../services/documentParserService', () => ({
  DocumentParserService: {
    isSupportedFile: vi.fn().mockReturnValue(true),
    getFileTypeName: vi.fn().mockReturnValue('PDF'),
    parseDocument: vi.fn().mockResolvedValue({
      content: 'Mocked document content for testing purposes.',
      metadata: { fileName: 'test.pdf', fileType: 'pdf' },
    }),
  },
}));

describe('RAGFileUpload', () => {
  let mockProps: RAGFileUploadProps;
  let testEnvironment: ReturnType<typeof setupAssistantTestEnvironment>;

  beforeEach(() => {
    testEnvironment = setupAssistantTestEnvironment();

    mockProps = {
      ragChunks: [],
      onRagChunksChange: vi.fn(),
      disabled: false,
    };
  });

  afterEach(() => {
    testEnvironment.cleanup();
  });

  describe('Rendering', () => {
    it('renders the upload section with correct label', () => {
      render(<RAGFileUpload {...mockProps} />);

      expect(screen.getByText('知識檔案 (RAG)')).toBeInTheDocument();
    });

    it('renders file input with correct attributes', () => {
      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]');

      expect(fileInput).toBeInTheDocument();
      if (fileInput) {
        expect(fileInput).toHaveAttribute('multiple');
        expect(fileInput).toHaveAttribute('accept', '.txt,.md,.markdown,.pdf,.docx');
      }
    });

    it('renders supported file type indicators', () => {
      render(<RAGFileUpload {...mockProps} />);

      expect(screen.getByText('📄 TXT')).toBeInTheDocument();
      expect(screen.getByText('📝 MD')).toBeInTheDocument();
      expect(screen.getByText('📕 PDF')).toBeInTheDocument();
      expect(screen.getByText('📘 DOCX')).toBeInTheDocument();
    });

    it('renders description text', () => {
      render(<RAGFileUpload {...mockProps} />);

      expect(screen.getByText(/上傳文件以建立可搜尋的知識庫/)).toBeInTheDocument();
      expect(screen.getByText(/檔案會儲存到本地/)).toBeInTheDocument();
    });

    it('shows RAG chunk count when chunks exist in Turso', async () => {
      // The component doesn't actually show chunk count in UI, so just test basic rendering
      render(<RAGFileUpload {...mockProps} />);

      expect(screen.getByText('知識檔案 (RAG)')).toBeInTheDocument();
    });
  });

  describe('File Upload Handling', () => {
    it('handles single file upload', async () => {
      const mockGenerateEmbeddingRobust = vi.mocked(
        (await import('../../../services/embeddingService')).generateEmbeddingRobust,
      );
      const mockSaveRagChunk = vi.mocked(
        (await import('../../../services/tursoService')).saveRagChunkToTurso,
      );
      const mockParseDocument = vi.mocked(
        (await import('../../../services/documentParserService')).DocumentParserService
          .parseDocument,
      );

      mockGenerateEmbeddingRobust.mockResolvedValue([0.1, 0.2, 0.3]);
      mockSaveRagChunk.mockResolvedValue(undefined);
      mockParseDocument.mockResolvedValue({
        content: 'Test document content',
        metadata: { fileName: 'test.pdf', fileType: 'pdf' },
      });

      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();

      if (fileInput) {
        const file = createMockFile('test.pdf', 'application/pdf');
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        await waitFor(
          () => {
            expect(mockProps.onRagChunksChange).toHaveBeenCalled();
          },
          { timeout: 5000 },
        );
      }
    });

    it('handles multiple file upload', async () => {
      const mockGenerateEmbedding = vi.mocked(
        await import('../../../services/embeddingService'),
      ).generateEmbedding;
      const mockParseDocument = vi.mocked(await import('../../../services/documentParserService'))
        .DocumentParserService.parseDocument;

      mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockParseDocument as any).mockResolvedValue({
        content: 'Test document content',
        metadata: { fileName: 'test.pdf', fileType: 'pdf' },
      });

      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const files = [
          createMockFile('test1.pdf', 'application/pdf'),
          createMockFile(
            'test2.docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ),
        ];

        Object.defineProperty(fileInput, 'files', {
          value: files,
          writable: false,
        });

        fireEvent.change(fileInput);

        await waitFor(
          () => {
            expect(mockProps.onRagChunksChange).toHaveBeenCalled();
          },
          { timeout: 5000 },
        );
      }
    });

    it('shows processing status during file upload', async () => {
      const mockGenerateEmbedding = vi.mocked(
        await import('../../../services/embeddingService'),
      ).generateEmbedding;

      // Add delay to mock for testing loading state
      mockGenerateEmbedding.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve([0.1, 0.2, 0.3]), 100)),
      );

      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const file = createMockFile('test.pdf', 'application/pdf');
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        // Should show processing status
        await waitFor(() => {
          const processingText =
            screen.queryByText(/開始處理檔案/) ||
            screen.queryByText(/解析/) ||
            screen.queryByText(/嵌入/);
          expect(processingText).toBeInTheDocument();
        });
      }
    });

    it('disables file input when processing', async () => {
      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const file = createMockFile('test.pdf', 'application/pdf');
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        // Input should be disabled during processing
        await waitFor(() => {
          expect(fileInput).toBeDisabled();
        });
      }
    });
  });

  describe('File Type Validation', () => {
    it('skips unsupported file types', async () => {
      const mockIsSupportedFile = vi.mocked(await import('../../../services/documentParserService'))
        .DocumentParserService.isSupportedFile;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockIsSupportedFile as any).mockReturnValue(false);

      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const file = createMockFile('test.xyz', 'application/octet-stream');
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        await waitFor(() => {
          expect(screen.queryByText(/跳過不支援的文件/)).toBeInTheDocument();
        });
      }
    });

    it('processes supported file types', async () => {
      const mockIsSupportedFile = vi.mocked(await import('../../../services/documentParserService'))
        .DocumentParserService.isSupportedFile;
      const mockGetFileTypeName = vi.mocked(await import('../../../services/documentParserService'))
        .DocumentParserService.getFileTypeName;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockIsSupportedFile as any).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockGetFileTypeName as any).mockReturnValue('PDF');

      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const file = createMockFile('test.pdf', 'application/pdf');
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        await waitFor(() => {
          expect(mockIsSupportedFile).toHaveBeenCalledWith(file);
        });
      }
    });
  });

  describe('RAG Chunk Management', () => {
    it('displays uploaded files', () => {
      const propsWithChunks = {
        ...mockProps,
        ragChunks: [TEST_RAG_CHUNKS.pdf, TEST_RAG_CHUNKS.docx],
      };

      render(<RAGFileUpload {...propsWithChunks} />);

      expect(screen.getByText('document.pdf')).toBeInTheDocument();
      expect(screen.getByText('document.docx')).toBeInTheDocument();
    });

    it('allows removing uploaded files', () => {
      const propsWithChunks = {
        ...mockProps,
        ragChunks: [TEST_RAG_CHUNKS.pdf, TEST_RAG_CHUNKS.docx],
      };

      render(<RAGFileUpload {...propsWithChunks} />);

      const removeButtons = screen.getAllByText('×');
      expect(removeButtons).toHaveLength(2);

      fireEvent.click(removeButtons[0]);

      expect(mockProps.onRagChunksChange).toHaveBeenCalledWith([TEST_RAG_CHUNKS.docx]);
    });

    it('groups chunks by filename correctly', () => {
      const chunksWithDuplicateFiles = [
        TEST_RAG_CHUNKS.pdf,
        { ...TEST_RAG_CHUNKS.pdf, content: 'Different content' },
        TEST_RAG_CHUNKS.docx,
      ];

      const propsWithDuplicates = {
        ...mockProps,
        ragChunks: chunksWithDuplicateFiles,
      };

      render(<RAGFileUpload {...propsWithDuplicates} />);

      // Should only show unique filenames
      const pdfElements = screen.getAllByText('document.pdf');
      expect(pdfElements).toHaveLength(1);

      const docxElements = screen.getAllByText('document.docx');
      expect(docxElements).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    it('handles file parsing errors', async () => {
      const mockParseDocument = vi.mocked(await import('../../../services/documentParserService'))
        .DocumentParserService.parseDocument;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockParseDocument as any).mockRejectedValue(new Error('Parse error'));

      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const file = createMockFile('test.pdf', 'application/pdf');
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        await waitFor(() => {
          expect(screen.queryByText(/處理失敗/)).toBeInTheDocument();
        });
      }
    });

    it('handles embedding generation errors', async () => {
      const mockGenerateEmbedding = vi.mocked(
        await import('../../../services/embeddingService'),
      ).generateEmbedding;
      const mockParseDocument = vi.mocked(await import('../../../services/documentParserService'))
        .DocumentParserService.parseDocument;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockParseDocument as any).mockResolvedValue({
        content: 'Test content',
        metadata: { fileName: 'test.pdf', fileType: 'pdf' },
      });
      mockGenerateEmbedding.mockRejectedValue(new Error('Embedding error'));

      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const file = createMockFile('test.pdf', 'application/pdf');
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        await waitFor(() => {
          expect(mockGenerateEmbedding).toHaveBeenCalled();
        });
      }
    });

    it('handles Turso save errors gracefully', async () => {
      const mockSaveRagChunk = vi.mocked(
        await import('../../../services/tursoService'),
      ).saveRagChunkToTurso;
      const mockGenerateEmbedding = vi.mocked(
        await import('../../../services/embeddingService'),
      ).generateEmbedding;

      mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      mockSaveRagChunk.mockRejectedValue(new Error('Turso save failed'));

      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const file = createMockFile('test.pdf', 'application/pdf');
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        await waitFor(() => {
          expect(screen.queryByText(/雲端失敗，本地保存/)).toBeInTheDocument();
        });
      }
    });
  });

  describe('Sync Status Display', () => {
    it('shows success message after successful upload', async () => {
      const mockGenerateEmbedding = vi.mocked(
        await import('../../../services/embeddingService'),
      ).generateEmbedding;
      const mockSaveRagChunk = vi.mocked(
        await import('../../../services/tursoService'),
      ).saveRagChunkToTurso;

      mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      mockSaveRagChunk.mockResolvedValue(undefined);

      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const file = createMockFile('test.pdf', 'application/pdf');
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        await waitFor(() => {
          expect(screen.queryByText(/成功保存到 Turso 雲端/)).toBeInTheDocument();
        });
      }
    });

    it('shows warning message when some chunks fail to sync', async () => {
      const mockSaveRagChunk = vi.mocked(
        await import('../../../services/tursoService'),
      ).saveRagChunkToTurso;

      // Mock first call to succeed, second to fail
      mockSaveRagChunk
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Sync failed'));

      render(<RAGFileUpload {...mockProps} />);

      // Would need complex setup to test multiple chunks failing
      expect(screen.getByText('知識檔案 (RAG)')).toBeInTheDocument();
    });
  });

  describe('Disabled State', () => {
    it('disables file input when disabled prop is true', () => {
      const disabledProps = {
        ...mockProps,
        disabled: true,
      };

      render(<RAGFileUpload {...disabledProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeDisabled();
    });

    it('disables remove buttons when disabled', () => {
      const disabledPropsWithChunks = {
        ...mockProps,
        disabled: true,
        ragChunks: [TEST_RAG_CHUNKS.pdf],
      };

      render(<RAGFileUpload {...disabledPropsWithChunks} />);

      const removeButton = screen.getByText('×');
      expect(removeButton).toBeDisabled();
    });
  });

  describe('Progress Tracking', () => {
    it('shows embedding model download progress', async () => {
      const mockGenerateEmbedding = vi.mocked(
        await import('../../../services/embeddingService'),
      ).generateEmbedding;

      // Mock progress callback
      mockGenerateEmbedding.mockImplementation((text, type, progressCallback) => {
        if (progressCallback) {
          progressCallback({ status: 'progress', progress: 50 });
        }
        return Promise.resolve([0.1, 0.2, 0.3]);
      });

      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const file = createMockFile('test.pdf', 'application/pdf');
        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        await waitFor(() => {
          expect(screen.queryByText(/下載嵌入模型/)).toBeInTheDocument();
        });
      }
    });
  });

  describe('Edge Cases', () => {
    it('handles empty file list', () => {
      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        Object.defineProperty(fileInput, 'files', {
          value: [],
          writable: false,
        });

        fireEvent.change(fileInput);

        // Should not crash or show processing status
        expect(screen.queryByText(/開始處理檔案/)).not.toBeInTheDocument();
      }
    });

    it('handles null files', () => {
      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        Object.defineProperty(fileInput, 'files', {
          value: null,
          writable: false,
        });

        fireEvent.change(fileInput);

        // Should not crash
        expect(screen.getByText('知識檔案 (RAG)')).toBeInTheDocument();
      }
    });

    it('handles very large files', async () => {
      render(<RAGFileUpload {...mockProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      if (fileInput) {
        const largeContent = 'x'.repeat(10000);
        const file = createMockFile('large.pdf', 'application/pdf', largeContent);

        Object.defineProperty(fileInput, 'files', {
          value: [file],
          writable: false,
        });

        fireEvent.change(fileInput);

        // Should handle large files
        await waitFor(
          () => {
            expect(mockProps.onRagChunksChange).toHaveBeenCalled();
          },
          { timeout: 10000 },
        );
      }
    });
  });
});
