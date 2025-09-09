import React from 'react';
import { AppProvider, useAppContext, ErrorBoundary, Layout, ModelLoadingOverlay } from './index';
import { AssistantEditor, ShareModal } from '../assistant';
import { ChatContainer } from '../chat';
import { ChatSession } from '../../types';
import SharedAssistant from '../features/SharedAssistant';
import MigrationPanel from '../settings/MigrationPanel';
import ApiKeySetup from '../settings/ApiKeySetup';
import ProviderSettings from '../settings/ProviderSettings';
import { providerManager } from '../../services/providerRegistry';
import { canWriteToTurso } from '../../services/tursoService';

function AppContent(): React.JSX.Element {
  const { state, actions } = useAppContext();

  // If in shared mode, render SharedAssistant
  if (state.isShared && state.sharedAssistantId) {
    return <SharedAssistant assistantId={state.sharedAssistantId} />;
  }

  const handleNewMessage = async (
    session: ChatSession,
    userMessage: string,
    _modelResponse: string,
    _tokenInfo: { promptTokenCount: number; candidatesTokenCount: number },
  ) => {
    const updatedSession = {
      ...session,
      title:
        session.title === 'New Chat' && userMessage ? userMessage.substring(0, 40) : session.title,
      updatedAt: Date.now(),
    };

    await actions.updateSession(updatedSession);
  };

  return (
    <Layout>
      {/* View Mode Content */}
      {state.viewMode === 'new_assistant' && (
        <AssistantEditor
          assistant={null}
          onSave={actions.saveAssistant}
          onCancel={() => {
            if (state.assistants.length > 0) {
              actions.setViewMode('chat');
            } else {
              actions.setViewMode('new_assistant');
            }
          }}
          onShare={actions.openShareModal}
        />
      )}

      {state.viewMode === 'edit_assistant' && state.currentAssistant && (
        <AssistantEditor
          assistant={state.currentAssistant}
          onSave={actions.saveAssistant}
          onCancel={() => actions.setViewMode('chat')}
          onShare={actions.openShareModal}
        />
      )}

      {state.viewMode === 'chat' && state.currentAssistant && state.currentSession && (
        <ChatContainer
          session={state.currentSession}
          assistantName={state.currentAssistant.name}
          systemPrompt={state.currentAssistant.systemPrompt}
          assistantId={state.currentAssistant.id}
          ragChunks={state.currentAssistant.ragChunks ?? []}
          onNewMessage={handleNewMessage}
        />
      )}

      {state.viewMode === 'settings' && (
        <div className='p-6 bg-gray-800 h-full overflow-y-auto'>
          <h2 className='text-2xl font-bold mb-6 text-white'>設定</h2>

          {/* 服務狀態 */}
          <div className='mb-6 bg-gray-700 rounded-lg p-4'>
            <h3 className='text-lg font-semibold text-white mb-4'>服務狀態</h3>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-4'>
              <div
                className={`p-3 rounded-md border-2 ${
                  providerManager.getAvailableProviders().length > 0
                    ? 'border-green-500 bg-green-800 bg-opacity-20'
                    : 'border-yellow-500 bg-yellow-800 bg-opacity-20'
                }`}
              >
                <div className='flex items-center mb-2'>
                  <span className='text-lg mr-2'>
                    {providerManager.getAvailableProviders().length > 0 ? '✅' : '⚠️'}
                  </span>
                  <span className='font-medium text-white'>AI 服務商</span>
                </div>
                <p
                  className={`text-sm ${
                    providerManager.getAvailableProviders().length > 0
                      ? 'text-green-200'
                      : 'text-yellow-200'
                  }`}
                >
                  {providerManager.getAvailableProviders().length > 0
                    ? `${providerManager.getAvailableProviders().length} 個服務商可用`
                    : '需要配置 AI 服務商'}
                </p>
              </div>
              <div
                className={`p-3 rounded-md border-2 ${
                  canWriteToTurso()
                    ? 'border-green-500 bg-green-800 bg-opacity-20'
                    : 'border-yellow-500 bg-yellow-800 bg-opacity-20'
                }`}
              >
                <div className='flex items-center mb-2'>
                  <span className='text-lg mr-2'>{canWriteToTurso() ? '✅' : '⚠️'}</span>
                  <span className='font-medium text-white'>Turso 資料庫</span>
                </div>
                <p
                  className={`text-sm ${canWriteToTurso() ? 'text-green-200' : 'text-yellow-200'}`}
                >
                  {canWriteToTurso() ? '可以保存助理和 RAG' : '需要配置才能保存'}
                </p>
              </div>
            </div>
            <div className='flex gap-3'>
              <button
                onClick={() => actions.setViewMode('provider_settings')}
                className='flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
              >
                AI 服務商設定
              </button>
              <button
                onClick={() => actions.setViewMode('api_setup')}
                className='flex-1 px-6 py-3 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
              >
                資料庫設定
              </button>
            </div>
          </div>

          {/* Turso Migration Panel */}
          <div className='mb-6'>
            <MigrationPanel />
          </div>
        </div>
      )}

      {state.viewMode === 'api_setup' && (
        <div className='p-6 bg-gray-800 h-full overflow-y-auto'>
          <ApiKeySetup
            onComplete={() => actions.setViewMode('settings')}
            onCancel={() => actions.setViewMode('settings')}
          />
        </div>
      )}

      {state.viewMode === 'provider_settings' && (
        <div className='bg-gray-800 absolute inset-0 overflow-y-auto'>
          <ProviderSettings onClose={() => actions.setViewMode('settings')} />
        </div>
      )}

      {/* Loading Screen */}
      {state.isLoading && (
        <div className='flex flex-col items-center justify-center h-full text-gray-400 p-8'>
          <div className='relative mb-6'>
            <div className='w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin'></div>
            <div className='absolute inset-0 w-16 h-16 border-4 border-cyan-300/20 rounded-full'></div>
          </div>
          <div className='text-center max-w-md'>
            <p className='text-lg font-medium text-white mb-2'>載入助理中...</p>
            <p className='text-sm text-gray-400 mb-4'>正在從資料庫讀取您的助理資料</p>
            <div className='flex justify-center items-center space-x-1 mb-4'>
              <div className='w-2 h-2 bg-cyan-500 rounded-full animate-bounce'></div>
              <div
                className='w-2 h-2 bg-cyan-500 rounded-full animate-bounce'
                style={{ animationDelay: '0.1s' }}
              ></div>
              <div
                className='w-2 h-2 bg-cyan-500 rounded-full animate-bounce'
                style={{ animationDelay: '0.2s' }}
              ></div>
            </div>
            <div className='text-xs text-gray-500'>
              <div>正在執行以下步驟：</div>
              <div className='mt-2 space-y-1'>
                <div className='flex items-center justify-center gap-2'>
                  <div className='w-1.5 h-1.5 bg-green-500 rounded-full'></div>
                  <span>連接資料庫</span>
                </div>
                <div className='flex items-center justify-center gap-2'>
                  <div className='w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse'></div>
                  <span>載入助理資料</span>
                </div>
                <div className='flex items-center justify-center gap-2'>
                  <div className='w-1.5 h-1.5 bg-gray-500 rounded-full'></div>
                  <span>初始化介面</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!state.currentAssistant &&
        !state.isLoading &&
        state.viewMode !== 'new_assistant' &&
        state.viewMode !== 'settings' &&
        state.viewMode !== 'provider_settings' &&
        state.viewMode !== 'api_setup' && (
          <div className='flex flex-col items-center justify-center h-full text-gray-400 p-8'>
            <div className='w-20 h-20 bg-gray-700 rounded-full flex items-center justify-center mb-6'>
              <svg
                className='w-10 h-10 text-gray-500'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'
                />
              </svg>
            </div>
            <h3 className='text-xl font-semibold text-white mb-2'>歡迎使用專業助理</h3>
            <p className='text-gray-400 mb-6 text-center max-w-md'>
              還沒有任何助理。創建您的第一個 AI 助理開始聊天吧！
            </p>
            <button
              onClick={() => actions.setViewMode('new_assistant')}
              className='px-6 py-3 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
            >
              新增您的第一個助理
            </button>
          </div>
        )}

      {/* Model Loading Overlay */}
      <ModelLoadingOverlay
        isVisible={state.isModelLoading}
        progress={state.modelLoadingProgress || undefined}
      />

      {/* Share Modal */}
      {state.assistantToShare && (
        <ShareModal
          isOpen={state.isShareModalOpen}
          onClose={actions.closeShareModal}
          assistant={state.assistantToShare}
        />
      )}
    </Layout>
  );
}

export function AppShell(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}

export default AppShell;
