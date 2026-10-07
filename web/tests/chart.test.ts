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
  renderQualityStacked,
  type SurvivalChartOptions,
  renderHistogram,
  hitColor,
  niceAxis,
  tickIndices,
  nearestIndex,
} from '../src/render/charts';
import { renderPie } from '../src/render/pie';
import { Tooltip } from '../src/render/tooltip';
import { pctTick } from '../src/ui/format';

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
  it('轴标号的小数位跟着刻度走（不再出现 `1%` 与 `0.5000%` 混排）', () => {
    expect(pctTick(0, 0.02)).toBe('0%');
    expect(pctTick(0.02, 0.02)).toBe('2%');
    // 0.5% 的步长：一律一位小数，且不能被写成 `1%`（那是下一个刻度）
    expect(pctTick(0.005, 0.005)).toBe('0.5%');
    expect(pctTick(0.01, 0.005)).toBe('1.0%');
    expect(pctTick(0.0025, 0.0025)).toBe('0.25%');
  });

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

  it('相邻刻度不会挤在一起（末尾那条曾叠成 52.854.4）', () => {
    // 默认分桶 0.2 分时正好是 66 根柱子：旧写法会在末尾多插一格，与前一条重叠
    expect(tickIndices(66, 8)).toEqual([0, 9, 19, 28, 37, 46, 56, 65]);
    /** 绘图区约 806px 宽，轴标约 24px 宽 —— 间隔换算成像素要放得下一条标签 */
    const PLOT_W = 806;
    const LABEL_W = 24;
    for (const count of [9, 12, 30, 66, 75, 87, 210, 283, 1000]) {
      for (const maxLabels of [5, 8, 12]) {
        const t = tickIndices(count, maxLabels);
        const tag = `count=${count} maxLabels=${maxLabels}`;
        expect(t[0], tag).toBe(0);
        expect(t[t.length - 1], tag).toBe(count - 1);
        expect(t.length, tag).toBeLessThanOrEqual(maxLabels);
        for (let i = 1; i < t.length; i++) {
          expect(t[i]!, tag).toBeGreaterThan(t[i - 1]!);
          expect((t[i]! - t[i - 1]!) * (PLOT_W / count), tag).toBeGreaterThan(LABEL_W);
        }
      }
    }
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

  it('分桶柱的悬停标题写成左闭右开区间 [a, b) 分', () => {
    const { host } = hoverBar(
      [
        { score: 10, range: { min: 10.0, max: 10.9 }, byHit: [0.2, 0.3, 0, 0, 0, 0] },
        { score: 11, range: { min: 11.0, max: 11.0 }, byHit: [0.1, 0.4, 0, 0, 0, 0] },
      ],
      0,
    );
    // 单位不能省：同一行上方还有 `12.5 分` 这种单点写法
    expect(host.querySelector('.tooltip .tt-title')!.textContent).toBe('[10.0, 11.0) 分');
    // 末尾那根桶只到 11.0，闭区间写法退化成左闭右开 + 真实上界
    const { host: h2 } = hoverBar(
      [
        { score: 10, range: { min: 10.0, max: 10.9 }, byHit: [0.2, 0.3, 0, 0, 0, 0] },
        { score: 11, range: { min: 11.0, max: 11.4 }, byHit: [0.1, 0.4, 0, 0, 0, 0] },
      ],
      1,
    );
    expect(h2.querySelector('.tooltip .tt-title')!.textContent).toBe('[11.0, 11.5) 分');
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

  it('与「概率分布」用同一套画布尺寸（兄弟视图不能一大一小）', () => {
    // 两张图在同一个面板位置上互相切换：宽度本来就都是容器宽，
    // 曾经差的是高度（0.34 vs 0.46），看上去就像图的宽窄变了
    const bars = renderScoreBars({
      data: makeData(30),
      hitLabels: HIT_LABELS,
      title: 't',
      tooltip: makeTooltip(),
    });
    const surv = renderSurvival({
      scores: [1, 2, 3],
      survival: [1, 0.5, 0],
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(surv.getAttribute('viewBox')).toBe(bars.getAttribute('viewBox'));
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

describe('质量分布（详细）', () => {
  const bars = [
    {
      score: 0,
      total: 0.3,
      atLeast: 1,
      segments: [
        { label: '无有效词条', size: 0, p: 0.3 },
      ],
    },
    {
      score: 3,
      total: 0.5,
      atLeast: 0.7,
      segments: [
        { label: '暴击', size: 1, p: 0.3 },
        { label: '暴击 + 精通', size: 2, p: 0.15 },
        { label: '暴击 + 精通 + 大攻击', size: 3, p: 0.05 },
      ],
    },
    {
      score: 7,
      total: 0.2,
      atLeast: 0.2,
      segments: [
        { label: '暴击 + 精通 + 大攻击 + 暴伤', size: 4, p: 0.2 },
      ],
    },
  ];

  it('每根柱子按组合拆成多段，段色按「几条有效词条」取', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    expect(svg.querySelectorAll('rect.bar-seg')).toHaveLength(5);
    // 0 条 / 1 条 / 2 条 / 3 条 / 4 条各一段，颜色必须与 hitColor(条数) 一致
    const fills = [...svg.querySelectorAll('rect.bar-seg')].map((r) => r.getAttribute('fill'));
    expect(new Set(fills)).toEqual(
      new Set([0, 1, 2, 3, 4].map((n) => hitColor(n))),
    );
  });

  it('堆叠顺序按条数从少到多（条数少的在下面）', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    const segs = [...svg.querySelectorAll('rect.bar-seg')];
    // 第 2 根柱子 3 段，DOM 顺序 = 绘制顺序 = 从下往上：1 条 → 2 条 → 3 条。
    // SVG 的 y 向下，所以「在下」= y 更大。
    const three = segs.slice(1, 4).map((r) => Number(r.getAttribute('y')));
    expect(three[0]!).toBeGreaterThan(three[1]!);
    expect(three[1]!).toBeGreaterThan(three[2]!);
  });

  it('画出累计概率曲线与节点，右侧标出真实概率', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    expect(svg.querySelector('path.cum-line')).not.toBeNull();
    expect(svg.querySelectorAll('rect.cum-dot')).toHaveLength(3);
    const labels = [...svg.querySelectorAll('text.cum-label')].map((n) => n.textContent);
    expect(labels).toEqual(['100.0%', '70.0%', '20.0%']);
    expect(svg.querySelector('text.cum-title')!.textContent).toBe('累计概率');
  });

  it('段内标注放得下才画（小段交给浮框）', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    const names = [...svg.querySelectorAll('text.seg-label')].map((n) => n.textContent);
    // 图例里也有文字，这里只看段内标注
    expect(names).not.toContain('暴击 + 精通 + 大攻击 + 暴伤'); // 11 字放不进柱宽
    expect(svg.querySelectorAll('text.seg-pct').length).toBe(names.length);
  });

  it('每根柱子一块热区 + 一条竖线（悬停交互）', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    expect(svg.querySelectorAll('rect.hot-rect')).toHaveLength(3);
    expect(svg.querySelector('line.guide')).not.toBeNull();
  });

  it('悬停给出该分数的组合明细与累计概率', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const tooltip = new Tooltip(host);
    host.append(renderQualityStacked({ bars, tooltip }));
    host
      .querySelectorAll('rect.hot-rect')[1]!
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    const tt = host.querySelector('.tooltip')!;
    expect(tt.querySelector('.tt-title')!.textContent).toBe('3 分');
    expect(tt.querySelector('.tt-badge')!.textContent).toBe('50.00%');
    const rows = [...tt.querySelectorAll('.tt-row')].map((r) => r.textContent);
    expect(rows.some((t) => t!.includes('暴击 + 精通'))).toBe(true);
    expect(rows.some((t) => t!.includes('本分数合计'))).toBe(true);
    expect(tt.textContent).toContain('P(得分 ≥ 3) = 70.00%');
  });

  it('空数据不抛错', () => {
    const svg = renderQualityStacked({ bars: [], tooltip: makeTooltip() });
    expect(svg.querySelectorAll('rect.bar-seg')).toHaveLength(0);
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

  it('每块都有图内标注：折线 + 名字 + 百分比', () => {
    const svg = renderPie({ items, title: 't', tooltip: makeTooltip() });
    expect(svg.querySelectorAll('polyline.pie-leader')).toHaveLength(3);
    expect(svg.querySelectorAll('text.pie-label')).toHaveLength(3);
    const pcts = [...svg.querySelectorAll('text.pie-pct')].map((n) => n.textContent);
    expect(pcts).toEqual(['40.00%', '30.00%', '30.00%']);
    expect([...svg.querySelectorAll('text.pie-label')].map((n) => n.textContent)).toEqual([
      '暴击 + 暴伤',
      '暴伤 + 大攻击',
      '其他 8 种组合',
    ]);
  });

  it('explode 的那一块真的被移开了，并带标记', () => {
    const svg = renderPie({
      items: [...items.slice(0, 2), { label: '暴击 + 暴伤 + 精通', p: 0.02, explode: true }],
      title: 't',
      tooltip: makeTooltip(),
    });
    const exploded = svg.querySelectorAll('path.pie-slice[data-explode="1"]');
    expect(exploded).toHaveLength(1);
    expect(exploded[0]!.getAttribute('transform')).toMatch(/^translate\(/);
    expect(exploded[0]!.classList.contains('exploded')).toBe(true);
    // 其余分片不位移
    const others = [...svg.querySelectorAll('path.pie-slice')].filter(
      (p) => p.getAttribute('data-explode') !== '1',
    );
    for (const p of others) expect(p.getAttribute('transform')).toBeNull();
  });

  it('同一侧的标签会避让，不会互相叠住', () => {
    // 12 块等分：中缝落点很近，不避让的话标签会重叠
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `组合 ${i}`, p: 1 / 12 }));
    const svg = renderPie({ items: many, title: 't', tooltip: makeTooltip() });
    for (const side of ['start', 'end']) {
      const ys = [...svg.querySelectorAll(`text.pie-label[text-anchor="${side}"]`)]
        .map((n) => Number(n.getAttribute('y')))
        .sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(4);
    }
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
