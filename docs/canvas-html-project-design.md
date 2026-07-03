# Browser-only HTML Project Canvas 設計提案

## 目標

在 EduCare 內加入一個類似 Google Gemini Canvas 的能力：

1. 使用者在聊天中要求「做一個網頁 / APP prototype / landing page / widget」。
2. LLM 不直接把超長 HTML 一次吐回聊天視窗，而是透過工具呼叫建立或更新一個 **browser-only HTML Project**。
3. 前端把該 project 存進瀏覽器本地儲存。
4. UI 在聊天旁或工作區內用 `iframe` 即時預覽專案入口檔。
5. 全程 **不需要後端**。

---

## 現況與整合基礎

目前程式碼已經有三個非常適合延伸的基礎：

### 1. 現有 LLM tool-calling 管線已可重用

- `services/llmService.ts`
  - `streamChat()` 已經根據 `knowledgeChunks` 動態注入 tools，並以 `executeTool()` 在前端處理工具回傳。
- `services/llmAdapter.ts`
  - `ChatParams` 已支援 `tools?: ToolDefinition[]` 與 `executeTool?: (call: ToolCall) => Promise<unknown>`。
- `services/providers/geminiProvider.ts`
  - `GeminiProvider.streamChat()` 已支援 function calling → execute tool → second pass streaming。
- `services/providers/openAICompatibleToolUtils.ts`
  - `streamOpenAICompatibleChat()` 已支援先拿 tool call，再把 tool result 回送模型生成最終回答。

**結論**：HTML Project Canvas 不需要重做 agent/tool orchestration，只要在現有 `llmService` 上擴充一組新的 project tools。

### 2. 目前已經使用瀏覽器端資料庫

- `services/db.ts` 已用 `idb/openDB()` 管理 `assistants` 與 `sessions` store。
- `services/queryCacheService.ts` 也已展示另一套 IndexedDB 用法，用於查詢快取。

**結論**：這個專案已經接受「瀏覽器本地資料層」作為正式架構，因此 HTML Project 最自然的主方案也是 IndexedDB。

### 3. 畫面骨架已經支援多視圖與主內容區切換

- `components/core/AppContext.tsx`
  - `viewMode` 已是正式狀態切換機制。
  - reducer 已集中管理 `SET_VIEW_MODE`、assistant / session / sidebar 狀態。
- `components/core/AppShell.tsx`
  - 依照 `viewMode` 切換 `AssistantEditor`、`ChatContainer`、`settings` 等畫面。
- `components/core/Layout.tsx`
  - 已有成熟的 sidebar + main content 佈局，可擴充成 chat + preview workspace。
- `components/chat/ChatContainer.tsx`
  - 是目前聊天互動的主容器，最適合作為「觸發建立/更新 project」的入口。

**結論**：Canvas 功能不需要新開獨立路由，先以 `viewMode` 或 chat 內嵌 split-pane workspace 即可落地。

---

## 儲存方案比較

> 需求重點：純瀏覽器、無後端、要能被 LLM 工具讀寫、多檔案、可被 iframe 預覽。

### 方案 A：IndexedDB 儲存 project + Blob URL 預覽（推薦主方案）

**做法**

- 專案結構（project / files / metadata）存在 IndexedDB。
- 每次預覽時，前端把 entrypoint 與依賴檔案組裝成一份可執行 HTML，產生 `Blob`，再用 `URL.createObjectURL(blob)` 給 `iframe.src`。

**優點**

- 與現有 `services/db.ts` 的 `idb` 架構最一致，整合成本最低。
- 相容性佳，Chrome / Edge / Safari / Firefox 都比 OPFS 穩定。
- 容易 versioning、diff、autosave、restore。
- LLM tool 層只需處理 JSON 結構，不必操作真實檔案 handle。

**缺點**

- 若要支援真正多檔案相對路徑（`<script src="./main.js">`、`<link href="./style.css">`）需要一層「預覽組裝器」。
- Blob URL 是 preview artifact，不是天然檔案系統；多資源引用要額外 resolve。

**適合本專案的原因**

- EduCare 現在本來就是單頁 React 應用，沒有本機檔案系統抽象。
- 先做 MVP 時，單一 HTML 入口 + 內嵌 CSS/JS 就足以覆蓋大多數「產生 landing page / prototype」需求。

### 方案 B：OPFS / File System Access API 作為主儲存

**做法**

