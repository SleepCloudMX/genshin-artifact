/**
 * 校验构建产物：确保 `index.html` 是**自包含**的，能被 `file://` 直接打开。
 *
 * 用 `pnpm build` 生成后再跑本测试。找不到产物就跳过（CI 里没构建时不误报）。
 *
 * 这里刻意校验得比较死：产物是本项目唯一的交付物，
 * 而「白屏」这种事故在单元测试里完全看不见（DOM 测试用源码，不走打包）。
 * 下面几条都有真实事故对应：
 *   - 残留外部 `<script src>` → file:// 被 CORS 拦，白屏；
 *   - 内联脚本里出现 `</script` → 标签提前闭合，白屏；
 *   - 内联脚本语法错误 → 白屏（`String.replace` 的 `$&` 模式曾经污染过代码）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { replaceOnce } from '../tools/inline-bundle';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HTML = `${REPO_ROOT}/index.html`;

const hasBuild = existsSync(HTML);
const html = hasBuild ? readFileSync(HTML, 'utf8') : '';

/** 取出内联的 module 脚本正文 */
function inlinedScript(source: string): string {
  const marker = '<script type="module">';
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const end = source.indexOf('</script>', start);
  return source.slice(start + marker.length, end < 0 ? undefined : end);
}

const inline = inlinedScript(html);

describe('内联替换器', () => {
  it('替换值里的 $& 不会被当成特殊模式', () => {
    // 这正是把压缩后的 `$(...)` 变量名变成 `</body>` 的那个坑
    const out = replaceOnce('<body>HELLO</body>', '</body>', 'a=$&b');
    expect(out).toBe('<body>HELLOa=$&b');
  });

  it('替换值里的 $` 与 $\' 同样原样保留', () => {
    expect(replaceOnce('X', 'X', "$`$'")).toBe("$`$'");
  });

  it('找不到锚点时返回 undefined', () => {
    expect(replaceOnce('abc', 'ZZZ', 'v')).toBeUndefined();
  });
});

describe.skipIf(!hasBuild)('构建产物自包含', () => {
  it('内联了 CSS 与入口脚本', () => {
    expect(html, '缺少内联 <style>').toContain('<style>');
    expect(html, '缺少内联 module 脚本').toContain('<script type="module">');
    expect(inline.length).toBeGreaterThan(8000);
  });

  it('没有任何外部脚本 / 样式引用（服务器托管时不能挂载两次）', () => {
    expect(/<script\b[^>]*\bsrc=/i.test(html), '残留 <script src>').toBe(false);
    expect(/<link\b[^>]*\brel=["']?stylesheet/i.test(html), '残留 <link rel=stylesheet>').toBe(false);
  });

  it('构建不再产出 assets/（产物是自包含单文件，那些文件没人引用）', () => {
    // 曾经的写法是「Vite 写盘 → 插件读回来内联」，于是每次构建都在 assets/ 里
    // 多留两个哈希文件名的死文件（攒到过 38 个 / 1.1 MB）。
    // 现在 JS/CSS 在 generateBundle 阶段就被取走并从 bundle 里删掉，不落盘。
    expect(existsSync(join(REPO_ROOT, 'assets')), 'assets/ 又被产出了').toBe(false);
    // 产物里当然也不能再引用它
    expect(/["'(]\.?\/?assets\//i.test(html), '产物里引用了 assets/').toBe(false);
  });

  it('图标是外链、没有被内联或改写成相对路径', () => {
    // 图标放在作者自己的仓库里，是稳定地址，因此直接外链、不下载进本仓库。
    // 要盯的是 Vite 的 HTML 处理：它会把**相对** URL 当资源打包，
    // 绝对 URL 必须原样留下。
    const m = /<link\b[^>]*\brel=["']?icon["']?[^>]*>/i.exec(html);
    expect(m, '产物里没有 <link rel=icon>').not.toBeNull();
    expect(m![0]).toContain('https://sleepcloudmx.github.io/Others/Image/kenomimi.png');
  });

  it('内联脚本不含顶层 import / export', () => {
    expect(/^\s*import[\s{]/m.test(inline), '内联脚本里残留 import').toBe(false);
    expect(/^\s*export[\s{]/m.test(inline), '内联脚本里残留 export').toBe(false);
  });

  it('内联脚本里没有会提前闭合标签的 </script', () => {
    expect(inline).not.toContain('</script');
  });

  it('内联脚本是**语法正确**的 JavaScript', () => {
    // 只看字符串是发现不了 `$&` 污染这类问题的，必须真的解析一遍
    const dir = mkdtempSync(join(tmpdir(), 'artifact-growth-'));
    const file = join(dir, 'inline.mjs');
    try {
      writeFileSync(file, inline, 'utf8');
      const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      expect(res.stderr || '', '内联脚本语法检查未通过').toBe('');
      expect(res.status, 'node --check 失败').toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('保留了启动兜底提示，且会在挂载后被清掉', () => {
    expect(html).toContain('boot-error');
    expect(html).toContain('mounted');
  });

  it('内联脚本确实是本应用（而不是空壳或被 tree-shaking 掉）', () => {
    // 运行时才会用到的字面量，能出现即说明入口与 core 都进包了
    expect(inline).toContain('圣遗物词条概率分布');
    expect(inline).toContain('目标分数');
    expect(inline).toContain('胚子得分');
    expect(inline).toContain('大攻击');
  });

  it('标题与主题脚本在 <head> 里就位', () => {
    expect(html).toContain('<title>圣遗物词条概率分布</title>');
    // 提前定主题，避免深色链接先闪一下浅色
    expect(html).toContain("dataset.theme");
  });
});

describe.skipIf(hasBuild)('构建产物（未构建，跳过）', () => {
  it('提示先运行 pnpm build', () => {
    expect(hasBuild).toBe(false);
  });
});
