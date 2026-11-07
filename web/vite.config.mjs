import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// 화이트보드 편집기(Excalidraw) 글꼴을 외부 CDN 대신 우리 서버에서 제공 (dist/excalidraw-assets/fonts)
const excalidrawFonts = () => ({
  name: 'excalidraw-fonts',
  apply: 'build',
  writeBundle(options) {
    const src = path.join(path.dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'fonts');
    if (existsSync(src)) cpSync(src, path.join(options.dir, 'excalidraw-assets', 'fonts'), { recursive: true });
  },
});

// 빌드 정보 (개발참여 이슈의 '환경 정보'에 남는다): git 짧은 해시 + 빌드 시각
let rev = 'unknown';
try { rev = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* git 없음 */ }
const BUILD = `${rev} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;

export default defineConfig({
  plugins: [react(), excalidrawFonts()],
  define: { __APP_BUILD__: JSON.stringify(BUILD) },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/wiki': 'http://localhost:3001',
    },
  },
});
