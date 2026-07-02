import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import { CryptoService } from '../../services/cryptoService';
import {
  applyProviderSettingsPayload,
  clearProviderSettingsShareFromUrl,
  decryptProviderSettingsPayload,
  extractProviderSettingsShareFromUrl,
  getProviderDisplayName,
  PROVIDER_SETTINGS_SHARE_PARAM,
} from '../../services/providerSettingsShareService';
import type { SharedProviderSettingsPayload } from '../../services/providerSettingsShareService';

interface ProviderSettingsImportModalProps {
  onApplied?: () => void;
}

type ImportStage = 'password' | 'preview' | 'success' | 'legacy';

const LEGACY_SHARE_PARAM = 'keys';

const ProviderSettingsImportModal: React.FC<ProviderSettingsImportModalProps> = ({ onApplied }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<ImportStage>('password');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [payload, setPayload] = useState<SharedProviderSettingsPayload | null>(null);
  const [encryptedPayload, setEncryptedPayload] = useState<string | null>(null);

  useEffect(() => {
    const syncFromUrl = () => {
      const providerShare = extractProviderSettingsShareFromUrl();
      const legacyShare = CryptoService.extractKeysFromUrl();

      if (providerShare) {
        setEncryptedPayload(providerShare);
        setPayload(null);
        setPassword('');
        setError(null);
        setStage('password');
        setIsOpen(true);
        return;
      }

      if (legacyShare) {
        setEncryptedPayload(null);
        setPayload(null);
        setPassword('');
        setError(null);
        setStage('legacy');
        setIsOpen(true);
        return;
      }

      setIsOpen(false);
      setPayload(null);
      setEncryptedPayload(null);
      setPassword('');
      setError(null);
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  const summary = useMemo(() => {
    if (!payload) {
      return null;
    }

    return {
      providerName: getProviderDisplayName(payload.provider),
      model: payload.config.model,
      baseUrl: payload.config.baseUrl,
      hasApiKey: Boolean(payload.config.apiKey),
    };
  }, [payload]);

  const closeAndClear = (paramName?: string) => {
    if (paramName) {
      CryptoService.clearUrlParam(paramName);
    }
    setIsOpen(false);
    setPassword('');
    setError(null);
    setPayload(null);
    setEncryptedPayload(null);
  };

  const handleDecrypt = async () => {
    if (!encryptedPayload) {
      return;
    }

    if (!password.trim()) {
      setError('請輸入解密密碼');
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const decryptedPayload = await decryptProviderSettingsPayload(encryptedPayload, password);
      setPayload(decryptedPayload);
      setStage('preview');
    } catch (decryptError) {
      console.error('Decrypt provider settings share failed:', decryptError);
      setError(decryptError instanceof Error ? decryptError.message : '解密失敗');
    } finally {
      setIsBusy(false);
    }
  };

  const handleApply = async () => {
    if (!payload) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      await applyProviderSettingsPayload(payload);
      clearProviderSettingsShareFromUrl();
      setStage('success');
      onApplied?.();
    } catch (applyError) {
      console.error('Apply provider settings share failed:', applyError);
      setError(applyError instanceof Error ? applyError.message : '套用設定失敗');
    } finally {
      setIsBusy(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() =>
        closeAndClear(stage === 'legacy' ? LEGACY_SHARE_PARAM : PROVIDER_SETTINGS_SHARE_PARAM)
      }
      title={stage === 'legacy' ? '偵測到舊版分享連結' : '匯入服務商設定'}
      className='max-w-2xl border border-gray-700/50 bg-gradient-to-br from-gray-900 to-gray-800'
    >
      <div className='space-y-5 text-white'>
        {stage === 'legacy' && (
          <div className='space-y-4'>
            <div className='rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-100'>
              這個連結使用的是已淘汰的 API
              金鑰分享格式。請請分享者重新產生新版的「服務商設定分享」連結。
            </div>
            <div className='flex justify-end'>
              <button
                type='button'
                onClick={() => closeAndClear(LEGACY_SHARE_PARAM)}
                className='rounded-xl bg-gray-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-600'
              >
                關閉
              </button>
            </div>
          </div>
        )}

        {stage === 'password' && (
          <>
            <div className='rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4'>
              <p className='text-sm text-cyan-100'>
                此連結包含加密的服務商設定。輸入密碼後，你可以先預覽內容，再決定是否套用。
              </p>
            </div>
            <div>
              <label className='mb-2 block text-sm font-medium text-gray-300'>解密密碼</label>
              <input
                type='password'
                value={password}
                onChange={event => setPassword(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    void handleDecrypt();
                  }
                }}
                className='w-full rounded-xl border border-gray-700 bg-gray-900/60 px-4 py-3 text-white outline-none transition focus:border-cyan-500'
                placeholder='請輸入分享者提供的密碼'
              />
            </div>
          </>
        )}

        {stage === 'preview' && summary && (
          <>
            <div className='rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4'>
              <p className='text-sm text-emerald-100'>
                解密成功。確認下列內容後再套用；套用後會將此服務商設為目前使用中。
              </p>
            </div>
            <div className='rounded-2xl border border-gray-700/60 bg-gray-900/50 p-5'>
              <dl className='space-y-3 text-sm'>
                <div className='flex items-start justify-between gap-3'>
                  <dt className='text-gray-400'>服務商</dt>
                  <dd className='text-right font-medium text-white'>{summary.providerName}</dd>
                </div>
                <div className='flex items-start justify-between gap-3'>
                  <dt className='text-gray-400'>模型</dt>
                  <dd className='text-right font-mono text-cyan-100'>{summary.model}</dd>
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
            </div>
          </>
        )}

        {stage === 'success' && summary && (
          <div className='space-y-4'>
            <div className='rounded-2xl border border-green-500/30 bg-green-500/10 p-5'>
              <h3 className='mb-2 text-lg font-semibold text-green-100'>設定已成功套用</h3>
              <p className='text-sm text-green-100/90'>
                {summary.providerName} 已啟用，並成為目前使用中的服務商。
              </p>
            </div>
            <div className='rounded-2xl border border-gray-700/60 bg-gray-900/50 p-5 text-sm text-gray-200'>
              <div className='flex items-center justify-between gap-3'>
                <span className='text-gray-400'>模型</span>
                <span className='font-mono text-cyan-100'>{summary.model}</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className='rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200'>
            {error}
          </div>
        )}

        {stage !== 'legacy' && (
          <div className='flex flex-wrap justify-end gap-3'>
            {stage === 'password' && (
              <>
                <button
                  type='button'
                  onClick={() => closeAndClear(PROVIDER_SETTINGS_SHARE_PARAM)}
                  className='rounded-xl bg-gray-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-600'
                >
                  稍後再說
                </button>
                <button
                  type='button'
                  onClick={() => void handleDecrypt()}
                  disabled={isBusy}
                  className='rounded-xl bg-gradient-to-r from-cyan-600 to-blue-500 px-5 py-3 text-sm font-semibold text-white transition hover:from-cyan-500 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-60'
                >
                  {isBusy ? '解密中...' : '解密並預覽'}
                </button>
              </>
            )}

            {stage === 'preview' && (
              <>
                <button
                  type='button'
                  onClick={() => closeAndClear(PROVIDER_SETTINGS_SHARE_PARAM)}
                  className='rounded-xl bg-gray-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-600'
                >
                  取消
                </button>
                <button
                  type='button'
                  onClick={() => void handleApply()}
                  disabled={isBusy}
                  className='rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60'
                >
                  {isBusy ? '套用中...' : '確認套用'}
                </button>
              </>
            )}

            {stage === 'success' && (
              <button
                type='button'
                onClick={() => closeAndClear()}
                className='rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500'
              >
                繼續使用
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ProviderSettingsImportModal;
