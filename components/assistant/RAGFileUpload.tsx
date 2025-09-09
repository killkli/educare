import React, { useState } from 'react';
import { RagChunk } from '../../types';
import { generateEmbedding } from '../../services/embeddingService';
import { saveRagChunkToTurso, saveAssistantToTurso } from '../../services/tursoService';
import { DocumentParserService } from '../../services/documentParserService';
import { RAGFileUploadProps } from './types';

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

export const RAGFileUpload: React.FC<RAGFileUploadProps> = ({
  ragChunks,
  onRagChunksChange,
  disabled = false,
}) => {
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [ragChunkCount, setRagChunkCount] = useState<number>(0);
  const [tursoSyncStatus, setTursoSyncStatus] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
    assistantId?: string,
    assistantName?: string,
    assistantDescription?: string,
    systemPrompt?: string,
  ) => {
    if (!event.target.files) {
      return;
    }

    const files: File[] = Array.from(event.target.files);
    if (files.length === 0) {
      return;
    }

    // 需要先有 assistant ID 才能儲存到 Turso
    const targetAssistantId = assistantId || `asst_${Date.now()}`;

    // 如果是新助手，需要先確保助手基本資料存在於 Turso
    if (!assistantId) {
      try {
        setProcessingStatus('在 Turso 中建立助理...');
        await saveAssistantToTurso({
          id: targetAssistantId,
          name: assistantName?.trim() || '新助理',
          description: assistantDescription?.trim() || '一個有用的 AI 助理',
          systemPrompt: systemPrompt?.trim() || '您是一個有用的 AI 助理。',
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

          // 優先儲存到 Turso 雲端
          try {
            setProcessingStatus(`保存 ${i + 1}/${textChunks.length} 區塊到 Turso 雲端...`);
            await saveRagChunkToTurso(
              {
                id: `chunk_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`,
                assistantId: targetAssistantId,
                fileName: file.name,
                content: textChunks[i],
                createdAt: Date.now(),
              },
              vector,
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
        const errorMessage = err instanceof Error ? err.message : '未知錯誤';
        setProcessingStatus(`❌ ${file.name} 處理失敗: ${errorMessage}`);

        // 等待一下讓用戶看到錯誤信息
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // 更新父組件的 RAG chunks
    onRagChunksChange([...ragChunks, ...successfulChunks]);

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
    const filteredChunks = ragChunks.filter(chunk => chunk.fileName !== fileName);
    onRagChunksChange(filteredChunks);
  };

  const fileNames: string[] = [...new Set<string>(ragChunks.map((c: RagChunk) => c.fileName))];

  return (
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
          disabled={disabled || !!processingStatus}
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
              disabled={disabled}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
