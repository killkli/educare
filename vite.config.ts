import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
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
        rollupOptions: {
          external: ['fsevents'],
          output: {
            manualChunks: {
              'turso': ['@libsql/client']
            }
          }
        }
      },
      optimizeDeps: {
        exclude: ['fsevents']
      }
    };
});
