import React, { useState, useEffect } from 'react';
import { Assistant, RagChunk } from '../types';
import { generateEmbedding } from '../services/embeddingService';
import {
  saveRagChunkToTurso,
  getRagChunkCount,
  saveAssistantToTurso,
} from '../services/tursoService';
import { CryptoService } from '../services/cryptoService';
import { ApiKeyManager } from '../services/apiKeyManager';

interface AssistantEditorProps {
  assistant: Assistant | null;
  onSave: (assistant: Assistant) => void;
  onCancel: () => void;
}

const chunkText = (text: string, chunkSizeInWords = 200, overlapInWords = 40): string[] => {
  const sentences = text.match(/[^.!?]+[.!?]+|\s+/g) || [];
  const chunks: string[] = [];
  let currentChunkWords: string[] = [];

  for (const sentence of sentences) {
    const sentenceWords = sentence.trim().split(/\s+/).filter(Boolean);
    if (sentenceWords.length === 0) {
      continue;
    }

    if (
      currentChunkWords.length + sentenceWords.length > chunkSizeInWords &&
      currentChunkWords.length > 0
    ) {
      chunks.push(currentChunkWords.join(' '));
      const overlapIndex = Math.max(0, currentChunkWords.length - overlapInWords);
      currentChunkWords = currentChunkWords.slice(overlapIndex);
    }
    currentChunkWords.push(...sentenceWords);
  }

  if (currentChunkWords.length > 0) {
    chunks.push(currentChunkWords.join(' '));
  }

  return chunks;
};

