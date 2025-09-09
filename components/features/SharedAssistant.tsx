import React, { useCallback, useEffect } from 'react';
import { AppContext } from '../core/useAppContext';
import { initializeProviders, isLLMAvailable } from '../../services/providerRegistry';
import { getAssistantFromTurso } from '../../services/tursoService';
import CryptoService from '../../services/cryptoService';
import { AppContextValue } from '../core/AppContext.types';
import { Assistant } from '../../types';

interface SharedAssistantProps {
  assistantId: string;
}

const SharedAssistant: React.FC<SharedAssistantProps> = ({ assistantId }) => {
  const { dispatch } = React.useContext(AppContext) as AppContextValue;

  const checkApiKey = useCallback(async () => {
    await initializeProviders();
    const needed = !isLLMAvailable();
    if (needed) {
      dispatch({ type: 'SET_VIEW_MODE', payload: 'api_setup' });
    }
    return !needed;
  }, [dispatch]);

  const loadSharedAssistant = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });
    try {
      if (!assistantId) {
        dispatch({ type: 'SET_ERROR', payload: '無效的助理 ID。' });
        dispatch({ type: 'SET_LOADING', payload: false });
        return;
      }
      const tursoAssistant = await getAssistantFromTurso(assistantId);

      if (!tursoAssistant) {
        dispatch({ type: 'SET_ERROR', payload: '找不到助理或無法分享。' });
        dispatch({ type: 'SET_LOADING', payload: false });
        return;
      }

      const assistant: Assistant = {
        ...tursoAssistant,
        ragChunks: [],
      };

      dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: assistant });

      dispatch({
        type: 'SET_CURRENT_SESSION',
        payload: {
          id: `shared_${Date.now()}`,
          assistantId: tursoAssistant.id,
          title: `與 ${tursoAssistant.name} 聊天`,
          messages: [],
          createdAt: Date.now(),
          tokenCount: 0,
        },
      });

      const encryptedKeys = CryptoService.extractKeysFromUrl();
      if (encryptedKeys) {
        dispatch({ type: 'SET_VIEW_MODE', payload: 'api_setup' });
      } else {
        await checkApiKey();
      }
    } catch (err) {
      console.error('Failed to load shared assistant:', err);
      dispatch({ type: 'SET_ERROR', payload: '無法載-載入分享的助理。請檢查連結。' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
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
