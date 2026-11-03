// Jira PoC SPA 빌드/개발 설정 (엔트리: jira.html → dist-jira-app)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { input: 'jira.html' },
    outDir: 'dist-jira-app',
  },
  server: {
    port: 5174,
    open: '/jira.html',
    proxy: { '/api': 'http://localhost:3002' },
  },
});
