import React, { useState, useEffect } from 'react';
import { Assistant, RagChunk } from '../types';
import { generateEmbedding } from '../services/embeddingService';
import {
  saveRagChunkToTurso,
  getRagChunkCount,
  saveAssistantToTurso,
} from '../services/tursoService';

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
      setSystemPrompt('You are a helpful and professional AI assistant.');
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
        setProcessingStatus('Creating assistant in Turso...');
        await saveAssistantToTurso({
          id: assistantId,
          name: name.trim() || 'New Assistant',
          description: description.trim() || 'A helpful AI assistant',
          systemPrompt: systemPrompt.trim() || 'You are a helpful AI assistant.',
          createdAt: Date.now(),
        });
      } catch (error) {
        console.error('Failed to create assistant in Turso:', error);
        setProcessingStatus(
          '⚠️ Failed to create assistant in cloud, continuing with local storage...'
        );
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    setProcessingStatus('Starting file processing...');
    const successfulChunks: RagChunk[] = [];
    const failedChunks: { file: string; chunk: number; error: string }[] = [];

    for (const file of files) {
      if (file.type === 'text/plain') {
        try {
          setProcessingStatus(`Reading ${file.name}...`);
          const content = await file.text();
          const textChunks = chunkText(content);

          for (let i = 0; i < textChunks.length; i++) {
            setProcessingStatus(`Embedding chunk ${i + 1}/${textChunks.length} of ${file.name}...`);
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
                    setProcessingStatus(
                      `Downloading embedding model... ${Math.round(progressObj.progress)}%`
                    );
                  }
                }
              }
            );

            // 優先儲存到 Turso 雲端
            try {
              setProcessingStatus(`Saving chunk ${i + 1}/${textChunks.length} to Turso cloud...`);
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

              setProcessingStatus(`✅ Chunk ${i + 1}/${textChunks.length} saved to cloud`);
            } catch (tursoError) {
              console.error('Failed to save chunk to Turso:', tursoError);
              failedChunks.push({
                file: file.name,
                chunk: i + 1,
                error: tursoError instanceof Error ? tursoError.message : String(tursoError),
              });

              // 嘗試作為後備儲存到本地
              setProcessingStatus(`⚠️ Cloud failed, saving chunk ${i + 1} locally...`);
              const ragChunk = { fileName: file.name, content: textChunks[i], vector };
              successfulChunks.push(ragChunk);
            }
          }
        } catch (err) {
          console.error(`Error processing file ${file.name}:`, err);
          setProcessingStatus(`Error with ${file.name}.`);
        }
      }
    }

    // 更新本地顯示
    setRagChunks(prevChunks => [...prevChunks, ...successfulChunks]);

    // 顯示最終結果
    if (failedChunks.length > 0) {
      setTursoSyncStatus({
        type: 'warning',
        message: `${successfulChunks.length} chunks processed, ${failedChunks.length} failed to sync to cloud. Some data is only stored locally.`,
      });
      setProcessingStatus(null);
      setTimeout(() => setTursoSyncStatus(null), 8000);
    } else if (successfulChunks.length > 0) {
      setTursoSyncStatus({
        type: 'success',
        message: `All ${successfulChunks.length} chunks successfully saved to Turso cloud!`,
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
        message: 'Please save the assistant first before generating a share link.',
      });
      setTimeout(() => setShareStatus(null), 3000);
      return;
    }

    // 生成分享連結 URL
    const shareUrl = `${window.location.origin}${window.location.pathname}?share=${assistant.id}`;

    try {
      // 複製到剪貼板
      await navigator.clipboard.writeText(shareUrl);

      setShareStatus({
        type: 'success',
        message: `Share link copied to clipboard! Anyone with this link can chat with ${assistant.name}.`,
      });

      // 5秒後自動清除狀態
      setTimeout(() => setShareStatus(null), 5000);
    } catch {
      // 如果剪貼板 API 失敗，顯示 URL 讓用戶手動複製
      setShareStatus({
        type: 'info',
        message: `Share link: ${shareUrl}`,
      });

      // 10秒後清除，給用戶足夠時間複製
      setTimeout(() => setShareStatus(null), 10000);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert('Assistant name is required.');
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
      alert('Warning: Assistant saved locally but failed to sync to Turso database');
    }

    onSave(newAssistant);
  };

  const fileNames = [...new Set(ragChunks.map(c => c.fileName))];

  return (
    <div className='flex flex-col h-full bg-gray-800 p-6 overflow-y-auto'>
      <h2 className='text-2xl font-bold mb-6 text-white'>
        {assistant ? 'Edit Assistant' : 'Create New Assistant'}
      </h2>

      <div className='mb-4'>
        <label htmlFor='name' className='block text-sm font-medium text-gray-400 mb-1'>
          Assistant Name
        </label>
        <input
          type='text'
          id='name'
          value={name}
          onChange={e => setName(e.target.value)}
          className='w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-cyan-500 focus:border-cyan-500'
          placeholder='e.g., Marketing Copywriter'
        />
      </div>

      <div className='mb-4'>
        <label htmlFor='description' className='block text-sm font-medium text-gray-400 mb-1'>
          Public Description
          <span className='text-xs text-gray-500 ml-2'>(shown to users when shared)</span>
        </label>
        <textarea
          id='description'
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className='w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-cyan-500 focus:border-cyan-500'
          placeholder='Brief description of what this assistant can help with...'
        />
      </div>

      <div className='mb-4'>
        <label htmlFor='systemPrompt' className='block text-sm font-medium text-gray-400 mb-1'>
          System Prompt
        </label>
        <textarea
          id='systemPrompt'
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          rows={8}
          className='w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-cyan-500 focus:border-cyan-500'
          placeholder="Define the assistant's role, personality, and instructions."
        />
      </div>

      <div className='mb-6'>
        <label className='block text-sm font-medium text-gray-400 mb-2'>
          Knowledge Files (RAG)
          {ragChunkCount > 0 && (
            <span className='ml-2 px-2 py-1 bg-cyan-600 text-white text-xs rounded-full'>
              {ragChunkCount} chunks in Turso
            </span>
          )}
        </label>
        <p className='text-xs text-gray-500 mb-2'>
          Upload .txt files to create a searchable knowledge base. Files are automatically saved to
          Turso cloud for high-performance vector search.
        </p>
        <div className='bg-gray-700 border-2 border-dashed border-gray-600 rounded-md p-4 text-center'>
          <input
            type='file'
            multiple
            accept='.txt'
            onChange={handleFileChange}
            className='block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-600 file:text-white hover:file:bg-cyan-700 cursor-pointer'
            disabled={!!processingStatus}
          />
          {processingStatus && (
            <p className='text-sm text-cyan-400 mt-2 animate-pulse'>{processingStatus}</p>
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
        {/* Left side - Share button (only show for existing assistants) */}
        <div className='flex-1'>
          {assistant && (
            <button
              onClick={generateShareLink}
              className='px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center space-x-2'
            >
              <span>🔗</span>
              <span>Generate Share Link</span>
            </button>
          )}
        </div>

        {/* Right side - Save and Cancel buttons */}
        <div className='flex space-x-4'>
          <button
            onClick={onCancel}
            className='px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold'
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className='px-6 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-bold'
            disabled={!!processingStatus}
          >
            {processingStatus ? 'Processing...' : 'Save Assistant'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssistantEditor;
