/**
 * 图表结构测试：验证 SVG 里真的画出了柱子、累积曲线与图例，
 * 而不是一个空壳（那类问题在冒烟测试里看不出来）。
 */

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderStackedChart } from '../src/render/charts';

function makeData(bars: number) {
  return Array.from({ length: bars }, (_, i) => ({
    score: 10 + i * 0.1,
    byHit: [0.1, 0.2, 0.3, 0.2, 0.1, 0.1].map((v) => v / bars),
  }));
}

describe('SVG 图表结构', () => {
  it('柱子数量等于「分数个数 × 命中档数」中非零的部分', () => {
    const data = makeData(20);
    const svg = renderStackedChart({
      data,
      hitLabels: ['命中 0 次', '命中 1 次', '命中 2 次', '命中 3 次', '命中 4 次', '命中 5 次'],
    });
    const bars = svg.querySelectorAll('rect.bar-seg');
    // 每根柱子 6 个 stack 段
    expect(bars.length).toBe(20 * 6);
  });

  it('画出累积曲线，且路径点数与分数个数一致', () => {
    const svg = renderStackedChart({
      data: makeData(15),
      hitLabels: Array.from({ length: 6 }, (_, h) => `命中 ${h} 次`),
    });
    const path = svg.querySelector('path.cdf');
    expect(path).not.toBeNull();
    const d = path!.getAttribute('d')!;
    expect(d.startsWith('M')).toBe(true);
    expect(d.split('L').length).toBe(15);
  });

  it('累积曲线从 100% 开始、单调下降', () => {
    const svg = renderStackedChart({
      data: makeData(12),
      hitLabels: Array.from({ length: 6 }, (_, h) => `命中 ${h} 次`),
    });
    const ys = [...svg.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cy')));
    expect(ys.length).toBe(12);
    // SVG 的 y 轴向下，所以「概率下降」= cy 增大
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]!);
  });

  it('每个柱段带 tooltip 文案', () => {
    const svg = renderStackedChart({
      data: makeData(3),
      hitLabels: ['命中 0 次', '命中 1 次', '命中 2 次', '命中 3 次', '命中 4 次', '命中 5 次'],
    });
    const tips = [...svg.querySelectorAll('rect.bar-seg title')].map((t) => t.textContent ?? '');
    expect(tips.length).toBeGreaterThan(0);
    expect(tips[0]).toMatch(/命中 \d 次：/);
  });

  it('图例包含所有命中档与累积曲线', () => {
    const svg = renderStackedChart({
      data: makeData(5),
      hitLabels: Array.from({ length: 6 }, (_, h) => `命中 ${h} 次`),
    });
    const labels = [...svg.querySelectorAll('text.legend-label')].map((t) => t.textContent);
    for (let h = 0; h < 6; h++) expect(labels).toContain(`命中 ${h} 次`);
    expect(labels.some((l) => l?.includes('累积概率'))).toBe(true);
  });

  it('空数据不抛错', () => {
    const svg = renderStackedChart({ data: [], hitLabels: [] });
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('分数很多时不画柱上标注（避免糊成一片）', () => {
    const many = renderStackedChart({
      data: makeData(200),
      hitLabels: Array.from({ length: 6 }, (_, h) => `命中 ${h} 次`),
      showLabels: true,
    });
    expect(many.querySelectorAll('text.bar-label').length).toBe(0);
  });
});
