import React, { useCallback, useEffect, useRef } from 'react';
import { AppContext } from '../core/useAppContext';
import {
  initializeProviders,
  providerManager,
  isLLMAvailable,
} from '../../services/providerRegistry';
import { getAssistantFromTurso } from '../../services/tursoService';
import CryptoService from '../../services/cryptoService';
import { ApiKeyManager } from '../../services/apiKeyManager';
import { AppContextValue, ModelLoadingProgress } from '../core/AppContext.types';
import { Assistant } from '../../types';
import { preloadEmbeddingModel, isEmbeddingModelLoaded } from '../../services/embeddingService';

interface SharedAssistantProps {
  assistantId: string;
}

const SharedAssistant: React.FC<SharedAssistantProps> = ({ assistantId }) => {
  const { dispatch } = React.useContext(AppContext) as AppContextValue;
  const loadingRef = useRef(false);
  const loadedRef = useRef(false);

  const checkApiKey = useCallback(async () => {
    await initializeProviders();
    const needed = !isLLMAvailable();
    // Don't dispatch here - let the caller handle the viewMode setting
    return !needed;
  }, [dispatch]);

  const loadSharedAssistant = useCallback(async () => {
    // 防止重複請求
    if (loadingRef.current || loadedRef.current) {
      console.log('⚠️ [SHARED ASSISTANT] Skipping duplicate load request');
      return;
    }

    loadingRef.current = true;
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      if (!assistantId) {
        dispatch({ type: 'SET_ERROR', payload: '無效的助理 ID。' });
        return;
      }

      console.log('🔄 [SHARED ASSISTANT] Loading assistant:', assistantId);
      const tursoAssistant = await getAssistantFromTurso(assistantId);

      if (!tursoAssistant) {
        dispatch({ type: 'SET_ERROR', payload: '找不到助理或無法分享。' });
        return;
      }

      const assistant: Assistant = {
        ...tursoAssistant,
        ragChunks: [],
      };

      dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: assistant });
      console.log('📋 [SHARED ASSISTANT] Assistant set:', assistant);

      const newSession = {
        id: `shared_${Date.now()}`,
        assistantId: tursoAssistant.id,
        title: `與 ${tursoAssistant.name} 聊天`,
        messages: [],
        createdAt: Date.now(),
        tokenCount: 0,
      };

      dispatch({
        type: 'SET_CURRENT_SESSION',
        payload: newSession,
      });
      console.log('💬 [SHARED ASSISTANT] Session set:', newSession);

      // Preload embedding model if not loaded - similar to main app logic
      if (!isEmbeddingModelLoaded()) {
        console.log('📦 [SHARED ASSISTANT] Starting embedding model preload...');
        dispatch({ type: 'SET_MODEL_LOADING', payload: { isLoading: true } });
        try {
          await preloadEmbeddingModel(progress => {
            dispatch({
              type: 'SET_MODEL_LOADING',
              payload: { isLoading: true, progress: progress as ModelLoadingProgress },
            });
          });
          console.log('✅ [SHARED ASSISTANT] Embedding model preloaded successfully');
        } catch (error) {
          console.error('❌ [SHARED ASSISTANT] Failed to preload embedding model:', error);
        } finally {
          dispatch({ type: 'SET_MODEL_LOADING', payload: { isLoading: false, progress: null } });
          console.log('🔄 [SHARED ASSISTANT] Model loading state cleared');
        }
      }

      // Handle encrypted keys directly with prompt (similar to AppContext logic)
      const encryptedKeys = CryptoService.extractKeysFromUrl();
      let hasValidKeys = false;
      if (encryptedKeys) {
        console.log('🔐 [SHARED ASSISTANT] Encrypted keys found, prompting for password');
        const password = window.prompt('此助理包含已加密的 API 金鑰。請輸入密碼以解密：', '');
        if (password) {
          try {
            const decryptedApiKeys = await CryptoService.decryptApiKeys(encryptedKeys, password);
            ApiKeyManager.setUserApiKeys(decryptedApiKeys);

            // Handle provider-specific config if present in decrypted keys
            if (decryptedApiKeys.provider) {
              const providerType = decryptedApiKeys.provider as string;
              const config: Record<string, any> = {};
              const keyName = `${providerType}ApiKey` as keyof typeof decryptedApiKeys;
              const baseUrlName = `${providerType}BaseUrl` as keyof typeof decryptedApiKeys;
              const modelName = 'model' as keyof typeof decryptedApiKeys;

              if (decryptedApiKeys[keyName]) {
                config.apiKey = decryptedApiKeys[keyName];
              }
              if (decryptedApiKeys[baseUrlName]) {
                config.baseUrl = decryptedApiKeys[baseUrlName];
              }
              if (decryptedApiKeys[modelName]) {
                config.model = decryptedApiKeys[modelName];
              }

              if (Object.keys(config).length > 0) {
                const provider = providerManager.getProvider(providerType);
                if (provider) {
                  await provider.initialize(config);
                  providerManager.enableProvider(providerType, true);
                  providerManager.setActiveProvider(providerType);
                  console.log(
                    `✅ [SHARED ASSISTANT] ${providerType} provider configured from shared keys`,
                  );
                }
              }
            }

            await initializeProviders(); // Re-init after setting keys
            hasValidKeys = true;

            // Clear URL params
            const url = new URL(window.location.href);
            url.searchParams.delete('keys');
            window.history.replaceState({}, document.title, url.toString());

            alert('API 金鑰已成功匯入！');
          } catch (error) {
            console.error('❌ [SHARED ASSISTANT] Decryption failed:', error);
            alert('密碼錯誤或金鑰損毀，無法解密 API 金鑰。請檢查連結。');
            hasValidKeys = false;
          }
        } else {
          console.log('❌ [SHARED ASSISTANT] No password provided, fallback to api_setup');
          hasValidKeys = false;
        }
      } else {
        hasValidKeys = await checkApiKey();
      }

      if (hasValidKeys) {
        console.log('🎯 [SHARED ASSISTANT] Valid API keys available, setting chat mode');
        dispatch({ type: 'SET_VIEW_MODE', payload: 'chat' });
      } else {
        console.log('⚠️ [SHARED ASSISTANT] No valid API keys, setting api_setup mode');
        dispatch({ type: 'SET_VIEW_MODE', payload: 'api_setup' });
      }

      loadedRef.current = true;
      console.log('✅ [SHARED ASSISTANT] Successfully loaded assistant');
    } catch (err) {
      console.error('❌ [SHARED ASSISTANT] Failed to load assistant:', err);
      dispatch({ type: 'SET_ERROR', payload: '無法載入分享的助理。請檢查連結或稍後重試。' });
    } finally {
      loadingRef.current = false;
      dispatch({ type: 'SET_LOADING', payload: false });
      console.log('🔄 [SHARED ASSISTANT] Loading state cleared');
    }
  }, [assistantId, checkApiKey, dispatch]);

  useEffect(() => {
    if (assistantId) {
      loadSharedAssistant();
    }
  }, [assistantId, loadSharedAssistant]);

  // This is a view component, so it doesn't render anything itself
  return null;
};

export default SharedAssistant;