- 將 project 寫進 OPFS（Origin Private File System）或讓使用者授權 File System Access。

**優點**

- 更像真實檔案系統，較適合大型多檔案專案。
- 未來可擴展到下載、匯出、與 IDE-like 操作。

**缺點**

- 瀏覽器相容性與 API 差異較大，Safari 支援不如 IndexedDB 穩定。
- LLM 工具呼叫與 UI 狀態同步更複雜。
- `iframe` 仍不能直接吃 file handle，最後還是要轉成 blob URL 或虛擬路徑映射。

**結論**

- 適合作為第二階段大型 project 的「可選 mirror / export target」，**不適合作為第一版主資料層**。

### 方案 C：只用 `iframe.srcDoc`、不做正式 project store

**優點**

- 最快。

**缺點**

- 幾乎無法支援多檔案與增量修改。
- 每次模型改一點內容都要重吐整份 HTML，token 成本與錯誤率高。
- 幾乎沒有 versioning、history、diff、recover 能力。

**結論**

- 只適合 demo，不適合做正式 Canvas 功能。

### 最終建議

**主方案：`IndexedDB as source of truth` + `Blob URL as preview transport`。**

**可選擴充：** 第二階段加入 OPFS mirror / export，不把它當 canonical store。

---

## 建議資料模型

不要把 HTML project 直接塞進 `Assistant.ragChunks` 或大塊 JSON 欄位內；應該新增獨立資料模型與 store，避免每次改一個檔案就重寫整個 assistant record。

### TypeScript 型別草案

```ts
export interface HtmlProject {
  id: string;
  assistantId: string;
  sessionId?: string | null;
  name: string;
  description?: string;
  entryFile: string; // e.g. /index.html
  status: 'draft' | 'ready' | 'error';
  previewVersion: number;
  assetPaths: string[]; // binary/static assets tracked separately from text files
  createdAt: number;
  updatedAt: number;
  lastPrompt?: string;
  lastBuildError?: string | null;
  tags?: string[];
}

export interface HtmlProjectFile {
  projectId: string;
  path: string; // /index.html, /styles.css, /main.js
  kind: 'html' | 'css' | 'js' | 'json' | 'svg' | 'asset' | 'md';
  content: string; // MVP: text-first, binary assets phase 2
  encoding?: 'utf-8' | 'base64';
  dependencies?: string[]; // relative imports/assets referenced by this file
  size: number;
  updatedAt: number;
}

export interface HtmlProjectSnapshot {
  projectId: string;
  version: number;
  files: string[];
  createdAt: number;
  note?: string;
}
```

> 版本語意建議：`HtmlProject.previewVersion` 是目前對外提供給工具與 iframe 預覽的 canonical 版本號；`HtmlProjectSnapshot.version` 則是某次保存下來的歷史快照版本。`writeFiles` / `deleteFile` / `setEntrypoint` / `renderPreview` 都應回報 `previewVersion`，避免實作者混淆。

### 與既有模型的映射方式

- `Assistant`
  - 不直接承載整個 project 檔案內容。
  - 可新增 `projectIds?: string[]` 或在 store 端用 `assistantId` 反查。
- `ChatSession`
  - 建議新增 `activeProjectId?: string | null`，讓同一段對話能持續修改同一個 project。
- `ChatMessage`
  - 不需要塞完整檔案內容。
  - 可只記錄「工具摘要」：建立了哪些檔案、更新了哪些檔案、preview version 幾。
- `assets / dependencies`
  - `assetPaths` 放在 `HtmlProject` 供檔案樹與 export 使用。
  - `dependencies` 放在 `HtmlProjectFile`，用來描述 `<script src>`, `<link href>`, `import`, `url(...)` 等引用，供 preview 組裝器解析多檔案資源。

### IndexedDB store 建議

可擴充 `services/db.ts` 或新增專用 service，例如：

- `htmlProjects`
- `htmlProjectFiles`
- `htmlProjectSnapshots`（optional, phase 2）

**建議做法**：新增 `services/htmlProjectStore.ts`，不要把 `services/db.ts` 變成所有責任都往裡塞的 mega-file。

---

## Service / Module 邊界建議

### 1. `services/htmlProjectStore.ts`

負責 IndexedDB CRUD：

