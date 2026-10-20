import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Private GitHub Codespaces only: Vite is the single exposed port and injects
// the private backend key server-side. Never expose key via VITE_* or browser.
const privatePreview = process.env.NOTIQ_CODESPACE_PREVIEW === '1';
if (privatePreview && (!process.env.NOTIQ_API_KEY || !process.env.NOTIQ_ALLOWED_ORIGIN)) {
  throw new Error('Codespaces preview requires backend key and exact origin.');
}

export default defineConfig({
  plugins: [react()],
  base: './',
  server: privatePreview ? {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        configure: proxy => {
          proxy.on('proxyReq', request => {
            request.setHeader('x-notiq-key', process.env.NOTIQ_API_KEY!);
            request.setHeader('origin', process.env.NOTIQ_ALLOWED_ORIGIN!);
          });
        },
      },
    },
  } : undefined,
});
