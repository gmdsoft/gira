// Jira PoC SPA 빌드/개발 설정 (엔트리: jira.html → dist-jira-app)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// 빌드 정보 (개발참여 이슈의 '환경 정보'에 남는다): git 짧은 해시 + 빌드 시각
let rev = 'unknown';
try { rev = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* git 없음 */ }
const BUILD = `${rev} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;

export default defineConfig({
  plugins: [react()],
  define: { __APP_BUILD__: JSON.stringify(BUILD) },
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
