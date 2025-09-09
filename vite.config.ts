/// <reference types="vitest" />
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      test: {
        globals: true,
        deps: {
          optimizer: {
            web: {
              include: ['vitest-canvas-mock'],
            },
          },
        },
        environment: 'happy-dom',
        setupFiles: ['./src/vitest.setup.ts'],
        poolOptions: {
          threads: {
            singleThread: true,
          },
        },
      },
      define: {
        // 移除 Gemini API KEY - 現在由用戶在運行時提供
        'process.env.API_KEY': JSON.stringify(''),
        'process.env.GEMINI_API_KEY': JSON.stringify(''),
        
        // 內建共用的 Turso 配置
        'process.env.TURSO_URL': JSON.stringify(env.TURSO_URL || ''),
        'process.env.TURSO_READ_API_KEY': JSON.stringify(env.TURSO_READ_API_KEY || ''),
        
        // 移除寫入權限的 API KEY - 現在由用戶提供
        'process.env.TURSOAPI_KEY': JSON.stringify('')
      },
      base: '/chatbot-test/',
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
          external: ['fsevents'],
          output: {
            manualChunks: {
              // 數據庫相關
              'turso': ['@libsql/client'],
              
              // AI 相關庫
              'ai-libs': ['@google/genai', '@themaximalist/llm.js'],
              
              // 文件處理庫
              'file-processing': ['mammoth', 'pdfjs-dist'],
              
              // HuggingFace transformers (最大的依賴)
              'transformers': ['@huggingface/transformers'],
              
              // React 生態
              'react-vendor': ['react', 'react-dom'],
              
              // 其他工具庫
              'utils': ['qrcode', 'highlight.js', 'idb', 'react-markdown', 'rehype-highlight', 'remark-gfm']
            }
          }
        }
      },
      optimizeDeps: {
        exclude: ['fsevents']
      }
    };
});
