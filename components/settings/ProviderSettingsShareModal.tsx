import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import Modal from '../ui/Modal';
import type { ProviderSettings, ProviderType } from '../../services/llmAdapter';
import { CryptoService } from '../../services/cryptoService';
import {
  buildProviderSettingsPayload,
  buildProviderSettingsShareUrl,
  encryptProviderSettingsPayload,
  getProviderDisplayName,
} from '../../services/providerSettingsShareService';

interface ProviderSettingsShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ProviderSettings;
  availableProviders: ProviderType[];
  initialProvider: ProviderType;
}

const ProviderSettingsShareModal: React.FC<ProviderSettingsShareModalProps> = ({
  isOpen,
  onClose,
  settings,
  availableProviders,
  initialProvider,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>(initialProvider);
  const [password, setPassword] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(initialProvider);
      setPassword(CryptoService.generateRandomPassword());
      setShareUrl('');
      setQrCodeDataUrl('');
      setError(null);
      setSuccess(null);
    }
  }, [initialProvider, isOpen]);

  const summary = useMemo(() => {
    try {
      const payload = buildProviderSettingsPayload(settings, selectedProvider);
      return {
        providerName: getProviderDisplayName(selectedProvider),
        model: payload.config.model,
        baseUrl: payload.config.baseUrl,
        hasApiKey: Boolean(payload.config.apiKey),
      };
    } catch (buildError) {
      return {
        providerName: getProviderDisplayName(selectedProvider),
        model: '',
        baseUrl: undefined,
        hasApiKey: false,
        error: buildError instanceof Error ? buildError.message : '無法建立分享摘要',
      };
    }
  }, [selectedProvider, settings]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess(`${label}已複製到剪貼簿`);
    } catch (copyError) {
      console.error(`Copy ${label} failed:`, copyError);
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setSuccess(`${label}已複製到剪貼簿`);
    }
  };

  const handleGenerate = async () => {
    if (!password.trim()) {
      setError('請先設定解密密碼');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = buildProviderSettingsPayload(settings, selectedProvider);
      const encryptedPayload = await encryptProviderSettingsPayload(payload, password);
      const url = buildProviderSettingsShareUrl(encryptedPayload);
      const qr = await QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: {
          dark: '#111827',
          light: '#ffffff',
        },
      });

      setShareUrl(url);
      setQrCodeDataUrl(qr);
      setSuccess('分享連結與 QR Code 已生成');
    } catch (generateError) {
      console.error('Generate provider settings share failed:', generateError);
      setError(generateError instanceof Error ? generateError.message : '分享連結生成失敗');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadQr = () => {
    if (!qrCodeDataUrl) {
      return;
    }

    const link = document.createElement('a');
    link.download = `${selectedProvider}-provider-share-qr.png`;
    link.href = qrCodeDataUrl;
    link.click();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title='分享服務商設定'
      className='max-w-3xl border border-gray-700/50 bg-gradient-to-br from-gray-900 to-gray-800'
    >
      <div className='space-y-6 text-white'>
        <div className='rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4'>
          <p className='text-sm text-cyan-100'>
            將目前的服務商設定加密進連結與 QR Code 中，接收者只要輸入密碼即可預覽並套用。
          </p>
        </div>

        <div className='grid gap-6 lg:grid-cols-[1.1fr_0.9fr]'>
          <div className='space-y-5'>
            <div>
              <label className='mb-2 block text-sm font-medium text-gray-300'>
                選擇要分享的服務商
              </label>
              <div className='grid gap-2 sm:grid-cols-2'>
                {availableProviders.map(provider => {
                  const active = provider === selectedProvider;
                  return (
                    <button
                      key={provider}
                      type='button'
                      onClick={() => {
                        setSelectedProvider(provider);
                        setShareUrl('');
                        setQrCodeDataUrl('');
                        setError(null);
                      }}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                        active
                          ? 'border-cyan-500 bg-cyan-500/15 text-cyan-100'
                          : 'border-gray-700 bg-gray-900/50 text-gray-200 hover:border-gray-500'
                      }`}
                    >
                      <div className='font-medium'>{getProviderDisplayName(provider)}</div>
                      <div className='mt-1 text-xs text-gray-400'>
                        套用後會自動設為目前使用中的服務商
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className='rounded-2xl border border-gray-700/60 bg-gray-900/50 p-5'>
              <h3 className='mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400'>
                分享內容摘要
              </h3>
              <dl className='space-y-3 text-sm'>
                <div className='flex items-start justify-between gap-3'>
                  <dt className='text-gray-400'>服務商</dt>
                  <dd className='text-right font-medium text-white'>{summary.providerName}</dd>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <dt className='text-gray-400'>模型</dt>
                  <dd className='text-right font-mono text-cyan-100'>
                    {summary.model || '尚未設定'}
                  </dd>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <dt className='text-gray-400'>API 金鑰</dt>
                  <dd className='text-right text-white'>
                    {summary.hasApiKey ? '已包含' : '未包含'}
                  </dd>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <dt className='text-gray-400'>端點網址</dt>
                  <dd className='max-w-[70%] text-right font-mono text-xs text-gray-200'>
                    {summary.baseUrl || '無'}
                  </dd>
                </div>
              </dl>
              {'error' in summary && summary.error && (
                <p className='mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200'>
                  {summary.error}
                </p>
              )}
            </div>

            <div>
              <label className='mb-2 block text-sm font-medium text-gray-300'>解密密碼</label>
              <div className='flex gap-2'>
                <input
                  type='text'
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  className='flex-1 rounded-xl border border-gray-700 bg-gray-900/60 px-4 py-3 text-white outline-none transition focus:border-cyan-500'
                  placeholder='設定或產生分享密碼'
                />
                <button
                  type='button'
                  onClick={() => setPassword(CryptoService.generateRandomPassword())}
                  className='rounded-xl bg-gray-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-600'
                >
                  重新產生
                </button>
              </div>
              <p className='mt-2 text-xs text-gray-500'>請將密碼與分享連結分開傳送給接收者。</p>
            </div>

            <div className='flex flex-wrap gap-3'>
              <button
                type='button'
                onClick={handleGenerate}
                disabled={isGenerating}
                className='rounded-xl bg-gradient-to-r from-cyan-600 to-blue-500 px-5 py-3 font-semibold text-white transition hover:from-cyan-500 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-60'
              >
                {isGenerating ? '生成中...' : '生成分享連結'}
              </button>
              {shareUrl && (
                <>
                  <button
                    type='button'
                    onClick={() => copyToClipboard(shareUrl, '分享連結')}
                    className='rounded-xl bg-gray-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-600'
                  >
                    複製連結
                  </button>
                  <button
                    type='button'
                    onClick={() => copyToClipboard(password, '解密密碼')}
                    className='rounded-xl bg-gray-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-600'
                  >
                    複製密碼
                  </button>
                </>
              )}
            </div>

            {error && (
              <div className='rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200'>
                {error}
              </div>
            )}
            {success && (
              <div className='rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-200'>
                {success}
              </div>
            )}
          </div>

          <div className='rounded-2xl border border-gray-700/60 bg-gray-900/40 p-5'>
            <h3 className='mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400'>
              分享結果
            </h3>
            {qrCodeDataUrl ? (
              <div className='space-y-4'>
                <div className='rounded-2xl bg-white p-4'>
                  <img
                    src={qrCodeDataUrl}
                    alt='服務商設定分享 QR Code'
                    className='mx-auto h-56 w-56'
                  />
                </div>
                <div>
                  <label className='mb-2 block text-xs font-medium text-gray-400'>分享連結</label>
                  <textarea
                    value={shareUrl}
                    readOnly
                    rows={4}
                    className='w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs text-cyan-100'
                  />
                </div>
                <button
                  type='button'
                  onClick={handleDownloadQr}
                  className='w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500'
                >
                  下載 QR Code
                </button>
              </div>
            ) : (
              <div className='flex h-full min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-gray-700 px-6 text-center text-sm text-gray-500'>
                生成分享連結後，這裡會顯示 QR Code 與可複製的 URI。
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ProviderSettingsShareModal;
