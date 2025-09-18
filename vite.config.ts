import { defineConfig } from 'vite'

export default defineConfig({
  root: './',
  base: './', // 重要：使用相对路径，适配 GitHub Pages
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: './index.html'
    }
  }
})