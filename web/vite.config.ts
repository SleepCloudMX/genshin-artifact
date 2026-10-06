import { defineConfig } from 'vitest/config';

import { inlineBundle } from './tools/inline-bundle';

export default defineConfig({
  // 构建产物只有仓库根的 ./index.html（自包含单文件）。
  // JS/CSS 由 inlineBundle 在 generateBundle 阶段取走、不落盘，所以**没有 assetsDir**：
  // 以前会产出 ./assets/*.js|css，但产物是自包含的、没人引用它们，
  // 每构建一次就多两个哈希文件名的死文件。
  base: './',
  plugins: [inlineBundle()],
  build: {
    // outDir 是仓库根，绝不能清空
    outDir: '..',
    emptyOutDir: false,
  },
  test: {
    include: ['tests/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
