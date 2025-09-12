# EduCare - 教育 AI 助理

**為財團法人博幼社會福利基金會設計的客製化教學聊天助理工具**

EduCare 是一個專為偏鄉弱勢兒童教育打造的 AI 教學助理平台。基於財團法人博幼社會福利基金會「博學幼教，關懷弱勢」的理念，提供個人化學習支援、課後輔導，以及先進的 Retrieval-Augmented Generation (RAG) 功能，支援 PDF、DOCX 和 MD 教材處理。使用 Google Gemini API 驅動，結合 Turso DB 雲端持久化與 QR 碼分享。

## 🎯 專案使命

財團法人博幼社會福利基金會自 2002 年起致力於偏鄉弱勢兒童教育，透過課後輔導和教育資源分享，縮短城鄉教育差距。EduCare 運用 AI 技術提供：

- 📚 **個人化學習輔導** - 根據學生需求調整教學內容，使用 RAG 從上傳教材中檢索相關資訊
- 🤖 **24/7 學習陪伴** - 隨時可用的教學助理，支援多種 AI 提供者 (Gemini, Groq, OpenAI 等)
- 📄 **多元教材支援** - 處理 PDF、DOCX、MD 文件，智能分塊、嵌入向量，並進行相似度搜尋
- 🌐 **跨裝置同步** - Turso DB 雲端儲存，支援多裝置存取與資料同步
- 🔗 **教師協作** - 教師可分享和管理教學助理，包含安全連結與 QR 碼

## 🚀 快速開始

**系統需求:** Node.js 18+ 和 pnpm

1. **安裝相依套件:**

   ```bash
   pnpm install
   ```

2. **設定環境變數:**
   複製 `.env.local` 並設定 AI API 金鑰 (e.g., GEMINI_API_KEY) 和 Turso DB 憑證 (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)。

3. **初始化資料庫 (選用):**

   ```bash
   pnpm run init-turso
   ```

4. **啟動開發伺服器:**
   ```bash
   pnpm run dev
   ```
   應用程式將在 http://localhost:5173 運行。

## ✨ 核心功能

### 🎓 教學功能

- **智慧問答與 RAG**: 上傳教材文件，AI 從中檢索相關內容提供情境化回應 (使用 HuggingFace 嵌入與 Turso 向量搜尋)
- **個人化輔導**: 客製系統提示，調整教學風格；聊天歷史自動壓縮 (限 10 輪對話)
- **串流回應**: 即時顯示 AI 回應，包含 token 計數與思考指示器
- **學習追蹤**: 記錄聊天會話與進度，支援跨裝置同步

### 👩‍🏫 教師工具

- **助理管理**: 建立/編輯助理 (名稱、描述、系統提示、RAG 塊)，透過 AssistantEditor
- **教材整合**: RAGFileUpload 處理文件，儲存至 Turso DB
- **分享協作**: ShareModal 生成 QR 碼與連結，支援公開/私人模式與新對話按鈕
- **使用分析**: 監控 token 使用與會話元資料

### 🛡️ 安全與效能

- **API 金鑰管理**: 使用者端設定，加密儲存
- **遷移支援**: 從 IndexedDB 遷移至 Turso DB
- **效能優化**: 預載嵌入模型、響應式 UI (支援手機/平板/電腦)

## 🏗️ 技術架構

- **前端框架**: React 19.1.1 + TypeScript + Vite (快速開發與建置)
- **狀態管理**: React Context 與 hooks (無外部庫)
- **資料庫**: Turso DB (雲端 SQLite 與向量搜尋) + IndexedDB 離線後備
- **AI 整合**: 模組化提供者 (geminiService.ts 等)，支援串流聊天與多模型
- **RAG 實現**: fileProcessingService.ts (解析文件) → embeddingService.ts (向量) → tursoService.ts (儲存/搜尋)
- **分享系統**: sharingService.ts 與 qrcode 庫
- **路徑別名**: `@/*` 指向專案根目錄

### 資料模型

- **Assistant**: id, name, description, systemPrompt, ragChunks?, createdAt, isShared?
- **ChatSession**: assistantId, messages (ChatMessage[]), token 計數
- **RagChunk**: 檔案元資料、內容塊、向量嵌入
- **ChatMessage**: role ('user'|'model'), content, timestamp

## 🛠️ 開發指令

| 指令                        | 說明                                             |
| --------------------------- | ------------------------------------------------ |
| `pnpm run dev`              | 啟動開發伺服器                                   |
| `pnpm run build`            | 建置正式版本                                     |
| `pnpm run preview`          | 預覽正式版本                                     |
| `pnpm run quality`          | 執行所有品質檢查 (lint, format, typecheck, test) |
| `pnpm run test`             | 執行 Vitest 測試                                 |
| `pnpm run test:ui`          | 執行測試 UI 介面                                 |
| `pnpm run lint:fix`         | 自動修復 lint 問題                               |
| `pnpm run init-turso`       | 初始化 Turso 資料庫                              |
| `pnpm run migrate-to-turso` | 遷移資料至 Turso                                 |

### 測試與 E2E

- **單元測試**: Vitest + React Testing Library (components/_.test.tsx, services/_.test.ts)
- **E2E 測試**: Playwright (tests/e2e/\*.spec.ts)，包含模型比較與分享測試
- **覆蓋率**: `pnpm run test:coverage`

## 📁 專案結構

```
├── components/          # React UI 元件 (assistant/, chat/, ui/, settings/, core/)
├── services/            # 業務邏輯 (db.ts, tursoService.ts, geminiService.ts, embeddingService.ts 等)
├── scripts/             # 工具腳本 (initTurso.ts, migrateToTurso.ts, testVectorSearch.ts)
├── types.ts             # TypeScript 介面定義
├── App.tsx              # 主應用程式
├── CLAUDE.md            # Claude Code 開發指南
└── package.json         # 相依與腳本
```

## 🔧 品質保證

- **ESLint + Prettier**: 程式碼風格強制
- **TypeScript**: 嚴格型別檢查
- **Husky + lint-staged**: 預提交鉤子
- **測試慣例**: AAA 模式，模擬外部 API
- **品質關卡**: 所有檢查通過方可提交

## 🌟 近期更新

- **RAG 強化**: 可配置設定、Jina AI 重新排序
- **測試擴充**: Playwright E2E 與模型比較
- **分享改進**: 移除未用屬性、新對話按鈕
- **資料庫遷移**: 完整 IndexedDB → Turso 支援

## 🤝 貢獻指南

歡迎貢獻！請遵循 CLAUDE.md 中的開發規範。使用 `pnpm run quality` 驗證變更。

## 📄 授權

MIT 授權 - 詳見 [LICENSE](LICENSE)。

---

**財團法人博幼社會福利基金會 × 教育科技創新**  
讓每個孩子都有平等的學習機會 🌟
