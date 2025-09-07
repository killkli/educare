import { GoogleGenAI, Chat, GenerateContentResponse } from '@google/genai';
import { ChatMessage } from '../types';

let ai: GoogleGenAI | null = null;
let initializationAttempted = false;

/**
 * Lazily initializes and returns the GoogleGenAI client instance.
 * Returns null if initialization fails (e.g., missing API key).
 */
const getAi = (): GoogleGenAI | null => {
  if (!initializationAttempted) {
    initializationAttempted = true;
    // Safely access the API key from the environment
    const apiKey = typeof process !== 'undefined' && process.env ? process.env.API_KEY : undefined;

    if (apiKey) {
      ai = new GoogleGenAI({ apiKey });
    } else {
      console.warn('API_KEY environment variable not set. Gemini features will be unavailable.');
    }
  }
  return ai;
};

export const streamChat = async ({
  systemPrompt,
  ragContext,
  history,
  message,
  onChunk,
  onComplete,
}: {
  systemPrompt: string;
  ragContext?: string;
  history: ChatMessage[];
  message: string;
  onChunk: (text: string) => void;
  onComplete: (
    metadata: { promptTokenCount: number; candidatesTokenCount: number },
    fullText: string
  ) => void;
}) => {
  const genAI = getAi();

  if (!genAI) {
    throw new Error(
      'Gemini AI client is not initialized. Please ensure the API_KEY is correctly configured in the environment.'
    );
  }

  const MAX_HISTORY_MESSAGES = 20;
  const truncatedHistory =
    history.length > MAX_HISTORY_MESSAGES ? history.slice(-MAX_HISTORY_MESSAGES) : history;

  let finalSystemPrompt = systemPrompt;
  if (ragContext) {
    const ragPreamble = `Use the information from the following context to inform your response to the user's question. Provide a natural, conversational answer as if the information is part of your general knowledge, without mentioning the context or documents directly. If the answer is not found in the provided information, state that you don't have the relevant information to answer the question. <context> ${ragContext} </context>`;
    finalSystemPrompt = `${systemPrompt}\n\n${ragPreamble}`;
  }

  const chat: Chat = genAI.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: finalSystemPrompt,
    },
    history: truncatedHistory.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }],
    })),
  });

  const stream = await chat.sendMessageStream({ message: message });

  let aggregatedResponse: GenerateContentResponse | null = null;
  let fullResponseText = '';

  for await (const chunk of stream) {
    const chunkText = chunk.text;
    if (chunkText) {
      onChunk(chunkText);
      fullResponseText += chunkText;
    }
    aggregatedResponse = chunk;
  }

  if (aggregatedResponse && aggregatedResponse.usageMetadata) {
    onComplete(
      {
        promptTokenCount: aggregatedResponse.usageMetadata.promptTokenCount ?? 0,
        candidatesTokenCount: aggregatedResponse.usageMetadata.candidatesTokenCount ?? 0,
      },
      fullResponseText
    );
  } else {
    onComplete({ promptTokenCount: 0, candidatesTokenCount: 0 }, fullResponseText);
  }
};
