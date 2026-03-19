import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_GEMINI_KEYS': JSON.stringify(
        Object.keys(env)
          .filter(key => 
            key === 'GEMINI_API_KEY' || 
            key === 'VITE_GEMINI_API_KEY' ||
            key.startsWith('GEMINI_API_KEY_') ||
            key.startsWith('VITE_GEMINI_API_KEY_') ||
            key === 'VITE_GEMINI_KEYS' ||
            key === 'GEMINI_KEYS'
          )
          .map(key => env[key])
          .filter(val => val && typeof val === 'string' && val.length > 10 && !val.includes("TODO"))
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
