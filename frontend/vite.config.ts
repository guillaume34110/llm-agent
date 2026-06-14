import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(async () => {
  let tailwindPlugin = null;
  try {
    // dynamic import to support ESM-only plugin builds
    const mod = await import('@tailwindcss/vite');
    tailwindPlugin = (mod && (mod as any).default) ? (mod as any).default : mod;
  } catch (e) {
    // ignore — allow dev to run without the plugin if import fails
    tailwindPlugin = null;
  }

  return {
    plugins: [ ...(tailwindPlugin ? [tailwindPlugin()] : []), react() ],
    server: { port: 3470, proxy: { '/api': 'http://localhost:3469' } }
  };
});
