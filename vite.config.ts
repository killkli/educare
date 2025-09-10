/// <reference types="vitest" />
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

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
        target: 'es2020',
        minify: 'esbuild',
        cssMinify: true,
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
          external: ['fsevents'],
          plugins: [
            visualizer({
              filename: 'dist/stats.html',
              open: false,
              gzipSize: true
            })
          ],
          output: {
            // 更細緻的 chunk 分割
            manualChunks: (id) => {
              // React 核心
              if (id.includes('react') || id.includes('react-dom')) {
                return 'react-vendor';
              }
              
              // AI 相關 - 分別處理大型庫
              if (id.includes('@huggingface/transformers')) {
                return 'transformers';
              }
              if (id.includes('@google/genai') || id.includes('@themaximalist/llm.js')) {
                return 'ai-libs';
              }
              
              // 文件處理 - 按需分割
              if (id.includes('pdfjs-dist')) {
                return 'pdf-worker';
              }
              // Keep mammoth with vendor bundle to avoid TDZ issues
              // if (id.includes('mammoth') || id.includes('jszip')) {
              //   return 'file-processing';
              // }
              
              // 數據庫
              if (id.includes('@libsql/client')) {
                return 'turso';
              }
              
              // Markdown 相關
              if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-')) {
                return 'markdown';
              }
              
              // 代碼高亮
              if (id.includes('highlight.js')) {
                return 'highlight';
              }
              
              // 其他工具
              if (id.includes('qrcode') || id.includes('idb')) {
                return 'utils';
              }
              
              // node_modules 中的其他第三方庫
              if (id.includes('node_modules')) {
                return 'vendor';
              }
            },
            
            // 優化輸出格式
            format: 'es',
            entryFileNames: 'assets/[name]-[hash].js',
            chunkFileNames: 'assets/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash].[ext]',
            
            // 壓縮選項
            compact: true
          }
        }
      },
      optimizeDeps: {
        exclude: ['fsevents'],
        include: [
          'react',
          'react-dom',
          '@google/genai',
          'qrcode',
          'highlight.js',
          'idb',
          'mammoth'
        ]
      },
      
      // 啟用 tree-shaking
      esbuild: {
        legalComments: 'none',
        treeShaking: true,
        target: 'es2020',
        // drop: ['console', 'debugger'],
        minifyIdentifiers: true,
        minifySyntax: true,
        minifyWhitespace: true
      },
      
      // 性能優化
      server: {
        hmr: {
          overlay: false
        }
      },
      
      // CSS 優化
      css: {
        devSourcemap: false,
        postcss: {
          plugins: []
        }
      }
    };
});
