import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ChatSession, RagChunk } from '../types';
import { UserIcon, GeminiIcon } from './Icons';
import { streamChat } from '../services/geminiService';
import { generateEmbedding, cosineSimilarity } from '../services/embeddingService';

interface ChatWindowProps {
  session: ChatSession;
  assistantName: string;
  systemPrompt: string;
  ragChunks: RagChunk[];
  onNewMessage: (session: ChatSession, userMessage: string, modelResponse: string, tokenInfo: {promptTokenCount: number, candidatesTokenCount: number}) => Promise<void>;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ session, assistantName, systemPrompt, ragChunks, onNewMessage }) => {
  const [input, setInput] = useState('');
  const [streamingResponse, setStreamingResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [session.messages, streamingResponse]);

  const findRelevantContext = async (message: string): Promise<string> => {
    if (ragChunks.length === 0) {
      return '';
    }

    try {
        const queryVector = await generateEmbedding(message, 'query');
        
        const scoredChunks = ragChunks.map(chunk => ({
            ...chunk,
            similarity: cosineSimilarity(queryVector, chunk.vector)
        }));

        scoredChunks.sort((a, b) => b.similarity - a.similarity);

        const topChunks = scoredChunks.slice(0, 5); // Take top 5 relevant chunks
        
        // Filter out chunks with low similarity to avoid irrelevant context
        const relevantChunks = topChunks.filter(chunk => chunk.similarity > 0.5);

        return relevantChunks.map(chunk => chunk.content).join('\n\n---\n\n');

    } catch (error) {
        console.error("Error finding relevant context:", error);
        return ''; // Return empty context on error
    }
  };


  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);
    setStreamingResponse('');

    try {
        let ragContext = '';
        if (ragChunks.length > 0) {
            setStatusText('Finding relevant context from knowledge files...');
            ragContext = await findRelevantContext(userMessage);
            setStatusText(ragContext ? 'Context found. Querying model...' : 'No specific context found. Querying model...');
        } else {
            setStatusText('Querying model...');
        }

        await streamChat({
            systemPrompt,
            ragContext,
            history: session.messages,
            message: userMessage,
            onChunk: (chunk) => {
                setStreamingResponse(prev => prev + chunk);
            },
            onComplete: (tokenInfo, fullModelResponse) => {
                setIsLoading(false);
                setStatusText('');
                onNewMessage(session, userMessage, fullModelResponse, tokenInfo);
                setStreamingResponse(''); 
            }
        });
    } catch (error) {
        console.error("Error during chat stream:", error);
        setIsLoading(false);
        setStatusText('');
        setStreamingResponse(`Sorry, an error occurred. The API returned the following error:\n\n${(error as Error).message}\n\nPlease check your API key and the console for more details.`);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };
  
  const renderMessageContent = (content: string) => {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={lastIndex}>{content.substring(lastIndex, match.index)}</span>);
      }
      const language = match[1] || 'text';
      const code = match[2];
      parts.push(
        <div key={match.index} className="bg-gray-900 rounded-md my-2">
          <div className="flex justify-between items-center px-4 py-1 bg-gray-700 rounded-t-md">
            <span className="text-sm text-gray-300">{language}</span>
            <button onClick={() => navigator.clipboard.writeText(code)} className="text-xs text-gray-400 hover:text-white">Copy</button>
          </div>
          <pre className="p-4 text-sm whitespace-pre-wrap overflow-x-auto"><code>{code}</code></pre>
        </div>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(<span key={lastIndex}>{content.substring(lastIndex)}</span>);
    }

    return <div>{parts}</div>;
  };


  return (
    <div className="flex flex-col h-full bg-gray-800">
      <div className="p-4 border-b border-gray-700 flex-shrink-0">
        <h2 className="text-xl font-semibold text-white">{assistantName}</h2>
      </div>
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="space-y-6">
          {session.messages.map((msg, index) => (
            <div key={index} className={`flex items-start gap-4 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'model' && <GeminiIcon className="w-8 h-8 text-cyan-400 flex-shrink-0 mt-1" />}
              <div className={`max-w-xl p-4 rounded-xl ${msg.role === 'model' ? 'bg-gray-700 text-gray-200' : 'bg-cyan-800 text-white'}`}>
                {renderMessageContent(msg.content)}
              </div>
              {msg.role === 'user' && <UserIcon className="w-8 h-8 text-gray-400 flex-shrink-0 mt-1" />}
            </div>
          ))}
          {streamingResponse && (
            <div className="flex items-start gap-4">
              <GeminiIcon className="w-8 h-8 text-cyan-400 flex-shrink-0 mt-1" />
              <div className="max-w-xl p-4 rounded-xl bg-gray-700 text-gray-200">
                {renderMessageContent(streamingResponse)}
                <span className="inline-block w-2 h-4 bg-white ml-1 animate-pulse"></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="p-4 border-t border-gray-700">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Type your message..."
            rows={1}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg py-3 pl-4 pr-20 resize-none focus:ring-cyan-500 focus:border-cyan-500 text-white"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="absolute right-3 top-1/2 -translate-y-1/2 px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-semibold"
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </div>
        <div className="flex justify-between items-center text-xs text-gray-500 mt-2 pr-2 h-4">
            <span className="text-cyan-400 animate-pulse">{statusText}</span>
            <span>Token Count: {session.tokenCount}</span>
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;