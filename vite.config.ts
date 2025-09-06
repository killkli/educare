import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.TURSO_URL': JSON.stringify(env.TURSO_URL),
        'process.env.TURSOAPI_KEY': JSON.stringify(env.TURSOAPI_KEY)
      },
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