- `createProject()`
- `getProject()`
- `listProjectsByAssistant()`
- `listFiles(projectId)`
- `readFile(projectId, path)`
- `writeFile(projectId, path, content)`
- `writeFiles(projectId, files[])`
- `deleteFile(projectId, path)`
- `setEntrypoint(projectId, path)`
- `createSnapshot(projectId)`

### 2. `services/htmlPreviewService.ts`

負責把 project 轉成可供 iframe 載入的 preview URL：

- `buildPreviewArtifact(projectId)`
- `createPreviewUrl(projectId)`
- `revokePreviewUrl(projectId)`
- `resolveProjectForPreview(projectId)`

**MVP**：把 HTML/CSS/JS inline 後生成單一 Blob HTML。

**Phase 2**：支援多檔案路徑解析（例如虛擬 `/__canvas__/project/:id/...`）。

### 3. `services/htmlProjectToolService.ts`

把 store + preview service 封裝成 LLM 可呼叫的工具：

- `getToolDefinitions()`
- `executeToolCall(call)`
- `summarizeToolResult(result)`

### 4. `services/htmlProjectPrompting.ts`

放 system prompt 片段與 tool usage guidance：

- 什麼情況該建立 project
- 什麼情況該增量修改而不是整份重寫
- tool call 的最佳實踐

### 5. UI components

- `components/canvas/HtmlProjectWorkspace.tsx`
- `components/canvas/FileTree.tsx`
- `components/canvas/PreviewFrame.tsx`
- `components/canvas/ProjectTabs.tsx`
- `components/canvas/ToolActivityPanel.tsx`

---

## LLM 工具呼叫設計

### 什麼情境啟用 project tools

當使用者意圖屬於以下類型時，在 `services/llmService.ts` 注入 HTML project tools：

- 「做一個 landing page / 網頁 / dashboard / mini app / prototype」
- 「幫我改這個頁面的按鈕顏色 / 版面 / 表單」
- 「在剛剛那個 app 裡再加一個功能」

### 建議工具清單

#### `createProject`

建立新 project。

**input**

```json
{
  "name": "招生頁 prototype",
  "description": "給高中生招生用的一頁式網站",
  "template": "single-page-app"
}
```

**output**

```json
{
  "projectId": "proj_123",
  "entryFile": "/index.html",
  "created": true
}
```

#### `writeFiles`

一次寫多個檔案；比單檔工具更適合減少 tool round-trips。

**input**

```json
{
  "projectId": "proj_123",
  "files": [
    { "path": "/index.html", "content": "...", "kind": "html" },
    { "path": "/styles.css", "content": "...", "kind": "css" }
  ]
}
```

**output**

```json
{
  "updated": ["/index.html", "/styles.css"],
  "previewVersion": 2
}
```

#### `listFiles`

列出目前專案檔案，供模型做增量修改前先觀察。

**input**

```json
{
  "projectId": "proj_123"
}
```

**output**

```json
{
  "files": [
    { "path": "/index.html", "kind": "html", "updatedAt": 1710000000000 },
    { "path": "/styles.css", "kind": "css", "updatedAt": 1710000002000 }
  ],
  "entryFile": "/index.html"
}
```

#### `readFile`

讀單一檔案內容。

**input**

```json
{
  "projectId": "proj_123",
  "path": "/index.html"
}
```

**output**

```json
{
  "path": "/index.html",
  "kind": "html",
  "content": "<!doctype html>...",
  "dependencies": ["/styles.css", "/main.js"]
}
```

#### `deleteFile`

刪除檔案。

**input**

```json
{
  "projectId": "proj_123",
  "path": "/legacy-section.js"
}
```

**output**

```json
{
  "deleted": true,
  "path": "/legacy-section.js",
  "previewVersion": 5
}
```

#### `setEntrypoint`

設定 iframe 要預覽的入口檔。

**input**

```json
{
  "projectId": "proj_123",
  "path": "/index.html"
}
```

**output**

```json
{
  "projectId": "proj_123",
  "entryFile": "/index.html",
  "previewVersion": 5
}
```

#### `renderPreview`

要求前端重建 preview artifact 並回傳最新 preview metadata。

**input**

```json
{
  "projectId": "proj_123",
  "forceRebuild": true,
  "expectedPreviewVersion": 4
}
```

**output**

```json
{
  "projectId": "proj_123",
  "previewVersion": 4,
  "entryFile": "/index.html",
  "previewReady": true,
  "previewUrlType": "blob"
}
```

### 建議進階工具（第二階段）

#### `applyFilePatch`

