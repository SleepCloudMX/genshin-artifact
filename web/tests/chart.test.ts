/**
 * 图表结构测试：验证 SVG 里真的画出了柱子 / 曲线 / 扇形，
 * 而不是一个空壳（那类问题在冒烟测试里看不出来）。
 *
 * 重点覆盖「拆图」这件事：堆叠柱与生存曲线必须是两张独立纵轴的图，
 * 早期版本把它们叠在一个坐标系里，看起来就像曲线画错了。
 */

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  renderScoreBars,
  renderSurvival,
  type SurvivalChartOptions,
  renderHistogram,
  niceAxis,
  tickIndices,
  nearestIndex,
} from '../src/render/charts';
import { renderPie } from '../src/render/pie';
import { Tooltip } from '../src/render/tooltip';

function makeTooltip(): Tooltip {
  const host = document.createElement('div');
  document.body.append(host);
  return new Tooltip(host);
}

function makeData(bars: number) {
  return Array.from({ length: bars }, (_, i) => ({
    score: 10 + i * 0.1,
    byHit: [0.1, 0.2, 0.3, 0.2, 0.1, 0.1].map((v) => v / bars),
  }));
}

const HIT_LABELS = Array.from({ length: 6 }, (_, h) => `命中 ${h} 次`);

describe('坐标轴工具', () => {
  it('niceAxis 给出整齐的上限与步长', () => {
    const a = niceAxis(0.19);
    expect(a.max % a.step).toBeCloseTo(0, 10);
    expect(a.max).toBeGreaterThanOrEqual(0.19);
    expect(a.max).toBeLessThan(0.19 * 2);
  });

  it('niceAxis 对 0 / 非法值不返回 NaN', () => {
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const a = niceAxis(v);
      expect(Number.isFinite(a.max)).toBe(true);
      expect(a.step).toBeGreaterThan(0);
    }
  });

  it('tickIndices 最多 maxLabels 个，且含首尾', () => {
    const t = tickIndices(283, 12);
    expect(t.length).toBeLessThanOrEqual(13);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(282);
    expect(tickIndices(5)).toEqual([0, 1, 2, 3, 4]);
    expect(tickIndices(0)).toEqual([]);
    // 默认值要够稀疏（柱状图下面还有图例，刻度太密会抢视线）
    expect(tickIndices(283).length).toBeLessThanOrEqual(9);
  });

  it('nearestIndex 找最近的分数', () => {
    expect(nearestIndex([10, 20, 30], 21)).toBe(1);
    expect(nearestIndex([10, 20, 30], 100)).toBe(2);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe('得分分布堆叠柱', () => {
  it('柱子数量等于「分数个数 × 非零命中档」', () => {
    const svg = renderScoreBars({
      data: makeData(20),
      hitLabels: HIT_LABELS,
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(svg.querySelectorAll('rect.bar-seg')).toHaveLength(20 * 6);
  });

  it('每个分数一列透明热区（悬停用）', () => {
    const svg = renderScoreBars({
      data: makeData(15),
      hitLabels: HIT_LABELS,
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(svg.querySelectorAll('rect.hot-rect')).toHaveLength(15);
    expect(svg.querySelectorAll('line.guide')).toHaveLength(1);
  });

  it('**不**包含累积曲线——那是另一张图的事', () => {
    const svg = renderScoreBars({
      data: makeData(15),
      hitLabels: HIT_LABELS,
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(svg.querySelector('path.series-line')).toBeNull();
    expect(svg.querySelector('path.cdf')).toBeNull();
  });

  it('图例包含所有命中档，且没有「累积概率」', () => {
    const svg = renderScoreBars({
      data: makeData(5),
      hitLabels: HIT_LABELS,
      title: 't',
      tooltip: makeTooltip(),
    });
    const labels = [...svg.querySelectorAll('text.legend-label')].map((t) => t.textContent);
    for (let h = 0; h < 6; h++) expect(labels).toContain(`命中 ${h} 次`);
    expect(labels.some((l) => l?.includes('累积'))).toBe(false);
  });

  /**
   * 挂一个浮框渲染得分分布图，并悬停第 i 根柱子。
   * 派发 `mouseenter`（监听挂在 enter 上，不是 `mousemove`）。
   */
  function hoverBar(
    data: { score: number; range?: { min: number; max: number }; byHit: number[] }[],
    i: number,
  ): { host: HTMLElement; svg: SVGSVGElement } {
    const host = document.createElement('div');
    document.body.append(host);
    const tooltip = new Tooltip(host);
    const svg = renderScoreBars({ data, hitLabels: HIT_LABELS, title: 't', tooltip });
    host.append(svg);
    svg
      .querySelectorAll('rect.hot-rect')
      [i]!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return { host, svg };
  }

  it('概率写在浮框标题行的右上角（badge），高亮', () => {
    const { host } = hoverBar(makeData(5), 2);
    const head = host.querySelector('.tooltip .tt-head')!;
    expect(head).not.toBeNull();
    expect(head.querySelector('.tt-title')!.textContent).toBe('10.2 分');
    const badge = head.querySelector('.tt-badge')!;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toMatch(/%$/);
  });

  it('图上不再另设概率角标（概率只在浮框里）', () => {
    const svg = renderScoreBars({
      data: makeData(10),
      hitLabels: HIT_LABELS,
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(svg.querySelector('.bar-badge, .bar-badge-text, .bar-badge-bg')).toBeNull();
  });
  it('浮框里不再有啰嗦的「落在这个区间的概率 …」那行', () => {
    const { host } = hoverBar(makeData(5), 2);
    const text = host.querySelector('.tooltip')!.textContent ?? '';
    expect(text).not.toContain('落在');
    expect(text).not.toContain('恰好等于');
    // 分档明细还在
    expect(host.querySelectorAll('.tooltip .tt-row').length).toBeGreaterThan(0);
  });

  it('只有一根柱子时，分档明细不写「占本柱 100%」', () => {
    const single = hoverBar([{ score: 10.0, byHit: [0, 0, 0.4, 0, 0, 0] }], 0);
    const multi = hoverBar([{ score: 10.0, byHit: [0.1, 0.3, 0, 0, 0, 0] }], 0);
    const value = (h: HTMLElement) => h.querySelector('.tooltip .tt-row .tt-value')!.textContent!;

    expect(value(single.host)).not.toContain('占本柱');
    expect(value(multi.host)).toContain('占本柱');
  });

  it('分桶柱的悬停标题写成左闭右开区间 [a, b)', () => {
    const { host } = hoverBar(
      [
        { score: 10, range: { min: 10.0, max: 10.9 }, byHit: [0.2, 0.3, 0, 0, 0, 0] },
        { score: 11, range: { min: 11.0, max: 11.0 }, byHit: [0.1, 0.4, 0, 0, 0, 0] },
      ],
      0,
    );
    expect(host.querySelector('.tooltip .tt-title')!.textContent).toBe('[10.0, 11.0)');
    // 末尾那根桶只到 11.0，闭区间写法退化成左闭右开 + 真实上界
    const { host: h2 } = hoverBar(
      [
        { score: 10, range: { min: 10.0, max: 10.9 }, byHit: [0.2, 0.3, 0, 0, 0, 0] },
        { score: 11, range: { min: 11.0, max: 11.4 }, byHit: [0.1, 0.4, 0, 0, 0, 0] },
      ],
      1,
    );
    expect(h2.querySelector('.tooltip .tt-title')!.textContent).toBe('[11.0, 11.5)');
  });

  it('不分桶时标题就是单点分数', () => {
    const { host } = hoverBar([{ score: 12.5, byHit: [0.2, 0.3, 0, 0, 0, 0] }], 0);
    expect(host.querySelector('.tooltip .tt-title')!.textContent).toBe('12.5 分');
  });

  it('目标分数处画参考线', () => {
    const withMarker = renderScoreBars({
      data: makeData(30),
      hitLabels: HIT_LABELS,
      title: 't',
      marker: { score: 11, label: '目标 11.0' },
      tooltip: makeTooltip(),
    });
    expect(withMarker.querySelectorAll('line.marker-line')).toHaveLength(1);
    expect(withMarker.querySelector('text.marker-label')?.textContent).toBe('目标 11.0');
  });

  it('空数据不抛错', () => {
    const svg = renderScoreBars({ data: [], hitLabels: [], title: 't', tooltip: makeTooltip() });
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('分数多时不画柱上标注（避免糊成一片）', () => {
    const many = renderScoreBars({
      data: makeData(200),
      hitLabels: HIT_LABELS,
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(many.querySelectorAll('text.bar-label')).toHaveLength(0);
  });
});

describe('生存曲线（独立成图）', () => {
  it('画出填充区与折线，点数与分数个数一致', () => {
    const scores = Array.from({ length: 15 }, (_, i) => 10 + i * 0.1);
    const surv = scores.map((_, i) => 1 - i / scores.length);
    const svg = renderSurvival({ scores, survival: surv, title: 't', tooltip: makeTooltip() });

    const d = svg.querySelector('path.series-line')!.getAttribute('d')!;
    expect(d.startsWith('M')).toBe(true);
    expect(d.split('L')).toHaveLength(15);
    expect(svg.querySelector('path.series-area')).not.toBeNull();
  });

  it('纵轴是固定的 0~100%，刻度含 0% 与 100%', () => {
    const scores = [1, 2, 3, 4];
    const svg = renderSurvival({
      scores,
      survival: [1, 0.5, 0.25, 0],
      title: 't',
      tooltip: makeTooltip(),
    });
    const labels = [...svg.querySelectorAll('text.axis-label')].map((t) => t.textContent);
    expect(labels).toContain('0%');
    expect(labels).toContain('100%');
  });

  it('曲线单调下降：概率越低，y 越大（SVG 的 y 向下）', () => {
    const scores = Array.from({ length: 12 }, (_, i) => i);
    const surv = scores.map((_, i) => 1 - i / 12);
    const svg = renderSurvival({ scores, survival: surv, title: 't', tooltip: makeTooltip() });
    const ys = svg
      .querySelector('path.series-line')!
      .getAttribute('d')!
      .split(/[ML]/)
      .filter(Boolean)
      .map((pair) => Number(pair.split(',')[1]));
    expect(ys).toHaveLength(12);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]!);
  });

  it('**不**画堆叠柱——职责分离', () => {
    const svg = renderSurvival({
      scores: [1, 2, 3],
      survival: [1, 0.5, 0],
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(svg.querySelectorAll('rect.bar-seg')).toHaveLength(0);
  });

  /** 悬停第 i 列，返回浮框节点 */
  function hoverCol(opts: Omit<SurvivalChartOptions, 'tooltip'>, i: number): HTMLElement {
    const host = document.createElement('div');
    document.body.append(host);
    const tooltip = new Tooltip(host);
    const svg = renderSurvival({ ...opts, tooltip });
    host.append(svg);
    svg
      .querySelectorAll('rect.hot-rect')
      [i]!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return host.querySelector('.tooltip') as HTMLElement;
  }

  it('浮框里画出「≥ 该分数时命中次数」的横排柱状图', () => {
    const scores = [10, 11, 12, 13];
    const surv = [1, 0.6, 0.25, 0.04];
    // 第 2 列：命中 1 次 0.5 / 命中 3 次 0.5（0 的不画）
    const mix = [0, 0.5, 0, 0.5, 0, 0];
    const node = hoverCol(
      {
        scores,
        survival: surv,
        hitLabels: HIT_LABELS,
        hitMix: () => mix,
        hitMixCaption: '仅统计 ≥ 该分数的结果（合计 100%）',
        title: 't',
      },
      2,
    );

    const cap = node.querySelector('.tt-chart-cap')!;
    expect(cap.textContent).toContain('合计 100%');

    const bars = [...node.querySelectorAll('.tt-bar')];
    expect(bars).toHaveLength(2); // 概率为 0 的档不画
    expect(bars[0]!.querySelector('.tt-bar-label')!.textContent).toBe('命中 1 次');
    expect(bars[0]!.querySelector('.tt-bar-value')!.textContent).toBe('50.0%');
    expect(bars[1]!.querySelector('.tt-bar-label')!.textContent).toBe('命中 3 次');
    // 条长 = 概率本身；颜色与「命中次数」图共用同一套命中档配色
    const fill = bars[1]!.querySelector('.tt-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(fill.style.background).not.toBe('');
  });

  it('不给 hitMix 就不画柱状图（其他图共用同一个浮框组件）', () => {
    const node = hoverCol({ scores: [10, 11], survival: [1, 0.5], title: 't' }, 0);
    expect(node.querySelectorAll('.tt-bar')).toHaveLength(0);
    expect(node.querySelector('.tt-chart')).toBeNull();
  });

  it('概率全为 0 时不画空图，也不留小标题', () => {
    const node = hoverCol(
      { scores: [10, 11], survival: [1, 0.5], hitLabels: HIT_LABELS, hitMix: () => [0, 0, 0], title: 't' },
      0,
    );
    expect(node.querySelector('.tt-chart')).toBeNull();
  });
});

describe('分类柱状图', () => {
  it('每个分类一根柱子 + 一块热区', () => {
    const svg = renderHistogram({
      items: [
        { label: '命中 0 次', value: 0.1 },
        { label: '命中 1 次', value: 0.4 },
        { label: '命中 2 次', value: 0.5 },
      ],
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(svg.querySelectorAll('rect.bar-seg')).toHaveLength(3);
    expect(svg.querySelectorAll('rect.hot-rect')).toHaveLength(3);
  });
});

describe('环形图', () => {
  const items = [
    { label: '暴击 + 暴伤', p: 0.4 },
    { label: '暴伤 + 大攻击', p: 0.3 },
    { label: '其他 8 种组合', p: 0.3 },
  ];

  it('概率 > 0 的分片都画出来', () => {
    const svg = renderPie({ items, title: 't', tooltip: makeTooltip() });
    expect(svg.querySelectorAll('path.pie-slice')).toHaveLength(3);
  });

  it('概率为 0 的分片跳过（不画退化路径）', () => {
    const svg = renderPie({
      items: [...items, { label: '不可能', p: 0 }],
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(svg.querySelectorAll('path.pie-slice')).toHaveLength(3);
  });

  it('全 0 不抛错', () => {
    const svg = renderPie({
      items: [{ label: 'a', p: 0 }],
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(svg.querySelectorAll('path.pie-slice')).toHaveLength(0);
  });
});

describe('浮框', () => {
  it('show 渲染出标题、副标题、行与脚注', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const tooltip = new Tooltip(host);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    document.body.append(svg);
    tooltip.show(
      {
        title: '14.6 分',
        badge: '2.31%',
        subtitle: '恰好等于该分数的概率 2.31%',
        rows: [{ label: '命中 3 次', value: '1.20%', color: '#3b82f6' }],
        footer: '第 1 / 100 个可能分数',
      },
      10,
      10,
    );

    const node = host.querySelector('.tooltip')!;
    expect(node).not.toBeNull();
    expect((node as HTMLElement).hidden).toBe(false);
    expect(node.querySelector('.tt-title')?.textContent).toBe('14.6 分');
    expect(node.querySelector('.tt-badge')?.textContent).toBe('2.31%');
    expect(node.querySelector('.tt-sub')?.textContent).toContain('2.31%');
    expect(node.querySelectorAll('.tt-row')).toHaveLength(1);
    expect(node.querySelector('.tt-foot')?.textContent).toContain('第 1 / 100');
  });

  it('hide 之后不可见', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const tooltip = new Tooltip(host);
    tooltip.show({ title: 'x', rows: [] }, 0, 0);
    tooltip.hide();
    expect((host.querySelector('.tooltip') as HTMLElement).hidden).toBe(true);
  });
});
