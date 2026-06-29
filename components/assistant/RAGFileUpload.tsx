import React, { useState } from 'react';
import { RagChunk } from '../../types';
import { DocumentParserService } from '../../services/documentParserService';
import { chunkText, DEFAULT_CHUNKING_OPTIONS } from '../../services/textChunkingService';
import { RAGFileUploadProps } from './types';

export const RAGFileUpload: React.FC<RAGFileUploadProps> = ({
  ragChunks,
  onRagChunksChange,
  disabled = false,
}) => {
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [tursoSyncStatus, setTursoSyncStatus] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
    _assistantId?: string,
    _assistantName?: string,
    _assistantDescription?: string,
    _systemPrompt?: string,
  ) => {
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
        const chunkingResult = chunkText(parsedDocument.content, DEFAULT_CHUNKING_OPTIONS);
        const textChunks = chunkingResult.chunks;

        setProcessingStatus(`✅ ${fileTypeName} 解析完成，共 ${textChunks.length} 個區塊`);

        for (let i = 0; i < textChunks.length; i++) {
          setProcessingStatus(`儲存 ${file.name} 的 ${i + 1}/${textChunks.length} 區塊...`);

          // 只保存到本地，不自動上傳到 Turso
          const ragChunk = { fileName: file.name, content: textChunks[i] };
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

    // 更新父組件的 RAG chunks
    onRagChunksChange([...ragChunks, ...successfulChunks]);

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
    const filteredChunks = ragChunks.filter(chunk => chunk.fileName !== fileName);
    onRagChunksChange(filteredChunks);
  };

  const fileNames: string[] = [...new Set<string>(ragChunks.map((c: RagChunk) => c.fileName))];

  return (
    <div className='mb-8'>
      <label className='block text-sm font-semibold text-gray-300 mb-2'>知識檔案 (RAG)</label>
      <p className='text-sm text-gray-400 mb-4 leading-relaxed'>
        上傳文件以建立可搜尋的知識庫。支援格式：
        <span className='text-cyan-400 font-medium'>.txt, .md, .pdf, .docx</span>
        <br />
        檔案會儲存到本地。如需同步到雲端，請使用設定頁面的遷移功能。
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
