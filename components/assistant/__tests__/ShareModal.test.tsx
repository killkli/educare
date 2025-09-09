/* global HTMLAnchorElement */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { ShareModal } from '../ShareModal';
import { Assistant } from '../../../types';
import { TEST_ASSISTANTS, setupAssistantTestEnvironment } from './test-utils';

// Mock dependencies
vi.mock('../../../services/tursoService', () => ({
  saveAssistantToTurso: vi.fn().mockResolvedValue(undefined),
}));

// Mock crypto service
vi.mock('../../../services/cryptoService', () => ({
  CryptoService: {
    encryptApiKeys: vi.fn().mockResolvedValue('encrypted-api-keys'),
    generateRandomPassword: vi.fn().mockReturnValue('random-password-123'),
  },
}));

// Mock API key manager
vi.mock('../../../services/apiKeyManager', () => ({
  ApiKeyManager: {
    getUserApiKeys: vi.fn().mockReturnValue({
      geminiApiKey: 'mock-gemini-key',
      tursoWriteApiKey: 'mock-turso-key',
    }),
  },
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockQRCode'),
  },
}));

beforeAll(() => {
  // Mock window.location
  Object.defineProperty(window, 'location', {
    value: {
      origin: 'https://example.com',
      pathname: '/chat',
    },
    writable: true,
  });

  // Mock navigator.clipboard
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });

  // Mock document.createElement for download link
  const mockLink = {
    download: '',
    href: '',
    click: vi.fn(),
  };
  vi.spyOn(document, 'createElement').mockImplementation(tagName => {
    if (tagName === 'a') {
      return mockLink as unknown as HTMLAnchorElement;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return document.createElement(tagName) as any;
  });
});

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  assistant: Assistant;
}