const AssistantEditor: React.FC<AssistantEditorProps> = ({ assistant, onSave, onCancel }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [ragChunks, setRagChunks] = useState<RagChunk[]>([]);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [ragChunkCount, setRagChunkCount] = useState<number>(0);
  const [tursoSyncStatus, setTursoSyncStatus] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const [shareStatus, setShareStatus] = useState<{
    type: 'success' | 'info';
    message: string;
  } | null>(null);
  const [showAdvancedShare, setShowAdvancedShare] = useState(false);
  const [shareWithApiKeys, setShareWithApiKeys] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);

  useEffect(() => {
    if (assistant) {
      setName(assistant.name);
      setDescription(assistant.description || '');
      setSystemPrompt(assistant.systemPrompt);
      setRagChunks(assistant.ragChunks);
      // 載入現有的 RAG chunk 數量
      getRagChunkCount(assistant.id).then(count => setRagChunkCount(count));
    } else {
      setName('');
      setDescription('');
      setSystemPrompt('您是一個有用且專業的 AI 助理。');
      setRagChunks([]);
      setRagChunkCount(0);
    }
  }, [assistant]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) {
      return;
    }

    const files: File[] = Array.from(event.target.files);
    if (files.length === 0) {
      return;
    }

    // 需要先有 assistant ID 才能儲存到 Turso
    const assistantId = assistant?.id || `asst_${Date.now()}`;

    // 如果是新助手，需要先確保助手基本資料存在於 Turso
    if (!assistant) {
      try {
        setProcessingStatus('在 Turso 中建立助理...');
        await saveAssistantToTurso({
          id: assistantId,
          name: name.trim() || '新助理',
          description: description.trim() || '一個有用的 AI 助理',
          systemPrompt: systemPrompt.trim() || '您是一個有用的 AI 助理。',
          createdAt: Date.now(),
        });
      } catch (error) {
        console.error('Failed to create assistant in Turso:', error);
        setProcessingStatus('⚠️ 無法在雲端建立助理，繼續使用本地儲存...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    setProcessingStatus('開始處理檔案...');
    const successfulChunks: RagChunk[] = [];
    const failedChunks: { file: string; chunk: number; error: string }[] = [];

    for (const file of files) {
      if (file.type === 'text/plain') {
        try {
          setProcessingStatus(`讀取 ${file.name}...`);
          const content = await file.text();
          const textChunks = chunkText(content);

          for (let i = 0; i < textChunks.length; i++) {
            setProcessingStatus(`嵌入 ${file.name} 的 ${i + 1}/${textChunks.length} 區塊...`);
            const vector = await generateEmbedding(
              textChunks[i],
              'document',
              (progress: unknown) => {
                if (
                  typeof progress === 'object' &&
                  progress !== null &&
                  'status' in progress &&
                  'progress' in progress
                ) {
                  const progressObj = progress as { status: string; progress: number };
                  if (progressObj.status === 'progress') {
                    setProcessingStatus(`下載嵌入模型... ${Math.round(progressObj.progress)}%`);
                  }
                }
              }
            );

            // 優先儲存到 Turso 雲端
            try {
              setProcessingStatus(`保存 ${i + 1}/${textChunks.length} 區塊到 Turso 雲端...`);
              await saveRagChunkToTurso(
                {
                  id: `chunk_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`,
                  assistantId: assistantId,
                  fileName: file.name,
                  content: textChunks[i],
                  createdAt: Date.now(),
                },
                vector
              );

              // 只有成功上傳到 Turso 後才加到本地顯示
              const ragChunk = { fileName: file.name, content: textChunks[i], vector };
              successfulChunks.push(ragChunk);
              setRagChunkCount(prevCount => prevCount + 1);

              setProcessingStatus(`✅ 區塊 ${i + 1}/${textChunks.length} 已保存到雲端`);
            } catch (tursoError) {
              console.error('Failed to save chunk to Turso:', tursoError);
              failedChunks.push({
                file: file.name,
                chunk: i + 1,
                error: tursoError instanceof Error ? tursoError.message : String(tursoError),
              });

              // 嘗試作為後備儲存到本地
              setProcessingStatus(`⚠️ 雲端失敗，本地保存區塊 ${i + 1}...`);
              const ragChunk = { fileName: file.name, content: textChunks[i], vector };
              successfulChunks.push(ragChunk);
            }
          }
        } catch (err) {
          console.error(`Error processing file ${file.name}:`, err);
          setProcessingStatus(`處理 ${file.name} 時發生錯誤。`);
        }
      }
    }

    // 更新本地顯示
    setRagChunks(prevChunks => [...prevChunks, ...successfulChunks]);

    // 顯示最終結果
    if (failedChunks.length > 0) {
      setTursoSyncStatus({
        type: 'warning',
        message: `已處理 ${successfulChunks.length} 個區塊，${failedChunks.length} 個無法同步到雲端。部分資料僅儲存在本地。`,
      });
      setProcessingStatus(null);
      setTimeout(() => setTursoSyncStatus(null), 8000);
    } else if (successfulChunks.length > 0) {
      setTursoSyncStatus({
        type: 'success',
        message: `所有 ${successfulChunks.length} 個區塊已成功保存到 Turso 雲端！`,
      });
      setProcessingStatus(null);
      setTimeout(() => setTursoSyncStatus(null), 5000);
    } else {
      setProcessingStatus(null);
    }
  };

  const removeDocument = (fileName: string) => {
    setRagChunks(chunks => chunks.filter(chunk => chunk.fileName !== fileName));
  };

  const generateShareLink = async () => {
    if (!assistant) {
      setShareStatus({
        type: 'info',
        message: '請先保存助理再生成分享連結。',
      });
      setTimeout(() => setShareStatus(null), 3000);
      return;
    }

    if (shareWithApiKeys && !sharePassword.trim()) {
      setShareStatus({
        type: 'info',
        message: '分享 API 金鑰時需要設定密碼。',
      });
      setTimeout(() => setShareStatus(null), 3000);
      return;
    }

    setIsGeneratingShare(true);

    try {
      let shareUrl = `${window.location.origin}${window.location.pathname}?share=${assistant.id}`;

      if (shareWithApiKeys) {
        // 獲取當前用戶的 API 金鑰
        const userApiKeys = ApiKeyManager.getUserApiKeys();

        if (!userApiKeys.geminiApiKey && !userApiKeys.tursoWriteApiKey) {
          setShareStatus({
            type: 'info',
            message: '沒有可分享的 API 金鑰。請先在設定中配置您的 API 金鑰。',
          });
          setTimeout(() => setShareStatus(null), 3000);
          return;
        }

        // 加密 API 金鑰
        const encryptedApiKeys = await CryptoService.encryptApiKeys(userApiKeys, sharePassword);
        shareUrl += `&keys=${encryptedApiKeys}`;
      }

      // 複製到剪貼板
      await navigator.clipboard.writeText(shareUrl);

      let successMessage = `分享連結已複製到剪貼簿！任何有此連結的人都可以與 ${assistant.name} 聊天。`;

      if (shareWithApiKeys) {
        successMessage += `\n\n🔐 此連結包含加密的 API 金鑰，請將密碼 "${sharePassword}" 分別傳送給接收者。`;
      }

      setShareStatus({
        type: 'success',
        message: successMessage,
      });

      // 10秒後自動清除狀態
      setTimeout(() => setShareStatus(null), 10000);
    } catch (error) {
      console.error('生成分享連結失敗:', error);
      setShareStatus({
        type: 'info',
        message: '生成分享連結失敗，請稍後再試。',
      });
      setTimeout(() => setShareStatus(null), 5000);
    } finally {
      setIsGeneratingShare(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert('助理名稱為必填。');
      return;
    }

    const assistantId = assistant?.id || `asst_${Date.now()}`;
    const newAssistant: Assistant = {
      id: assistantId,
      name: name.trim(),
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      ragChunks: ragChunks,
      createdAt: assistant?.createdAt || Date.now(),
    };

    // 同步儲存助手到 Turso
    try {
      await saveAssistantToTurso({
        id: assistantId,
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        createdAt: newAssistant.createdAt,
      });
    } catch (error) {
      console.error('Failed to save assistant to Turso:', error);
      // 繼續儲存到本地，但警告用戶
      alert('警告：助理已本地保存，但無法同步到 Turso 資料庫');
    }

    onSave(newAssistant);
  };

  const fileNames: string[] = [...new Set<string>(ragChunks.map((c: RagChunk) => c.fileName))];

  return (
    <div className='flex flex-col h-full bg-gradient-to-br from-gray-800 to-gray-900 p-8 overflow-y-auto'>
      <h2 className='text-3xl font-bold mb-8 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent'>
        {assistant ? '編輯助理' : '新增助理'}
      </h2>

      <div className='mb-6'>
        <label htmlFor='name' className='block text-sm font-semibold text-gray-300 mb-2'>
          助理名稱
        </label>
        <input
          type='text'
          id='name'
          value={name}
          onChange={e => setName(e.target.value)}
          className='w-full bg-gray-700/80 border-2 border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-gray-700 transition-all duration-200 shadow-inner'
          placeholder='例如：行銷文案寫手'
        />
      </div>

      <div className='mb-6'>
        <label htmlFor='description' className='block text-sm font-semibold text-gray-300 mb-2'>
          公開描述
          <span className='text-xs text-gray-500 ml-2'>(分享時顯示給用戶)</span>
        </label>
        <textarea
          id='description'
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className='w-full bg-gray-700/80 border-2 border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-gray-700 transition-all duration-200 shadow-inner resize-none'
          placeholder='簡單描述這個助理能幫助什麼...'
        />
      </div>

      <div className='mb-6'>
        <label htmlFor='systemPrompt' className='block text-sm font-semibold text-gray-300 mb-2'>
          系統提示
        </label>
        <textarea
          id='systemPrompt'
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          rows={8}
          className='w-full bg-gray-700/80 border-2 border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-gray-700 transition-all duration-200 shadow-inner resize-none'
          placeholder='定義助理的角色、個性和指導。'
        />
      </div>

      <div className='mb-8'>
        <label className='block text-sm font-semibold text-gray-300 mb-2'>
          知識檔案 (RAG)
          {ragChunkCount > 0 && (
            <span className='ml-2 px-3 py-1 bg-gradient-to-r from-cyan-600 to-cyan-500 text-white text-xs rounded-full shadow-md'>
              {ragChunkCount} 區塊在 Turso
            </span>
          )}
        </label>
        <p className='text-sm text-gray-400 mb-4 leading-relaxed'>
          上傳 .txt 檔案以建立可搜尋的知識庫。檔案會自動儲存到 Turso 雲端，以提供高效能向量搜尋。
        </p>
        <div className='bg-gray-700/50 border-2 border-dashed border-gray-600/70 rounded-xl p-6 text-center hover:border-cyan-500/50 transition-all duration-300'>
          <input
            type='file'
            multiple
            accept='.txt'
            onChange={handleFileChange}
            className='block w-full text-sm text-gray-300 file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-gradient-to-r file:from-cyan-600 file:to-cyan-500 file:text-white hover:file:from-cyan-500 hover:file:to-cyan-400 file:shadow-lg hover:file:shadow-xl file:transition-all file:duration-300 cursor-pointer'
            disabled={!!processingStatus}
          />
          {processingStatus && (
            <p className='text-sm text-cyan-400 mt-3 animate-pulse flex items-center justify-center gap-2'>
              <div className='w-2 h-2 bg-cyan-400 rounded-full animate-bounce'></div>
              {processingStatus}
            </p>
          )}
        </div>

        {/* Turso 同步狀態顯示 */}
        {tursoSyncStatus && (
          <div
            className={`mt-4 p-3 rounded-md border ${
              tursoSyncStatus.type === 'success'
                ? 'bg-green-800 bg-opacity-30 border-green-600 text-green-200'
                : tursoSyncStatus.type === 'warning'
                  ? 'bg-yellow-800 bg-opacity-30 border-yellow-600 text-yellow-200'
                  : 'bg-red-800 bg-opacity-30 border-red-600 text-red-200'
            }`}
          >
            <p className='text-sm flex items-center'>
              <span className='mr-2'>
                {tursoSyncStatus.type === 'success' && '✅'}
                {tursoSyncStatus.type === 'warning' && '⚠️'}
                {tursoSyncStatus.type === 'error' && '❌'}
              </span>
              {tursoSyncStatus.message}
            </p>
          </div>
        )}

        {/* 分享狀態顯示 */}
        {shareStatus && (
          <div
            className={`mt-4 p-3 rounded-md border ${
              shareStatus.type === 'success'
                ? 'bg-blue-800 bg-opacity-30 border-blue-600 text-blue-200'
                : 'bg-gray-800 bg-opacity-30 border-gray-600 text-gray-200'
            }`}
          >
            <p className='text-sm flex items-center'>
              <span className='mr-2'>
                {shareStatus.type === 'success' && '🔗'}
                {shareStatus.type === 'info' && 'ℹ️'}
              </span>
              {shareStatus.message}
            </p>
          </div>
        )}

        <div className='mt-4 space-y-2'>
          {fileNames.map(fileName => (
            <div
              key={fileName}
              className='flex items-center justify-between bg-gray-700 p-2 rounded-md text-sm'
            >
              <span className='truncate text-gray-300'>{fileName}</span>
              <button
                onClick={() => removeDocument(fileName)}
                className='text-red-500 hover:text-red-400 ml-4'
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className='mt-auto flex justify-between items-center'>
        {/* Left side - Share section (only show for existing assistants) */}
        <div className='flex-1'>
          {assistant && (
            <div className='space-y-2'>
              <div className='flex items-center space-x-2'>
                <button
                  onClick={generateShareLink}
                  disabled={isGeneratingShare}
                  className='px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center space-x-2 disabled:opacity-50'
                >
                  <span>🔗</span>
                  <span>{isGeneratingShare ? '生成中...' : '生成分享連結'}</span>
                </button>
                <button
                  onClick={() => setShowAdvancedShare(!showAdvancedShare)}
                  className='px-2 py-2 text-gray-400 hover:text-white transition-colors'
                  title='高級分享選項'
                >
                  ⚙️
                </button>
              </div>

              {showAdvancedShare && (
                <div className='bg-gray-700 rounded-lg p-3 space-y-3'>
                  <h4 className='text-sm font-semibold text-white'>高級分享選項</h4>

                  <div className='flex items-center space-x-2'>
                    <input
                      type='checkbox'
                      id='shareWithApiKeys'
                      checked={shareWithApiKeys}
                      onChange={e => {
                        setShareWithApiKeys(e.target.checked);
                        if (e.target.checked && !sharePassword) {
                          setSharePassword(CryptoService.generateRandomPassword());
                        }
                      }}
                      className='text-blue-600'
                    />
                    <label htmlFor='shareWithApiKeys' className='text-sm text-gray-300'>
                      包含我的 API 金鑰（讓接收者無需配置即可使用）
                    </label>
                  </div>

                  {shareWithApiKeys && (
                    <div className='space-y-2'>
                      <label className='block text-xs text-gray-400'>
                        分享密碼（用於加密 API 金鑰）
                      </label>
                      <div className='flex space-x-2'>
                        <input
                          type='text'
                          value={sharePassword}
                          onChange={e => setSharePassword(e.target.value)}
                          className='flex-1 bg-gray-600 border border-gray-500 rounded px-2 py-1 text-white text-sm'
                          placeholder='輸入密碼'
                        />
                        <button
                          onClick={() => setSharePassword(CryptoService.generateRandomPassword())}
                          className='px-2 py-1 bg-gray-500 hover:bg-gray-400 text-white rounded text-xs'
                        >
                          重新生成
                        </button>
                      </div>
                      <p className='text-xs text-yellow-400'>
                        ⚠️ 請將此密碼與分享連結分開傳送給接收者
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right side - Save and Cancel buttons */}
        <div className='flex space-x-4'>
          <button
            onClick={onCancel}
            className='px-6 py-3 rounded-xl bg-gray-600/80 hover:bg-gray-500 text-white font-semibold transition-all duration-300 hover:shadow-lg hover:transform hover:-translate-y-0.5'
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className='px-8 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white font-bold transition-all duration-300 hover:shadow-xl hover:transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none'
            disabled={!!processingStatus}
          >
            {processingStatus ? (
              <span className='flex items-center gap-2'>
                <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                處理中...
              </span>
            ) : (
              '保存助理'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssistantEditor;
