import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 1500,
  },
  server: {
    proxy: {
      // 开发模式：WebSocket 与 API 转发到本地 PvP 服务器（npm run server）
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
