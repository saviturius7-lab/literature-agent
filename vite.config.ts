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
          .reduce((acc, key) => {
            const val = env[key];
            if (val && typeof val === 'string' && val.length > 10) {
              const upper = val.toUpperCase();
              const isPlaceholder = 
                upper.includes("TODO") || 
                upper.includes("YOUR_API_KEY") || 
                upper.includes("MY_GEMINI_KEY") || 
                upper.includes("GEMINI_API_KEY") || 
                upper.includes("INSERT_KEY") || 
                upper.includes("REPLACE_WITH") ||
                upper.includes("EXAMPLE_KEY");
              
              if (!isPlaceholder) {
                // Handle comma-separated strings
                if (val.includes(',')) {
                  acc.push(...val.split(',').map(k => k.trim()).filter(k => k.length > 10));
                } else {
                  acc.push(val.trim());
                }
              }
            }
            return acc;
          }, [] as string[])
      ),
      'import.meta.env.VITE_DEEPSEEK_KEYS': JSON.stringify(
        Object.keys(env)
          .filter(key => 
            key === 'DEEPSEEK_API_KEY' || 
            key === 'VITE_DEEPSEEK_API_KEY' ||
            key.startsWith('DEEPSEEK_API_KEY_') ||
            key.startsWith('VITE_DEEPSEEK_API_KEY_') ||
            key === 'VITE_DEEPSEEK_KEYS' ||
            key === 'DEEPSEEK_KEYS'
          )
          .reduce((acc, key) => {
            const val = env[key];
            if (val && typeof val === 'string' && val.length > 10) {
              const upper = val.toUpperCase();
              const isPlaceholder = 
                upper.includes("TODO") || 
                upper.includes("YOUR_API_KEY") || 
                upper.includes("DEEPSEEK_API_KEY") || 
                upper.includes("INSERT_KEY") || 
                upper.includes("REPLACE_WITH") ||
                upper.includes("EXAMPLE_KEY");

              if (!isPlaceholder) {
                // Handle comma-separated strings
                if (val.includes(',')) {
                  acc.push(...val.split(',').map(k => k.trim()).filter(k => k.length > 10));
                } else {
                  acc.push(val.trim());
                }
              }
            }
            return acc;
          }, [] as string[])
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR can be disabled via the DISABLE_HMR environment variable.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
