/**
 * 校验构建产物：确保 `index.html` 是**自包含**的，能被 `file://` 直接打开。
 *
 * 用 `pnpm build` 生成后再跑本测试。找不到产物就跳过（CI 里没构建时不误报）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HTML = `${REPO_ROOT}/index.html`;

const hasBuild = existsSync(HTML);

describe.skipIf(!hasBuild)('构建产物自包含', () => {
  const html = hasBuild ? readFileSync(HTML, 'utf8') : '';

  it('内联了 CSS 与入口脚本', () => {
    expect(html, '缺少内联 <style>').toContain('<style>');
    expect(html, '缺少内联 module 脚本').toContain('<script type="module">');
  });

  it('内联脚本不含顶层 import（否则 file:// 仍会失败）', () => {
    const inlined = html.split('<script type="module">')[1]!.split('</script>')[0]!;
    expect(inlined.length).toBeGreaterThan(1000);
    // 顶层 import/export 必须已被打包器消除
    expect(/^\s*import[\s{]/m.test(inlined), '内联脚本里残留 import').toBe(false);
    expect(/^\s*export[\s{]/m.test(inlined), '内联脚本里残留 export').toBe(false);
  });

  it('内联脚本里没有会提前闭合标签的 </script>', () => {
    const inlined = html.split('<script type="module">')[1]!.split('</script>')[0]!;
    expect(inlined).not.toContain('</script>');
  });

  it('保留了启动兜底提示，且会在挂载后被清掉', () => {
    expect(html).toContain('boot-error');
    // main.ts 会清空 #app 并置 mounted，兜底计时器据此不再提示
    expect(html).toContain('mounted');
  });

  it('内联脚本确实是本应用（而不是空壳或被 tree-shaking 掉）', () => {
    const inlined = html.split('<script type="module">')[1]!.split('</script>')[0]!;
    // 这些是运行时才会用到的字面量，能出现即说明入口与 core 都进包了
    expect(inlined).toContain('圣遗物词条概率分布');
    expect(inlined).toContain('目标分数');
    expect(inlined).toContain('胚子得分');
    // 计算核心的痕迹
    expect(inlined.length).toBeGreaterThan(8000);
  });
});

describe.skipIf(hasBuild)('构建产物（未构建，跳过）', () => {
  it('提示先运行 pnpm build', () => {
    expect(hasBuild).toBe(false);
  });
});
