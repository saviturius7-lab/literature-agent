import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

function collectApiKeys(env: Record<string, string>, patterns: string[]): string[] {
  const keys: string[] = [];
  for (const envKey of Object.keys(env)) {
    if (patterns.some(p => envKey === p || envKey.startsWith(p + '_'))) {
      const val = env[envKey];
      if (!val || val.length <= 10 || val.includes('TODO')) continue;
      if (val.includes(',')) {
        keys.push(...val.split(',').map(k => k.trim()).filter(k => k.length > 10));
      } else {
        keys.push(val.trim());
      }
    }
  }
  return Array.from(new Set(keys));
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');

  const geminiKeys = collectApiKeys(env, [
    'GEMINI_API_KEY',
    'VITE_GEMINI_API_KEY',
    'GEMINI_KEYS',
    'VITE_GEMINI_KEYS',
  ]);

  const deepseekKeys = collectApiKeys(env, [
    'DEEPSEEK_API_KEY',
    'VITE_DEEPSEEK_API_KEY',
    'DEEPSEEK_KEYS',
    'VITE_DEEPSEEK_KEYS',
  ]);

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_GEMINI_KEYS': JSON.stringify(geminiKeys),
      'import.meta.env.VITE_DEEPSEEK_KEYS': JSON.stringify(deepseekKeys),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: ['b4be4a8a-90e8-4b9b-894f-6e3674cad798-00-159x0zbc6cas5.riker.replit.dev'],
    },
  };
});
