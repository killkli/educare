import React, { useState, useEffect } from 'react';
import { Assistant, RagChunk } from '../types';
import { generateEmbedding } from '../services/embeddingService';

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
        if (sentenceWords.length === 0) continue;

        if (currentChunkWords.length + sentenceWords.length > chunkSizeInWords && currentChunkWords.length > 0) {
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
  const [systemPrompt, setSystemPrompt] = useState('');
  const [ragChunks, setRagChunks] = useState<RagChunk[]>([]);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);

  useEffect(() => {
    if (assistant) {
      setName(assistant.name);
      setSystemPrompt(assistant.systemPrompt);
      setRagChunks(assistant.ragChunks);
    } else {
      setName('');
      setSystemPrompt('You are a helpful and professional AI assistant.');
      setRagChunks([]);
    }
  }, [assistant]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return;
    
    const files: File[] = Array.from(event.target.files);
    if(files.length === 0) return;

    setProcessingStatus('Starting file processing...');
    const newChunks: RagChunk[] = [];
    
    for (const file of files) {
      if (file.type === 'text/plain') {
        try {
          setProcessingStatus(`Reading ${file.name}...`);
          const content = await file.text();
          const textChunks = chunkText(content);
          
          for (let i = 0; i < textChunks.length; i++) {
              setProcessingStatus(`Embedding chunk ${i+1}/${textChunks.length} of ${file.name}...`);
              const vector = await generateEmbedding(textChunks[i], 'document', (progress: any) => {
                  if (progress.status === 'progress') {
                     setProcessingStatus(`Downloading embedding model... ${Math.round(progress.progress)}%`);
                  }
              });
              newChunks.push({ fileName: file.name, content: textChunks[i], vector });
          }
        } catch (err) {
          console.error(`Error processing file ${file.name}:`, err);
          setProcessingStatus(`Error with ${file.name}.`);
        }
      }
    }
    setRagChunks(prevChunks => [...prevChunks, ...newChunks]);
    setProcessingStatus(null);
  };
  
  const removeDocument = (fileName: string) => {
    setRagChunks(chunks => chunks.filter(chunk => chunk.fileName !== fileName));
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert("Assistant name is required.");
      return;
    }
    const newAssistant: Assistant = {
      id: assistant?.id || `asst_${Date.now()}`,
      name: name.trim(),
      systemPrompt: systemPrompt.trim(),
      ragChunks: ragChunks,
      createdAt: assistant?.createdAt || Date.now(),
    };
    onSave(newAssistant);
  };
  
  const fileNames = [...new Set(ragChunks.map(c => c.fileName))];

  return (
    <div className="flex flex-col h-full bg-gray-800 p-6 overflow-y-auto">
      <h2 className="text-2xl font-bold mb-6 text-white">{assistant ? 'Edit Assistant' : 'Create New Assistant'}</h2>
      
      <div className="mb-4">
        <label htmlFor="name" className="block text-sm font-medium text-gray-400 mb-1">Assistant Name</label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-cyan-500 focus:border-cyan-500"
          placeholder="e.g., Marketing Copywriter"
        />
      </div>

      <div className="mb-4">
        <label htmlFor="systemPrompt" className="block text-sm font-medium text-gray-400 mb-1">System Prompt</label>
        <textarea
          id="systemPrompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={8}
          className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white focus:ring-cyan-500 focus:border-cyan-500"
          placeholder="Define the assistant's role, personality, and instructions."
        />
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-400 mb-2">Knowledge Files (RAG)</label>
        <p className="text-xs text-gray-500 mb-2">Upload .txt files to create a searchable knowledge base.</p>
        <div className="bg-gray-700 border-2 border-dashed border-gray-600 rounded-md p-4 text-center">
            <input
                type="file"
                multiple
                accept=".txt"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-600 file:text-white hover:file:bg-cyan-700 cursor-pointer"
                disabled={!!processingStatus}
            />
            {processingStatus && <p className="text-sm text-cyan-400 mt-2 animate-pulse">{processingStatus}</p>}
        </div>
        <div className="mt-4 space-y-2">
            {fileNames.map(fileName => (
                <div key={fileName} className="flex items-center justify-between bg-gray-700 p-2 rounded-md text-sm">
                    <span className="truncate text-gray-300">{fileName}</span>
                    <button onClick={() => removeDocument(fileName)} className="text-red-500 hover:text-red-400 ml-4">&times;</button>
                </div>
            ))}
        </div>
      </div>

      <div className="mt-auto flex justify-end space-x-4">
        <button onClick={onCancel} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold">
          Cancel
        </button>
        <button onClick={handleSave} className="px-6 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-bold" disabled={!!processingStatus}>
          {processingStatus ? 'Processing...' : 'Save Assistant'}
        </button>
      </div>
    </div>
  );
};

export default AssistantEditor;