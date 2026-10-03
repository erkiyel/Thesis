import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, import.meta.dirname, ['VITE_']);
  const backendEnv = loadEnv(mode, path.resolve(import.meta.dirname, '../Backend'), ['NEXT_PUBLIC_']);
  const publicSupabaseUrl = frontendEnv.VITE_SUPABASE_URL || backendEnv.NEXT_PUBLIC_SUPABASE_URL;
  const publicSupabaseKey = frontendEnv.VITE_SUPABASE_PUBLISHABLE_KEY || backendEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  return {
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(publicSupabaseUrl),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(publicSupabaseKey),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  };
});
