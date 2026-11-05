// 관리 서비스 SPA 빌드/개발 설정 (엔트리: admin.html → dist-admin)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { input: 'admin.html' },
    outDir: 'dist-admin',
  },
  server: {
    port: 5175,
    open: '/admin.html',
    proxy: { '/api': 'http://localhost:3003' },
  },
});