避免模型每次重寫整份檔案。

> 目前實作可先落在較簡化的 `modifyLinesInFile`：由 `readFile` 回傳帶行號的 `numberedContent`，再用 1-based line range 做 replace / insert / delete。底層仍可維持 service-layer read → transform → full write，不必先改動 store 的資料模型。

**input**

```json
{
  "projectId": "proj_123",
  "path": "/index.html",
  "patch": {
    "strategy": "replace-range",
    "startMarker": "<section id=\"hero\">",
    "endMarker": "</section>",
    "content": "...new html..."
  }
}
```

**output**

```json
{
  "path": "/index.html",
  "patched": true,
  "previewVersion": 6,
  "conflict": false
}
```

若 patch marker 找不到或檔案已被其他變更改寫，`conflict` 應回傳 `true`，並附帶錯誤摘要，讓模型退回 `readFile` / `writeFiles` 重試。

#### `getProjectSummary`

回傳目前 file tree、entrypoint、最近版本、摘要，避免每次都把所有檔案內容塞回模型上下文。

**input**

```json
{
  "projectId": "proj_123"
}
```

**output**

```json
{
  "projectId": "proj_123",
  "entryFile": "/index.html",
  "previewVersion": 6,
  "files": ["/index.html", "/styles.css", "/main.js"],
  "summary": "單頁招生 landing page，含 hero、CTA、features 三區塊"
}
```

---

## 與現有 `llmService` 的接法

目前 `services/llmService.ts` 已經能這樣做：

1. 判斷要不要注入 tools
2. 把 tool definition 傳給 provider
3. 在前端 `executeTool()` 執行工具
4. 再把 tool result 回送模型
5. 將最終回答串流回 UI

### 建議擴充方式

在 `streamChat()` 內新增第二類工具注入條件：

- `knowledge search tools`
- `html project tools`

可演進成：

```ts
const tools = [...knowledgeToolsIfNeeded, ...htmlProjectToolsIfNeeded];
```

### Tool routing 原則

- 如果使用者在「一般問答」：只用知識工具。
- 如果使用者在「產生介面 / 修改介面」：開啟 project tools。
- 如果同時需要知識與 project（例如「用學校簡章做一個招生頁」）：兩者都開。

### 首次生成流程

1. 使用者說：「幫我做一個大學招生 landing page」
2. 模型呼叫 `createProject`
3. 模型呼叫 `writeFiles`
4. 模型呼叫 `setEntrypoint`
5. 模型呼叫 `renderPreview`
6. 前端顯示 iframe 預覽
7. 模型最後在聊天中回覆：「我已經建立初版頁面，你可以在右側預覽」

### 增量修改流程

1. 使用者說：「把 hero section 改成深色、加 CTA」
2. 模型先 `listFiles` / `readFile`
3. 模型呼叫 `applyFilePatch` 或 `writeFiles`
4. 前端重建 preview
5. 模型回覆變更摘要，而不是再貼整份 HTML

### 錯誤回復流程

若 `renderPreview` 或組裝器失敗：

- tool result 回傳錯誤訊息與失敗檔案
- 模型收到後可改呼叫 `readFile` / `writeFiles` 修復
- UI 顯示 preview error panel，而不是白屏 iframe

---

## 為何不能讓模型每次直接輸出整份 HTML

直接在聊天中輸出超長 HTML 有四個問題：

1. **token 浪費**：一個小修改也要整份重送。
2. **難以維護**：模型容易不小心覆寫其他區塊。
3. **聊天可讀性差**：對使用者來說，聊天視窗變成 code dump。
4. **無法形成專案狀態**：沒有 file tree、version、entrypoint、history。

### 建議策略

- **MVP**：使用 `writeFiles` 一次產生 1–3 個核心檔案（`index.html`, `styles.css`, `main.js`）。
- **後續修改**：優先 `applyFilePatch` 或重寫單一檔案，不重寫整個 project。
- **聊天回覆只說摘要**：例如「已新增 pricing 區塊、調整 CTA 顏色並重新預覽」。

---

## 預覽架構設計

### MVP 預覽方案：Blob HTML

### 做法

`htmlPreviewService` 讀取 project 檔案後：

- 以 `entryFile` 為主
- 將相依的 CSS/JS 內嵌或重寫成 inline block
- 產生單一 HTML 字串
- `new Blob([html], { type: 'text/html' })`
- `iframe.src = URL.createObjectURL(blob)`