describe('ShareModal', () => {
  let mockProps: ShareModalProps;
  let testEnvironment: ReturnType<typeof setupAssistantTestEnvironment>;

  beforeEach(() => {
    testEnvironment = setupAssistantTestEnvironment();

    mockProps = {
      isOpen: true,
      onClose: vi.fn(),
      assistant: TEST_ASSISTANTS.basic,
    };

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    testEnvironment.cleanup();
  });

  describe('Rendering', () => {
    it('renders nothing when modal is closed', () => {
      const closedProps = {
        ...mockProps,
        isOpen: false,
      };

      render(<ShareModal {...closedProps} />);

      expect(screen.queryByText('分享助理')).not.toBeInTheDocument();
    });

    it('renders modal when open', () => {
      render(<ShareModal {...mockProps} />);

      expect(screen.getByText('分享助理')).toBeInTheDocument();
      expect(
        screen.getByText(`分享 ${TEST_ASSISTANTS.basic.name} 給其他人使用`),
      ).toBeInTheDocument();
    });

    it('renders all main sections', () => {
      render(<ShareModal {...mockProps} />);

      expect(screen.getByText('分享助理')).toBeInTheDocument();
      expect(screen.getByText('分享連結')).toBeInTheDocument();
      expect(screen.getByText('包含我的 API 金鑰（讓接收者無需配置即可使用）')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '關閉' })).toBeInTheDocument();
    });

    it('renders close button with proper icon', () => {
      render(<ShareModal {...mockProps} />);

      const closeButton = screen.getByRole('button', { name: '' }); // Close button has no text, only icon
      expect(closeButton).toBeInTheDocument();
    });

    it('renders copy and download buttons', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '下載 QR Code' })).toBeInTheDocument();
      });
    });
  });

  describe('Share Link Generation', () => {
    it('generates basic share link on mount', async () => {
      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockResolvedValue(undefined);

      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(mockSaveAssistantToTurso).toHaveBeenCalledWith({
          id: TEST_ASSISTANTS.basic.id,
          name: TEST_ASSISTANTS.basic.name,
          description: TEST_ASSISTANTS.basic.description,
          systemPrompt: TEST_ASSISTANTS.basic.systemPrompt,
          createdAt: TEST_ASSISTANTS.basic.createdAt,
        });
      });

      const shareInput = screen.getByDisplayValue(
        `https://example.com/chat?share=${TEST_ASSISTANTS.basic.id}`,
      );
      expect(shareInput).toBeInTheDocument();
    });

    it('handles assistant with undefined description', async () => {
      const assistantWithoutDescription = {
        ...TEST_ASSISTANTS.basic,
        description: undefined,
      };

      const propsWithoutDescription = {
        ...mockProps,
        assistant: assistantWithoutDescription,
      };

      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockResolvedValue(undefined);

      render(<ShareModal {...propsWithoutDescription} />);

      await waitFor(() => {
        expect(mockSaveAssistantToTurso).toHaveBeenCalledWith(
          expect.objectContaining({
            description: '', // Should default to empty string
          }),
        );
      });
    });

    it('handles assistant with undefined createdAt', async () => {
      const assistantWithoutCreatedAt = {
        ...TEST_ASSISTANTS.basic,
        createdAt: undefined,
      };

      const propsWithoutCreatedAt = {
        ...mockProps,
        assistant: assistantWithoutCreatedAt,
      };

      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockResolvedValue(undefined);

      render(<ShareModal {...propsWithoutCreatedAt} />);

      await waitFor(() => {
        expect(mockSaveAssistantToTurso).toHaveBeenCalledWith(
          expect.objectContaining({
            createdAt: expect.any(Number), // Should use Date.now()
          }),
        );
      });
    });

    it('shows success message after successful link generation', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('分享連結生成成功！')).toBeInTheDocument();
      });
    });

    it('shows error message when Turso save fails', async () => {
      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockRejectedValue(new Error('Turso connection failed'));

      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText(/生成分享連結失敗/)).toBeInTheDocument();
        expect(screen.getByText(/Turso connection failed/)).toBeInTheDocument();
      });
    });
  });

  describe('QR Code Generation', () => {
    it('generates and displays QR code', async () => {
      const mockQRCode = vi.mocked(await import('qrcode')).default;
      mockQRCode.toDataURL.mockResolvedValue('data:image/png;base64,mockQRCode');

      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(mockQRCode.toDataURL).toHaveBeenCalledWith(
          `https://example.com/chat?share=${TEST_ASSISTANTS.basic.id}`,
          expect.objectContaining({
            width: 256,
            margin: 2,
            color: {
              dark: '#1f2937',
              light: '#ffffff',
            },
          }),
        );
      });

      expect(screen.getByAltText('分享 QR Code')).toBeInTheDocument();
      expect(screen.getByText('掃描 QR Code 或複製下方連結')).toBeInTheDocument();
    });

    it('enables download button when QR code is available', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', { name: '下載 QR Code' });
        expect(downloadButton).not.toBeDisabled();
      });
    });
  });

  describe('Copy Functionality', () => {
    it('copies share link to clipboard', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        const copyButton = screen.getByRole('button', { name: '複製' });
        expect(copyButton).toBeInTheDocument();
      });

      const copyButton = screen.getByRole('button', { name: '複製' });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          `https://example.com/chat?share=${TEST_ASSISTANTS.basic.id}`,
        );
      });

      expect(screen.getByText('連結已複製到剪貼簿！')).toBeInTheDocument();
    });

    it('shows error message when clipboard copy fails', async () => {
      vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Clipboard failed'));

      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        const copyButton = screen.getByRole('button', { name: '複製' });
        fireEvent.click(copyButton);
      });

      await waitFor(() => {
        expect(screen.getByText('複製失敗，請手動複製連結。')).toBeInTheDocument();
      });
    });

    it('clears success message after timeout', async () => {
      vi.useFakeTimers();

      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        const copyButton = screen.getByRole('button', { name: '複製' });
        fireEvent.click(copyButton);
      });

      await waitFor(() => {
        expect(screen.getByText('連結已複製到剪貼簿！')).toBeInTheDocument();
      });

      vi.advanceTimersByTime(3000);

      await waitFor(() => {
        expect(screen.queryByText('連結已複製到剪貼簿！')).not.toBeInTheDocument();
      });

      vi.useRealTimers();
    });
  });

  describe('Download QR Code', () => {
    it('downloads QR code with correct filename', async () => {
      const mockLink = {
        download: '',
        href: '',
        click: vi.fn(),
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockLink as unknown as HTMLAnchorElement);

      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', { name: '下載 QR Code' });
        fireEvent.click(downloadButton);
      });

      expect(mockLink.download).toBe(`${TEST_ASSISTANTS.basic.name}-share-qr.png`);
      expect(mockLink.href).toBe('data:image/png;base64,mockQRCode');
      expect(mockLink.click).toHaveBeenCalled();
    });
  });

  describe('API Key Sharing', () => {
    it('toggles API key sharing option', () => {
      render(<ShareModal {...mockProps} />);

      const checkbox = screen.getByLabelText('包含我的 API 金鑰（讓接收者無需配置即可使用）');
      expect(checkbox).not.toBeChecked();

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();

      // Should show password input
      expect(screen.getByPlaceholderText('設定密碼')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
    });

    it('generates random password', () => {
      const { CryptoService } = await import('../../../services/cryptoService');
      const mockCryptoService = vi.mocked(CryptoService);

      render(<ShareModal {...mockProps} />);

      const checkbox = screen.getByLabelText('包含我的 API 金鑰（讓接收者無需配置即可使用）');
      fireEvent.click(checkbox);

      const generateButton = screen.getByRole('button', { name: '重新生成' });
      fireEvent.click(generateButton);

      expect(mockCryptoService.generateRandomPassword).toHaveBeenCalled();
      expect(screen.getByDisplayValue('random-password-123')).toBeInTheDocument();
    });

    it('shows error when trying to share API keys without password', async () => {
      render(<ShareModal {...mockProps} />);

      const checkbox = screen.getByLabelText('包含我的 API 金鑰（讓接收者無需配置即可使用）');
      fireEvent.click(checkbox);

      const regenerateButton = screen.getByRole('button', { name: '🔐 重新生成加密分享連結' });
      fireEvent.click(regenerateButton);

      await waitFor(() => {
        expect(screen.getByText('分享 API 金鑰時需要設定密碼。')).toBeInTheDocument();
      });
    });

    it('shows error when no API keys are available', async () => {
      const { ApiKeyManager } = await import('../../../services/apiKeyManager');
      const mockApiKeyManager = vi.mocked(ApiKeyManager);
      mockApiKeyManager.getUserApiKeys.mockReturnValue({
        geminiApiKey: '',
        tursoWriteApiKey: '',
      });

      render(<ShareModal {...mockProps} />);

      const checkbox = screen.getByLabelText('包含我的 API 金鑰（讓接收者無需配置即可使用）');
      fireEvent.click(checkbox);

      const passwordInput = screen.getByPlaceholderText('設定密碼');
      fireEvent.change(passwordInput, { target: { value: 'test-password' } });

      const regenerateButton = screen.getByRole('button', { name: '🔐 重新生成加密分享連結' });
      fireEvent.click(regenerateButton);

      await waitFor(() => {
        expect(screen.getByText(/沒有可分享的 API 金鑰/)).toBeInTheDocument();
      });
    });

    it('generates encrypted share link with API keys', async () => {
      const { CryptoService } = await import('../../../services/cryptoService');
      const mockCryptoService = vi.mocked(CryptoService);
      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockResolvedValue(undefined);

      render(<ShareModal {...mockProps} />);

      const checkbox = screen.getByLabelText('包含我的 API 金鑰（讓接收者無需配置即可使用）');
      fireEvent.click(checkbox);

      const passwordInput = screen.getByPlaceholderText('設定密碼');
      fireEvent.change(passwordInput, { target: { value: 'test-password' } });

      const regenerateButton = screen.getByRole('button', { name: '🔐 重新生成加密分享連結' });
      fireEvent.click(regenerateButton);

      await waitFor(() => {
        expect(mockCryptoService.encryptApiKeys).toHaveBeenCalledWith(
          {
            geminiApiKey: 'mock-gemini-key',
            tursoWriteApiKey: 'mock-turso-key',
          },
          'test-password',
        );
      });

      const expectedUrl = `https://example.com/chat?share=${TEST_ASSISTANTS.basic.id}&keys=encrypted-api-keys`;
      expect(screen.getByDisplayValue(expectedUrl)).toBeInTheDocument();
    });

    it('shows password warning message', () => {
      render(<ShareModal {...mockProps} />);

      const checkbox = screen.getByLabelText('包含我的 API 金鑰（讓接收者無需配置即可使用）');
      fireEvent.click(checkbox);

      const passwordInput = screen.getByPlaceholderText('設定密碼');
      fireEvent.change(passwordInput, { target: { value: 'my-password' } });

      expect(screen.getByText('my-password')).toBeInTheDocument();
      expect(screen.getByText('⚠️ 請將密碼')).toBeInTheDocument();
      expect(screen.getByText('與分享連結分開傳送給接收者')).toBeInTheDocument();
    });

    it('shows loading state during encrypted link generation', async () => {
      const { CryptoService } = await import('../../../services/cryptoService');
      const mockCryptoService = vi.mocked(CryptoService);
      mockCryptoService.encryptApiKeys.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('encrypted'), 100)),
      );

      render(<ShareModal {...mockProps} />);

      const checkbox = screen.getByLabelText('包含我的 API 金鑰（讓接收者無需配置即可使用）');
      fireEvent.click(checkbox);

      const passwordInput = screen.getByPlaceholderText('設定密碼');
      fireEvent.change(passwordInput, { target: { value: 'test-password' } });

      const regenerateButton = screen.getByRole('button', { name: '🔐 重新生成加密分享連結' });
      fireEvent.click(regenerateButton);

      expect(screen.getByText('生成中...')).toBeInTheDocument();
      expect(regenerateButton).toBeDisabled();

      await waitFor(() => {
        expect(screen.getByText('🔐 重新生成加密分享連結')).toBeInTheDocument();
      });
    });
  });

  describe('Modal Interaction', () => {
    it('calls onClose when close button is clicked', () => {
      render(<ShareModal {...mockProps} />);

      const closeButtons = screen.getAllByRole('button');
      const headerCloseButton = closeButtons.find(
        button => button.querySelector('svg') && !button.textContent?.trim(),
      );

      if (headerCloseButton) {
        fireEvent.click(headerCloseButton);
        expect(mockProps.onClose).toHaveBeenCalled();
      }
    });

    it('calls onClose when bottom close button is clicked', () => {
      render(<ShareModal {...mockProps} />);

      const closeButton = screen.getByRole('button', { name: '關閉' });
      fireEvent.click(closeButton);

      expect(mockProps.onClose).toHaveBeenCalled();
    });

    it('prevents modal close when clicking inside modal content', () => {
      render(<ShareModal {...mockProps} />);

      const modalContent = screen.getByText('分享助理').closest('div');
      if (modalContent) {
        fireEvent.click(modalContent);
        expect(mockProps.onClose).not.toHaveBeenCalled();
      }
    });
  });

  describe('Status Messages', () => {
    it('displays success status with correct styling', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        const successMessage = screen.getByText('分享連結生成成功！');
        expect(successMessage).toBeInTheDocument();

        const statusContainer = successMessage.closest('div');
        expect(statusContainer).toHaveClass(
          'bg-green-900/30',
          'border-green-600/30',
          'text-green-200',
        );
      });
    });

    it('displays error status with correct styling', async () => {
      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockRejectedValue(new Error('Test error'));

      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        const errorMessage = screen.getByText(/生成分享連結失敗/);
        expect(errorMessage).toBeInTheDocument();

        const statusContainer = errorMessage.closest('div');
        expect(statusContainer).toHaveClass('bg-red-900/30', 'border-red-600/30', 'text-red-200');
      });
    });

    it('includes proper status icons', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('✅')).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels and roles', () => {
      render(<ShareModal {...mockProps} />);

      expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '下載 QR Code' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '關閉' })).toBeInTheDocument();
    });

    it('has proper form labels', () => {
      render(<ShareModal {...mockProps} />);

      const checkbox = screen.getByLabelText('包含我的 API 金鑰（讓接收者無需配置即可使用）');
      expect(checkbox).toBeInTheDocument();

      fireEvent.click(checkbox);

      expect(screen.getByText('加密密碼')).toBeInTheDocument();
    });

    it('has proper input attributes', () => {
      render(<ShareModal {...mockProps} />);

      const shareInput = screen.getByDisplayValue(/https:\/\/example\.com\/chat\?share=/);
      expect(shareInput).toHaveAttribute('readonly');
      expect(shareInput).toHaveAttribute('type', 'text');
    });
  });

  describe('Edge Cases', () => {
    it('handles assistant with very long name', async () => {
      const assistantWithLongName = {
        ...TEST_ASSISTANTS.basic,
        name: 'Very Long Assistant Name That Might Break Layout Or URL Generation In Some Cases',
      };

      const propsWithLongName = {
        ...mockProps,
        assistant: assistantWithLongName,
      };

      render(<ShareModal {...propsWithLongName} />);

      await waitFor(() => {
        expect(
          screen.getByText(`分享 ${assistantWithLongName.name} 給其他人使用`),
        ).toBeInTheDocument();
      });
    });

    it('handles special characters in assistant name', async () => {
      const assistantWithSpecialChars = {
        ...TEST_ASSISTANTS.basic,
        name: 'Assistant with émojis 🤖 and spëcial chars & symbols!',
      };

      const propsWithSpecialChars = {
        ...mockProps,
        assistant: assistantWithSpecialChars,
      };

      render(<ShareModal {...propsWithSpecialChars} />);

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', { name: '下載 QR Code' });
        fireEvent.click(downloadButton);
      });

      // Should handle special characters in filename
      const mockLink = vi.mocked(document.createElement).mock.results[0].value;
      expect(mockLink.download).toBe(`${assistantWithSpecialChars.name}-share-qr.png`);
    });

    it('handles rapid modal open/close', () => {
      const { rerender } = render(<ShareModal {...mockProps} />);

      // Rapidly toggle modal
      for (let i = 0; i < 5; i++) {
        rerender(<ShareModal {...mockProps} isOpen={false} />);
        rerender(<ShareModal {...mockProps} isOpen={true} />);
      }

      expect(screen.getByText('分享助理')).toBeInTheDocument();
    });

    it('handles QR code generation failure', async () => {
      const mockQRCode = vi.mocked(await import('qrcode')).default;
      mockQRCode.toDataURL.mockRejectedValue(new Error('QR generation failed'));

      // Should not crash the component
      render(<ShareModal {...mockProps} />);

      expect(screen.getByText('分享助理')).toBeInTheDocument();
    });
  });
});
