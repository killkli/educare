import React, { useState, useEffect } from 'react';
import { Assistant, RagChunk } from '../types';
import { generateEmbeddingRobust as generateEmbedding } from '../services/embeddingService';
import { getRagChunkCount } from '../services/tursoService';
import { DocumentParserService } from '../services/documentParserService';
import { useTursoAssistantStatus } from '../hooks/useTursoAssistantStatus';

interface AssistantEditorProps {
  assistant: Assistant | null;
  onSave: (assistant: Assistant) => void;
  onCancel: () => void;
  onShare?: (assistant: Assistant) => void;
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

const AssistantEditor: React.FC<AssistantEditorProps> = ({
  assistant,
  onSave,
  onCancel,
  onShare,
}) => {
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

  // Check if assistant exists in Turso for sharing
  const { canShare } = useTursoAssistantStatus(assistant?.id || null);

  useEffect(() => {
    if (assistant) {
      setName(assistant.name);
      setDescription(assistant.description || '');
      setSystemPrompt(assistant.systemPrompt);
      setRagChunks(assistant.ragChunks ?? []);
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

    setProcessingStatus('開始處理檔案...');
    const successfulChunks: RagChunk[] = [];

    for (const file of files) {
      // 檢查文件是否為支援的格式
      if (!DocumentParserService.isSupportedFile(file)) {
        console.warn(`不支援的文件格式: ${file.name}`);
        setProcessingStatus(`跳過不支援的文件: ${file.name}`);
        continue;
      }

      try {
        const fileTypeName = DocumentParserService.getFileTypeName(file);
        setProcessingStatus(`解析 ${fileTypeName}: ${file.name}...`);

        // 使用新的文件解析服務
        const parsedDocument = await DocumentParserService.parseDocument(file);
        const textChunks = chunkText(parsedDocument.content);

        setProcessingStatus(`✅ ${fileTypeName} 解析完成，共 ${textChunks.length} 個區塊`);

        for (let i = 0; i < textChunks.length; i++) {
          setProcessingStatus(`嵌入 ${file.name} 的 ${i + 1}/${textChunks.length} 區塊...`);
          const vector = await generateEmbedding(textChunks[i], 'document', (progress: unknown) => {
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
          });

          // 只保存到本地，不自動上傳到 Turso
          const ragChunk = { fileName: file.name, content: textChunks[i], vector };
          successfulChunks.push(ragChunk);
          setProcessingStatus(`✅ 區塊 ${i + 1}/${textChunks.length} 已處理完成`);
        }
      } catch (err) {
        console.error(`Error processing file ${file.name}:`, err);
        const errorMessage = err instanceof Error ? err.message : '未知錯誤';
        setProcessingStatus(`❌ ${file.name} 處理失敗: ${errorMessage}`);

        // 等待一下讓用戶看到錯誤信息
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // 更新本地顯示
    setRagChunks(prevChunks => [...prevChunks, ...successfulChunks]);

    // 顯示最終結果
    if (successfulChunks.length > 0) {
      setTursoSyncStatus({
        type: 'success',
        message: `所有 ${successfulChunks.length} 個區塊已本地保存！如需同步到雲端，請到設定頁面使用遷移功能。`,
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

    // 只保存到本地，不自動上傳到 Turso
    console.log('Assistant saved locally. Use migration settings to sync to Turso if needed.');

    onSave(newAssistant);
  };

  const fileNames: string[] = [...new Set<string>(ragChunks.map((c: RagChunk) => c.fileName))];

  return (
    <div className='flex flex-col h-full bg-gradient-to-br from-gray-800 to-gray-900 p-8 overflow-y-auto chat-scroll'>
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
          上傳文件以建立可搜尋的知識庫。支援格式：
          <span className='text-cyan-400 font-medium'>.txt, .md, .pdf, .docx</span>
          <br />
          檔案會自動儲存到 Turso 雲端，以提供高效能向量搜尋。
        </p>
        <div className='bg-gray-700/50 border-2 border-dashed border-gray-600/70 rounded-xl p-6 text-center hover:border-cyan-500/50 transition-all duration-300'>
          <input
            type='file'
            multiple
            accept='.txt,.md,.markdown,.pdf,.docx'
            onChange={handleFileChange}
            className='block w-full text-sm text-gray-300 file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-gradient-to-r file:from-cyan-600 file:to-cyan-500 file:text-white hover:file:from-cyan-500 hover:file:to-cyan-400 file:shadow-lg hover:file:shadow-xl file:transition-all file:duration-300 cursor-pointer'
            disabled={!!processingStatus}
          />

          {/* 支援格式指示器 */}
          <div className='mt-4 flex flex-wrap gap-2 justify-center'>
            <span className='px-3 py-1 bg-blue-600/20 border border-blue-500/30 text-blue-300 text-xs rounded-full flex items-center gap-1'>
              📄 TXT
            </span>
            <span className='px-3 py-1 bg-green-600/20 border border-green-500/30 text-green-300 text-xs rounded-full flex items-center gap-1'>
              📝 MD
            </span>
            <span className='px-3 py-1 bg-red-600/20 border border-red-500/30 text-red-300 text-xs rounded-full flex items-center gap-1'>
              📕 PDF
            </span>
            <span className='px-3 py-1 bg-purple-600/20 border border-purple-500/30 text-purple-300 text-xs rounded-full flex items-center gap-1'>
              📘 DOCX
            </span>
          </div>

          {processingStatus && (
            <p className='text-sm text-cyan-400 mt-4 animate-pulse flex items-center justify-center gap-2'>
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
                  onClick={() => {
                    if (canShare && assistant) {
                      onShare?.(assistant);
                    }
                  }}
                  disabled={!canShare}
                  className={`px-6 py-3 rounded-xl font-semibold flex items-center space-x-2 shadow-lg transition-all duration-300 ${
                    canShare
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white hover:shadow-xl transform hover:-translate-y-0.5 cursor-pointer'
                      : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'
                  }`}
                  title={canShare ? '分享助理' : '需要先遷移到 Turso 才能分享'}
                >
                  <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z'
                    />
                  </svg>
                  <span>🎯 分享助理</span>
                </button>
              </div>
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