### 優點

- 最快可交付。
- 不需要 service worker。
- 安全邊界清楚，sandbox 容易加。

### 限制

- 複雜多檔案路徑支援有限。
- 不適合 npm 套件或大型 framework 專案。

## 第二階段：Virtual Project Origin

當需要較完整多檔案能力時，可加入：

- `iframe src="/canvas-preview/:projectId/:version/index.html"`
- 用 service worker 或 app 內虛擬路由層，把這些請求導到 IndexedDB 檔案內容

### 優點

- 可以保留多檔案相對路徑。
- `index.html` / `styles.css` / `main.js` 的專案結構更自然。

### 缺點

- 架構比 Blob URL 複雜。
- service worker 與 cache invalidation 需更嚴格設計。

### 最佳實務

- **MVP 先 Blob URL。**
- **Phase 2 再引入 virtual origin。**

---

## iframe 安全邊界

這一塊一定要刻意限制，不要讓「模型產生的 HTML」拿到主站權限。

### 建議 sandbox

```html
<iframe sandbox="allow-scripts allow-forms allow-modals" />
```

### 不建議預設開啟

- `allow-same-origin`
  - 一旦開啟，某些隔離假設會被削弱；除非 preview runtime 明確需要，不建議 MVP 開。
- `allow-top-navigation`
  - 避免 preview 跳離主應用。
- `allow-popups`
  - 預設關閉，除非使用者手動開啟 preview capability。

### 網路能力策略

MVP 建議：

- 允許基本外部圖片 / 字型請求，但在 UI 上標記「此預覽包含外部資源」。
- 禁止或警告第三方 `<script src="https://...">`，因為這會把 preview 變成任意遠端腳本執行容器。
- 若偵測 `<script>` 外鏈，UI 顯示 warning 並要求使用者手動確認。

### 其他安全措施

- 預覽與主 app 不共享 React state。
- `postMessage` 僅允許明確白名單事件。
- 預覽錯誤事件（JS runtime error）只回報摘要，不直接把主應用 API 暴露給 iframe。

---

## UI 整合方案

### 推薦 MVP 介面：Chat + Preview split pane

沿用 `components/core/Layout.tsx` 主內容區，當前 assistant / session 進入 canvas 模式時，在 `ChatContainer` 旁顯示 workspace。

### 版面

- 左側：聊天（維持現有 `ChatContainer`）
- 右側：`HtmlProjectWorkspace`
  - Preview tab
  - Files tab
  - Activity / Tool log tab
  - Preview toolbar（Refresh、Auto-refresh toggle、Open in new tab）

### 互動

- 使用者第一次要求「做一個網頁」後，自動切到 split view。
- 若已有 `activeProjectId`，之後的修改都指向同一個 project。
- `renderPreview` 成功後預設 auto-refresh 目前 iframe；若自動更新被關閉，可由使用者手動按 Refresh。
- 使用者可以手動切換：
  - 預覽
  - 檔案列表
  - 原始碼檢視（唯讀 MVP，可編輯 phase 2）

### 為什麼不是先做全新獨立 route？

- 目前 `AppShell` 與 `AppContext` 已經以 `viewMode` 控制內容。
- 先在既有聊天流程中嵌入工作區，能保留「對話驅動創作」的體驗。
- 等功能成熟後，再抽成完整 `canvas_workspace` viewMode 也不晚。

---

## 具體檔案/模組改動建議

### Phase 1（MVP）

#### 新增

- `types.ts`
  - `HtmlProject`, `HtmlProjectFile`, `ProjectToolResult` 等型別
- `services/htmlProjectStore.ts`
- `services/htmlPreviewService.ts`
- `services/htmlProjectToolService.ts`
- `components/canvas/HtmlProjectWorkspace.tsx`
- `components/canvas/PreviewFrame.tsx`
- `components/canvas/PreviewToolbar.tsx`
- `components/canvas/FileTree.tsx`

#### 修改

- `services/llmAdapter.ts`
  - 如有需要，擴充 tool result metadata 型別
- `services/llmService.ts`
  - 注入 html project tools
  - 根據 user intent / active project 開啟對應工具
- `components/chat/ChatContainer.tsx`
  - 接收 project activity / preview 狀態
  - 在送訊息時可攜帶 active project context
- `components/core/AppContext.tsx`
  - 新增 `activeProjectId`、workspace UI state
