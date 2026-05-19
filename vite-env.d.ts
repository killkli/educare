/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TURSO_URL?: string;
  readonly VITE_TURSO_READ_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
