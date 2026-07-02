# EduCare - Educational AI Assistant

**Customized Educational Chat Assistant for Boyo Social Welfare Foundation**

EduCare is an AI-powered educational assistant platform designed specifically for underserved rural children. Built on Boyo Social Welfare Foundation's mission of "博學幼教，關懷弱勢" (Enlightening Education, Caring for the Vulnerable), it provides personalized learning support, after-school tutoring, and advanced Retrieval-Augmented Generation (RAG) capabilities with support for PDF, DOCX, and MD educational materials. Powered by Google Gemini API, integrated with Turso DB for cloud persistence and QR code sharing.

## 🎯 Project Mission

Since 2002, Boyo Social Welfare Foundation has been dedicated to education for disadvantaged rural children, bridging urban-rural education gaps through after-school tutoring and resource sharing. EduCare leverages AI to deliver:

- 📚 **Personalized Learning Support** - Tailors content to student needs, using RAG to retrieve relevant information from uploaded materials
- 🤖 **24/7 Learning Companion** - Always-available tutoring assistant supporting multiple AI providers (Gemini, Groq, OpenAI, etc.)
- 📄 **Multi-Format Material Support** - Handles PDF, DOCX, MD files with intelligent chunking, vector embeddings, and similarity search
- 🌐 **Cross-Device Sync** - Turso DB cloud storage for multi-device access and data synchronization
- 🔗 **Teacher Collaboration** - Teachers can share and manage assistants with secure links and QR codes

## 🚀 Quick Start

**Requirements:** Node.js 18+ and pnpm

1. **Install Dependencies:**

   ```bash
   pnpm install
   ```

2. **Set Environment Variables:**
   Copy `.env.local` and configure AI API keys (e.g., GEMINI_API_KEY) and Turso DB credentials (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN).

3. **Initialize Database (Optional):**

   ```bash
   pnpm run init-turso
   ```

4. **Start Development Server:**

   ```bash
   pnpm run dev
   ```

   The app will run at http://localhost:5173.

   To test browser encryption and other secure-context APIs with a self-signed local certificate, use:

   ```bash
   pnpm run dev:https
   ```

   This starts the app at https://localhost:5173. Your browser will show a self-signed certificate warning the first time; accept it once to continue local testing.

## ✨ Core Features

### 🎓 Educational Features

- **Intelligent Q&A with RAG**: Upload teaching materials; AI retrieves and provides contextual responses (using HuggingFace embeddings and Turso vector search)
- **Personalized Tutoring**: Custom system prompts to adjust teaching style; automatic chat history compaction (limited to 10 rounds)
- **Streaming Responses**: Real-time AI replies with token counting and thinking indicators
- **Learning Tracking**: Records chat sessions and progress, with cross-device sync

### 👩‍🏫 Teacher Tools

- **Assistant Management**: Create/edit assistants (name, description, system prompt, RAG chunks) via AssistantEditor
- **Material Integration**: RAGFileUpload processes files, stores in Turso DB
- **Sharing Collaboration**: ShareModal generates QR codes and links, supporting public/private modes and new conversation buttons
- **Usage Analytics**: Monitors token usage and session metadata

### 🛡️ Security & Performance

- **API Key Management**: User-configurable, encrypted storage
- **Migration Support**: Seamless from IndexedDB to Turso DB
- **Performance Optimizations**: Preloaded embedding models, responsive UI (mobile/tablet/desktop)

## 🏗️ Technical Architecture

- **Frontend Framework**: React 19.1.1 + TypeScript + Vite (fast dev and build)
- **State Management**: React Context and hooks (no external libs)
- **Database**: Turso DB (cloud SQLite with vector search) + IndexedDB offline fallback
- **AI Integration**: Modular providers (geminiService.ts etc.), supporting streaming chat and multi-models
- **RAG Implementation**: fileProcessingService.ts (file parsing) → embeddingService.ts (vectors) → tursoService.ts (store/search)
- **Sharing System**: sharingService.ts with qrcode library
- **Path Aliases**: `@/*` points to project root

### Data Models

- **Assistant**: id, name, description, systemPrompt, ragChunks?, createdAt, isShared?
- **ChatSession**: assistantId, messages (ChatMessage[]), token counts
- **RagChunk**: File metadata, content chunks, vector embeddings
- **ChatMessage**: role ('user'|'model'), content, timestamp

## 🛠️ Development Commands

| Command                     | Description                                            |
| --------------------------- | ------------------------------------------------------ |
| `pnpm run dev`              | Start HTTP dev server                                  |
| `pnpm run dev:https`        | Start self-signed HTTPS dev server                     |
| `pnpm run build`            | Build production version                               |
| `pnpm run preview`          | Preview production build                               |
| `pnpm run quality`          | Run all quality checks (lint, format, typecheck, test) |
| `pnpm run test`             | Run Vitest tests                                       |
| `pnpm run test:ui`          | Run test UI interface                                  |
| `pnpm run lint:fix`         | Auto-fix lint issues                                   |
| `pnpm run init-turso`       | Initialize Turso DB                                    |
| `pnpm run migrate-to-turso` | Migrate data to Turso                                  |

### Testing & E2E

- **Unit Tests**: Vitest + React Testing Library (components/_.test.tsx, services/_.test.ts)
- **E2E Tests**: Playwright (tests/e2e/\*.spec.ts), including model comparison and sharing tests
- **Coverage**: `pnpm run test:coverage`

## 📁 Project Structure

```
├── components/          # React UI components (assistant/, chat/, ui/, settings/, core/)
├── services/            # Business logic (db.ts, tursoService.ts, geminiService.ts, embeddingService.ts etc.)
├── scripts/             # Utility scripts (initTurso.ts, migrateToTurso.ts, testVectorSearch.ts)
├── types.ts             # TypeScript interfaces
├── App.tsx              # Main app component
├── CLAUDE.md            # Claude Code dev guide
└── package.json         # Dependencies & scripts
```

## 🔧 Quality Assurance

- **ESLint + Prettier**: Code style enforcement
- **TypeScript**: Strict type checking
- **Husky + lint-staged**: Pre-commit hooks
- **Test Conventions**: AAA pattern, mock external APIs
- **Quality Gates**: All checks must pass before commit

## 🌟 Recent Updates

- **RAG Enhancements**: Configurable settings, Jina AI reranking
- **Testing Expansion**: Playwright E2E and model comparison
- **Sharing Improvements**: Remove unused props, new conversation button
- **Database Migration**: Full IndexedDB → Turso support

## 🤝 Contribution Guide

Contributions welcome! Follow CLAUDE.md guidelines. Use `pnpm run quality` to validate changes.

## 📄 License

MIT License - see [LICENSE](LICENSE).

---

**Boyo Social Welfare Foundation × EdTech Innovation**  
Equal learning opportunities for every child 🌟