- `components/core/AppShell.tsx`
  - 在 chat 畫面嵌入 `HtmlProjectWorkspace`
- `services/db.ts`
  - 可選：只擴 schema；更推薦抽新 store service

### Phase 2（增強）

- `applyFilePatch`
- project snapshots / undo history
- virtual origin preview
- file editor
- external asset import

### Phase 3（可選）

- OPFS mirror / export zip
- multi-project per assistant dashboard
- 分享 preview（仍可保持純前端匯出）

---

## 驗證策略

### 單元測試

### `services/htmlProjectStore.test.ts`

驗證：

- create / read / update / delete project
- multi-file writes
- entrypoint 切換
- version 遞增

### `services/htmlPreviewService.test.ts`

驗證：

- 單檔 HTML 可轉為 blob preview
- CSS/JS inline 組裝正確
- 缺檔時回傳 preview error

### `services/htmlProjectToolService.test.ts`

驗證：

- `createProject` / `writeFiles` / `renderPreview` tool contract
- error payload shape 穩定
- tool result 摘要適合回送 LLM

## 元件/整合測試

### `components/canvas/HtmlProjectWorkspace.test.tsx`

驗證：

- 建立 project 後顯示 preview
- 檔案樹切換正常
- preview error state 有 fallback UI

### `components/chat/ChatContainer.test.tsx`

驗證：

- 當模型選擇 html tools 時，不再把整份 HTML 當最終聊天文字輸出
- 成功建立 project 後顯示「已建立預覽」摘要訊息

### `components/core/AppShell.test.tsx` / `Layout.test.tsx`

驗證：

- split-pane workspace 與既有 sidebar layout 共存
- mobile/tablet 下可退化為 tabbed view，而不是硬塞雙欄

## 手動驗證情境

1. **首次生成**
   - 輸入：「幫我做一個招生 landing page」
   - 預期：project 建立、檔案寫入、右側 iframe 出現。

2. **增量修改**
   - 輸入：「把 CTA 按鈕改成橘色」
   - 預期：只更新相關檔案，preview 即時刷新。

3. **錯誤修復**
   - 輸入會造成壞 HTML/JS 的修改
   - 預期：preview error panel 顯示錯誤；模型可再透過 read/write tool 修正。

4. **跨輪持續編輯**
   - 關閉再打開同一 assistant / session
   - 預期：active project 仍可從 IndexedDB 恢復。

## 必須觀察的 failure modes

- blob URL 未釋放造成記憶體累積
- 多檔案更新後 preview 還指向舊 version
- 模型不小心刪掉 entrypoint
- 外部 script 導致 preview 安全風險
- project 檔案太大時 assistant record 跟著膨脹（因此不應內嵌於 `Assistant`）

---

## 分階段落地計畫

### Phase 1：MVP（建議先做）

**目標**：支援 80% 的單頁 HTML/CSS/JS prototype 需求。

- IndexedDB project store
- `createProject` / `writeFiles` / `listFiles` / `readFile` / `setEntrypoint` / `renderPreview`
- Blob URL preview
- Chat + Preview split pane
- assistant/session 綁定 active project

**成功標準**

- 使用者能用自然語言讓模型建立一個單頁 web prototype
- 能再次要求修改，並在相同 project 上增量更新

## Phase 2：編輯與多檔案增強

- `applyFilePatch`
- file tree 與 file viewer
- snapshot / undo
- preview error diagnostics
- 更好的多檔案組裝與資源解析

## Phase 3：進階 preview runtime

- virtual project origin
- richer sandbox / permission toggles
- OPFS export/import
- optional code editing surface

---

## 最終推薦

如果要在 **不需要後端** 的前提下，為 EduCare 做一個類似 Gemini Canvas 的功能，最務實的路線是：

1. **以 IndexedDB 作為 canonical project store**（與現有 `services/db.ts` 架構一致）。
2. **以 Blob URL + sandboxed iframe 作為 MVP 預覽載具**。
3. **透過現有 `services/llmService.ts` / provider tool-calling 流程接入一組 HTML Project tools**。
4. **在 `AppShell` 內以 chat + preview workspace 形式整合，而不是一開始就重做整套路由。**
5. **第二階段再處理 multi-file virtual origin、patch、snapshot、OPFS export。**

這樣的設計能最小化對既有程式架構的破壞，同時保留未來把它演進成真正 browser IDE / Canvas 的空間。
