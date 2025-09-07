# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Gemini Professional Assistant application - a React-based web app that allows users to create, manage, and chat with AI assistants powered by Google's Gemini API. The app features RAG (Retrieval-Augmented Generation) capabilities, IndexedDB for local storage, and Google Sheets integration for sharing assistants.

## Development Commands

- **Start development server**: `npm run dev` (runs on Vite)
- **Build for production**: `npm run build`
- **Preview production build**: `npm run preview`
- **Install dependencies**: `npm install`

## Architecture

### Core Components

- **App.tsx**: Main application orchestrating assistants, sessions, and view modes (chat, edit, settings)
- **types.ts**: Core TypeScript interfaces defining Assistant, ChatSession, ChatMessage, and RagChunk
- **components/**: React components for UI (AssistantEditor, ChatWindow, Icons)
- **services/**: Business logic and external integrations

### Data Layer

- **services/db.ts**: IndexedDB operations using `idb` library for local storage of assistants and chat sessions
- **services/geminiService.ts**: Google Gemini AI integration with streaming chat capabilities
- **services/embeddingService.ts**: Vector embeddings for RAG functionality using HuggingFace transformers
- **services/googleSheetService.ts**: Google Sheets sync for sharing assistants

### Key Architecture Patterns

- **State Management**: React hooks with local component state, no external state library
- **Data Flow**: IndexedDB → React state → UI components
- **AI Integration**: Streaming responses from Gemini with token counting and chat history truncation (max 20 messages)
- **RAG Implementation**: Text chunking, vector embeddings, and similarity search for context injection

### Environment Configuration

- **GEMINI_API_KEY**: Required in `.env.local` for AI functionality
- **Vite Configuration**: Exposes environment variables as `process.env.API_KEY` and `process.env.GEMINI_API_KEY`

### Data Models

- **Assistant**: Has name, systemPrompt, ragChunks (for context), and timestamps
- **ChatSession**: Belongs to assistant, contains message history and token counts
- **RAG Integration**: File content is chunked, vectorized, and stored with assistants for contextual responses

### Build System

- **TypeScript + React**: Modern React with TypeScript, using Vite for bundling
- **Dependencies**: Core libraries include @google/genai, @huggingface/transformers, idb, react 19.1.1
- **Path Aliases**: `@/*` maps to project root for imports

## Important Notes

- The app requires a valid Gemini API key to function
- Local data persists in browser IndexedDB
- Google Sheets integration is optional for sharing features
- RAG chunks are stored as vectors alongside assistant definitions
- Chat sessions have token counting and automatic history truncation
