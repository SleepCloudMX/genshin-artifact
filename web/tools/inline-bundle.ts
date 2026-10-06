/**
 * 构建插件：把 JS / CSS 内联进产出的 index.html，使其**双击即可打开**。
 *
 * 背景：直接用 `file://` 打开 HTML 时，浏览器会按 CORS 规则拦截
 * `<script type="module" src="...">`，页面会变成空白。
 *
 * 做法（不引入额外依赖，见 `02-refactor.md` 关于「不要为一个需求加依赖」）：
 *   1. Vite 正常打包，产出 `index.html` + `assets/*.js|css`；
 *   2. 本插件在 `generateBundle` 阶段**直接取走** chunk 的 `code` 与 css asset 的
 *      `source`，并把这些条目从 bundle 里删掉 —— **于是 JS/CSS 根本不落盘**；
 *   3. `closeBundle` 阶段改写 `index.html`：插进 `<script type="module">` 与 `<style>`；
 *   4. **删掉外部的 `<script src>` / `<link rel=stylesheet>` 引用**——
 *      留着的话，服务器托管时内联脚本与外部脚本都会执行，界面会被挂载两次；
 *   5. 内联内容里的 `</script` 必须转义成 `<\/script`，否则 HTML 解析器
 *      会在字符串字面量中间提前闭合脚本标签，整段 JS 变成语法错误（白屏）。
 *   6. **绝不能用字符串形式的替换值**（`html.replace(x, js)`）：
 *      `String.prototype.replace` 会把替换值里的 `$&`、`` $` ``、`$'` 当成特殊模式。
 *      压缩后的 JS 里正好有 `$(...)` 这种变量名，`$&` 一旦出现就会把
 *      **匹配到的原文**（这里是 `</body>`）插进代码里，直接制造语法错误。
 *      必须传函数形式的替换器。
 *
 * 为什么不让 JS/CSS 落盘（曾经的写法是写完再读回来）：
 * 产物是**自包含单文件**，`index.html` 里没有任何外部引用，所以 `assets/` 是
 * **没人引用的构建垃圾** —— 每构建一次多两个哈希文件名的新文件，旧的从不清，
 * 既不是交付物也不可复现（一次性产物）。取内容的位置本来就在手里，没必要绕磁盘。
 *
 * 于是：
 *   - `file://` 双击打开 → 走内联代码，正常渲染；
 *   - 静态服务器 / GitHub Pages → 同一份内联代码，行为完全一致。
 *
 * 注意：内联用的是 `type="module"`。`file://` 下内联 module 是允许的，
 * 因为不再有跨源请求。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** `</script` 会让 HTML 解析器提前闭合当前脚本标签，必须转义（等价写法，语义不变） */
function escapeScriptText(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

/**
 * 用函数替换器做替换，彻底绕开 `$&` 等替换模式。
 * 返回替换后的文本；找不到锚点时返回 `undefined`，由调用方决定是否报错。
 */
export function replaceOnce(text: string, anchor: string, value: string): string | undefined {
  const at = text.indexOf(anchor);
  if (at < 0) return undefined;
  return text.slice(0, at) + value + text.slice(at + anchor.length);
}

/**
 * 返回一个 Vite 插件对象。
 *
 * 这里不 `import type { Plugin } from 'vite'`：Vitest 会带入另一份 Vite 主版本，
 * 两个 `Plugin` 类型在 `exactOptionalPropertyTypes` 下不兼容（TS2322 连环报错）。
 * 插件形状很简单，用结构化类型即可。
 */
export function inlineBundle() {
  let outDir = 'dist';
  let htmlFile = 'index.html';
  /** 打包好的 JS / CSS 内容。在 `generateBundle` 里取走，不让它们落盘 */
  let js: string | undefined;
  let css: string | undefined;

  return {
    name: 'artifact-growth:inline-bundle',
    apply: 'build' as const,

    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir;
    },

    generateBundle(
      _options: unknown,
      bundle: Record<string, { type: string; isEntry?: boolean; fileName: string; code?: string; source?: string | Uint8Array }>,
    ) {
      const drop: string[] = [];
      for (const fileName of Object.keys(bundle)) {
        const item = bundle[fileName]!;
        if (item.type === 'chunk' && item.isEntry) {
          js = item.code;
          drop.push(fileName);
        } else if (item.type === 'asset' && fileName.endsWith('.css')) {
          css = typeof item.source === 'string' ? item.source : undefined;
          drop.push(fileName);
        } else if (item.type === 'asset' && fileName.endsWith('.html')) {
          htmlFile = fileName;
        }
      }
      // 从 bundle 里删掉 = Rollup 不写这两个文件；内容已经在上面的 `js` / `css` 里
      for (const fileName of drop) delete bundle[fileName];
    },

    closeBundle() {
      const htmlPath = join(outDir, htmlFile);
      let html = readFileSync(htmlPath, 'utf8');

      if (css !== undefined) {
        const next = replaceOnce(html, '</head>', `<style>\n${css}\n</style>\n</head>`);
        if (next === undefined) throw new Error('inline-bundle: 找不到 </head>');
        html = next;
      }
      if (js !== undefined) {
        const next = replaceOnce(
          html,
          '</body>',
          `<script type="module">\n${escapeScriptText(js)}\n</script>\n</body>`,
        );
        if (next === undefined) throw new Error('inline-bundle: 找不到 </body>');
        html = next;
      }

      // 去掉外部引用：内联脚本已经包含了全部代码，
      // 再留一份 `<script src>` 会让服务器托管时挂载两次。
      html = html
        .replace(/\s*<script\b[^>]*\bsrc=[^>]*>\s*<\/script>/gi, '')
        .replace(/\s*<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi, '');

      writeFileSync(htmlPath, html, 'utf8');
      const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
      console.log(`\n  自包含产物：${htmlFile}（${kb} kB，已内联 JS/CSS，可双击打开）`);
    },
  };
}
