// Jira PoC 편집기 번들 (IIFE, window.JiraEditor). 메인 SPA 빌드와 분리.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/jira-editor.js',
      name: 'JiraEditorBundle',
      formats: ['iife'],
      fileName: () => 'jira-editor.js',
    },
    outDir: 'dist-jira',
  },
});
