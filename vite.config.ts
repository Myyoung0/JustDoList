import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Electron file:// load compatibility
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true
  }
});
