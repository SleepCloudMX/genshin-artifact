import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 构建产物直接落到仓库根目录：./index.html + ./assets/
  // 这样根目录的入口由构建产出，不需要手写、也不会与源码漂移。
  // base 用相对路径，便于直接 file:// 打开或放到任意子路径托管。
  base: './',
  build: {
    outDir: '..',
    emptyOutDir: false,
    assetsDir: 'assets',
  },
  test: {
    include: ['tests/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
