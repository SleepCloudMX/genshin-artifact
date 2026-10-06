/**
 * 构建插件：把 JS / CSS 内联进产出的 index.html，使其**双击即可打开**。
 *
 * 背景：直接用 `file://` 打开 HTML 时，浏览器会按 CORS 规则拦截
 * `<script type="module" src="...">`，页面会变成空白。
 *
 * 做法（不引入额外依赖，见 `02-refactor.md` 关于「不要为一个需求加依赖」）：
 *   1. Vite 先正常产出 `index.html` + `./assets/*.js|css`（服务器托管时仍可用）；
 *   2. 本插件在 `closeBundle` 阶段读取这两个文件，插进 HTML 的
 *      `<script type="module">` 与 `<style>`，同时**保留**原有的外部引用作为兜底；
 *   3. 内联内容里的 `</script>` 会被转义，避免提前闭合标签。
 *
 * 于是：
 *   - `file://` 双击打开 → 走内联代码，正常渲染；
 *   - 静态服务器 / GitHub Pages → 内联先执行，外部引用是冗余兜底。
 *
 * 注意：内联用的是 `type="module"`。`file://` 下内联 module 是允许的，
 * 因为不再有跨源请求。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 返回一个 Vite 插件对象。
 *
 * 这里不 `import type { Plugin } from 'vite'`：Vitest 会带入另一份 Vite 主版本，
 * 两个 `Plugin` 类型在 `exactOptionalPropertyTypes` 下不兼容（TS2322 连环报错）。
 * 插件形状很简单，用结构化类型即可。
 */
export function inlineBundle() {
  let outDir = 'dist';
  let htmlFiles: string[] = [];
  let jsFile: string | undefined;
  let cssFile: string | undefined;

  return {
    name: 'artifact-growth:inline-bundle',
    apply: 'build' as const,

    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir;
    },

    generateBundle(
      _options: unknown,
      bundle: Record<string, { type: string; isEntry?: boolean; fileName: string }>,
    ) {
      for (const fileName of Object.keys(bundle)) {
        const item = bundle[fileName]!;
        if (item.type === 'chunk' && item.isEntry) jsFile = fileName;
        else if (item.type === 'asset' && fileName.endsWith('.css')) cssFile = fileName;
        else if (item.type === 'asset' && fileName.endsWith('.html')) htmlFiles.push(fileName);
      }
    },

    closeBundle() {
      const htmlRel = htmlFiles[0] ?? 'index.html';
      const htmlPath = join(outDir, htmlRel);
      let html = readFileSync(htmlPath, 'utf8');

      if (cssFile) {
        const css = readFileSync(join(outDir, cssFile), 'utf8');
        html = html.replace('</head>', `<style>\n${css}\n</style>\n</head>`);
      }
      if (jsFile) {
        const js = readFileSync(join(outDir, jsFile), 'utf8')
          // 防止内联内容里出现 </script> 提前闭合
          .replaceAll('</script>', '<\\/script>');
        html = html.replace('</body>', `<script type="module">\n${js}\n</script>\n</body>`);
      }

      writeFileSync(htmlPath, html, 'utf8');
      const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
      console.log(`\n  自包含产物：${htmlRel}（${kb} kB，已内联 JS/CSS，可双击打开）`);
    },
  };
}
