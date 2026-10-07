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
  categoricalColor,
  CATEGORICAL_COLORS,
  textWidth,
  wrapCombo,
  niceAxis,
  tightAxis,
  BLUE_RAMP,
  inkOn,
  luminance,
  rampColor,
  segmentColor,
  tickIndices,
  nearestIndex,
} from '../src/render/charts';
import { renderPie } from '../src/render/pie';
import { heatColor, inkOf, renderHeatmap } from '../src/render/heatmap';
import { OTHER_MAIN, nextSubstatDist, substatHeatmap } from '../src/core/heatmap';
import { SUB_ATTRS, type SubAttr } from '../src/core/stats';
import { Tooltip } from '../src/render/tooltip';
import { pctTick } from '../src/ui/format';

function makeTooltip(): Tooltip {
  const host = document.createElement('div');
  document.body.append(host);
  return new Tooltip(host);
}

/** 子串出现次数：浮框里同一个数只许出现一次 */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
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

  it('tightAxis 的上限贴着峰值（作者：不要固定成 40% 那种），刻度仍是整齐步长', () => {
    // 默认配置下最高那根柱子 31.97%：旧算法把它抬到 40%，柱子只占了 80% 的高度
    const a = tightAxis(0.3197);
    expect(a.max).toBeCloseTo(0.3197 * 1.06, 6);
    expect(a.max).toBeLessThan(0.4);
    expect(a.step).toBe(0.1);
    // 步长仍是整齐值，且第一条网格线不会超过上限
    expect(niceAxis(a.max).max % a.step).toBeCloseTo(0, 10);
    // 峰值 / 上限 = 94%，柱子几乎顶到绘图区上沿
    expect(0.3197 / a.max).toBeCloseTo(0.943, 3);
    expect(Number.isFinite(tightAxis(0).max)).toBe(true);
  });

  it('rampColor 是浅到深的单色相蓝，越界不炸', () => {
    expect(rampColor(0)).toBe(BLUE_RAMP[0]);
    expect(rampColor(1)).toBe(BLUE_RAMP[BLUE_RAMP.length - 1]);
    // 单调变深
    for (let t = 0; t < 1; t += 0.1) {
      expect(luminance(rampColor(t))).toBeGreaterThanOrEqual(luminance(rampColor(t + 0.1)));
    }
    expect(luminance(rampColor(0))).toBeGreaterThan(luminance(rampColor(1)) + 0.2);
    // 越界的 t 夹到两端
    expect(rampColor(-1)).toBe(rampColor(0));
    expect(rampColor(2)).toBe(rampColor(1));
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

  it('浮框不再有「第 N / M 根柱子」这类脚注 —— 竖线已经指出位置了', () => {
    const { host } = hoverBar(makeData(5), 2);
    expect(host.querySelector('.tooltip .tt-foot')).toBeNull();
    expect(host.querySelector('.tooltip')!.textContent).not.toContain('第 ');
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

  it('浮框里画出「≥ 该分数时命中次数」的横排柱状图', () => {    const scores = [10, 11, 12, 13];
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

  it('浮框不抄一遍图名的公式：没有副标题，也没有「曲线越靠右越低」这种废话', () => {
    const node = hoverCol({ scores: [10, 11], survival: [1, 0.5], title: 't' }, 1);
    // 概率在 badge 里；标题只说「哪条线」
    expect(node.querySelector('.tt-title')!.textContent).toBe('11.0 分及以上');
    expect(node.querySelector('.tt-badge')!.textContent).toBe('50.00%');
    expect(node.querySelector('.tt-sub')).toBeNull();
    expect(node.querySelector('.tt-foot')).toBeNull();
    expect(node.textContent).not.toContain('P(得分 ≥ 11.0)');
  });

  it('不给 hitMix 就不画柱状图（其他图共用同一个浮框组件）', () => {
    const node = hoverCol({ scores: [10, 11], survival: [1, 0.5], title: 't' }, 0);    expect(node.querySelectorAll('.tt-bar')).toHaveLength(0);
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

  it('浮框：数值进 badge（纵轴已经是概率），标题就是轴上的标号', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const tooltip = new Tooltip(host);
    host.append(
      renderHistogram({
        items: [{ label: '命中 2 次', value: 0.4 }],
        title: 't',
        tooltip,
      }),
    );
    host
      .querySelectorAll('rect.hot-rect')[0]!
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const tt = host.querySelector('.tooltip')!;
    expect(tt.querySelector('.tt-title')!.textContent).toBe('命中 2 次');
    expect(tt.querySelector('.tt-badge')!.textContent).toBe('40.00%');
    // 不再有一行叫「概率」的（纵轴就是概率），也不再有「说明」这种占位标签
    expect(tt.textContent).not.toContain('概率');
    expect(tt.textContent).not.toContain('说明');
  });
});

describe('质量分布', () => {
  type Bars = Parameters<typeof renderQualityStacked>[0]['bars'];
  /**
   * 四根柱子，数字自洽（合计 100%）：15% 一根独苗、50% 分三段、20% 一整段（4 条词条，
   * 名字在柱宽里一行写不下）、15% 一根独苗。
   */
  const bars: Bars = [
    {
      score: 0,
      total: 0.15,
      atLeast: 1,
      segments: [
        { label: '无有效词条', attrs: [], size: 0, p: 0.15 },
      ],
    },
    {
      score: 3,
      total: 0.5,
      atLeast: 0.85,
      segments: [
        { label: '暴击', attrs: ['暴击'], size: 1, p: 0.3 },
        { label: '暴击 + 精通', attrs: ['暴击', '精通'], size: 2, p: 0.15 },
        { label: '暴击 + 精通 + 大攻击', attrs: ['暴击', '精通', '大攻击'], size: 3, p: 0.05 },
      ],
    },
    {
      score: 7,
      total: 0.2,
      atLeast: 0.35,
      segments: [
        {
          label: '暴击 + 精通 + 大攻击 + 暴伤',
          attrs: ['暴击', '精通', '大攻击', '暴伤'],
          size: 4,
          p: 0.2,
        },
      ],
    },
    {
      score: 10,
      total: 0.15,
      atLeast: 0.15,
      segments: [{ label: '暴伤', attrs: ['暴伤'], size: 1, p: 0.15 }],
    },
  ];

  /** 三个通道之和，只用来比较「谁更浅」 */
  function brightness(hex: string): number {
    return [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0);
  }

  it('一列的段由浅到深渐变，**段内是纯色**（作者：渐变是段与段之间的事）', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    const fills = [...svg.querySelectorAll('rect.bar-seg')].map((r) => r.getAttribute('fill'));
    expect(fills).toHaveLength(6);
    // 一根段、三段、一根段、一根段：每列都按 (k+1)/(n+1) 取色标
    expect(fills).toEqual([
      segmentColor(0, 1),
      segmentColor(0, 3),
      segmentColor(1, 3),
      segmentColor(2, 3),
      segmentColor(0, 1),
      segmentColor(0, 1),
    ]);
    // 段内纯色：没有渐变引用，也没有 defs
    for (const f of fills) expect(f).toMatch(/^#[0-9a-f]{6}$/);
    expect(svg.querySelectorAll('defs, linearGradient')).toHaveLength(0);
    // 一列里由下到上越来越深
    const three = fills.slice(1, 4);
    for (let i = 1; i < three.length; i++) {
      expect(brightness(three[i]!), `第 ${i} 段应当比下一段深`).toBeLessThan(
        brightness(three[i - 1]!),
      );
    }
    // 单段的一列取色标正中那档，不会淡成一片白
    expect(luminance(segmentColor(0, 1))).toBeLessThan(luminance(segmentColor(0, 3)));
  });

  it('纵轴贴着最高的柱子（不再固定到 40% 那种整齐上限）', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    const height = Number(svg.getAttribute('viewBox')!.split(' ')[3]);
    const plotH = height - 40 - 58;
    // 最高那根（50%）的段高之和应当接近整个绘图区高度：上限 = 峰值 × 1.06
    const tallest = [...svg.querySelectorAll('rect.bar-seg')]
      .slice(1, 4)
      .reduce((s, r) => s + Number(r.getAttribute('height')), 0);
    expect(tallest / plotH).toBeGreaterThan(0.92);
    expect(tallest / plotH).toBeLessThan(0.96);
    // 左轴刻度只画到不超过上限的那些：0 / 20% / 40%（上限 53%）
    const ticks = [...svg.querySelectorAll('text.axis-label')]
      .filter((n) => Number(n.getAttribute('x')) < 0)
      .map((n) => n.textContent);
    expect(ticks).toEqual(['0%', '20%', '40%']);
  });

  it('同一根柱子里的段两两不同色（作者要求：柱内要有区分度）', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    // 第 2 根柱子（3 段）的颜色互不相同 —— 旧版按「几条有效词条」取色时它们全是同一个蓝
    const three = [...svg.querySelectorAll('rect.bar-seg')].slice(1, 4).map((r) => r.getAttribute('fill'));
    expect(new Set(three).size).toBe(3);
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

  it('画出累计概率曲线与节点，右侧标出真实概率，轴名竖排', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    expect(svg.querySelector('path.cum-line')).not.toBeNull();
    expect(svg.querySelectorAll('rect.cum-dot')).toHaveLength(4);
    const labels = [...svg.querySelectorAll('text.cum-label')].map((n) => n.textContent);
    // 20% 那根的刻度（35%）与它自己的柱顶标注只差 10px（< 11）→ 让路，见下一条用例
    expect(labels).toEqual(['100.0%', '85.0%', '15.0%']);
    const title = svg.querySelector('text.cum-title')!;
    expect(title.textContent).toBe('累计概率');
    // 竖排（绕自己的位置转 90°），把右上角让给角标
    expect(title.getAttribute('transform')).toMatch(/^rotate\(90 /);
  });

  it('累计概率可以关掉：曲线、节点、刻度、轴名一起消失', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip(), showCum: false });
    expect(svg.querySelector('path.cum-line')).toBeNull();
    expect(svg.querySelectorAll('rect.cum-dot')).toHaveLength(0);
    expect(svg.querySelectorAll('text.cum-label')).toHaveLength(0);
    expect(svg.querySelector('text.cum-title')).toBeNull();
    // 柱子还在，柱顶也照标
    expect(svg.querySelectorAll('rect.bar-seg')).toHaveLength(6);
    expect([...svg.querySelectorAll('text.bar-label')].map((n) => n.textContent)).toEqual([
      '15.0%',
      '50.0%',
      '20.0%',
      '15.0%',
    ]);
  });

  it('柱顶标注：大于 4% 的一律标出来', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    expect([...svg.querySelectorAll('text.bar-label')].map((n) => n.textContent)).toEqual([
      '15.0%',
      '50.0%',
      '20.0%',
      '15.0%',
    ]);
  });

  it('柱顶标注与累计刻度快要叠在一起时，舍刻度保柱顶', () => {
    // 最低分那档 50%：右轴是真正的 0~100% 轴，它的累计值 95% 落在柱顶（94.3%）上方 2px 处
    const tight: Bars = [
      { score: 0, total: 0.5, atLeast: 0.95, segments: [{ label: '无有效词条', attrs: [], size: 0, p: 0.5 }] },
      { score: 3, total: 0.3, atLeast: 0.45, segments: [{ label: '暴击', attrs: ['暴击'], size: 1, p: 0.3 }] },
      { score: 5, total: 0.2, atLeast: 0.2, segments: [{ label: '暴伤', attrs: ['暴伤'], size: 1, p: 0.2 }] },
    ];
    const svg = renderQualityStacked({ bars: tight, tooltip: makeTooltip() });
    expect([...svg.querySelectorAll('text.bar-label')].map((n) => n.textContent)).toEqual([
      '50.0%',
      '30.0%',
      '20.0%',
    ]);
    expect([...svg.querySelectorAll('text.cum-label')].map((n) => n.textContent)).toEqual([
      '45.0%',
      '20.0%',
    ]);
  });

  it('右轴刻度自己也不叠：累计值挨得太近就舍掉后面那个', () => {
    // 结构用的合成数据（合计 100%）：第三根柱子只有 1%，它的累计值（28%）
    // 与第四根的（27%）在图上只差 4px —— 旧版会把 `27.0%` 直接压在 `28.0%` 上。
    // 四根的柱顶值都离自己的累计点很远（都 > 11px），所以这一条只考验刻度之间。
    const tail: Bars = [
      { score: 0, total: 0.4, atLeast: 1, segments: [{ label: '无有效词条', attrs: [], size: 0, p: 0.4 }] },
      { score: 1, total: 0.32, atLeast: 0.6, segments: [{ label: '暴击', attrs: ['暴击'], size: 1, p: 0.32 }] },
      { score: 2, total: 0.01, atLeast: 0.28, segments: [{ label: '暴伤', attrs: ['暴伤'], size: 1, p: 0.01 }] },
      { score: 4, total: 0.27, atLeast: 0.27, segments: [{ label: '精通', attrs: ['精通'], size: 1, p: 0.27 }] },
    ];
    const svg = renderQualityStacked({ bars: tail, tooltip: makeTooltip() });
    expect([...svg.querySelectorAll('text.cum-label')].map((n) => n.textContent)).toEqual([
      '100.0%',
      '60.0%',
      '28.0%',
    ]);
  });

  it('柱顶值每根都标：柱子再小也标在柱子上方', () => {
    // 作者 2026-10-08：「最低那档你为什么不在柱子上方标出概率？标在柱子上方，
    // 无论柱子有多小，都不可能空间不够。」—— 旧版 0.02 那根顶上什么都没有。
    const mixed: Bars = [
      { score: 0, total: 0.5, atLeast: 1, segments: [{ label: '无有效词条', attrs: [], size: 0, p: 0.5 }] },
      {
        score: 2,
        total: 0.02,
        atLeast: 0.02,
        segments: [
          { label: '暴击', attrs: ['暴击'], size: 1, p: 0.019 },
          { label: '暴伤', attrs: ['暴伤'], size: 1, p: 0.001 },
        ],
      },
    ];
    const svg = renderQualityStacked({ bars: mixed, tooltip: makeTooltip() });
    expect([...svg.querySelectorAll('text.bar-label')].map((n) => n.textContent)).toEqual([
      '50.0%',
      '2.0%',
    ]);
    // 段内文字仍然是「放得下才画」：0.019 那一段高约 13px，写不下名字 + 概率两行
    expect([...svg.querySelectorAll('text.seg-label')].map((n) => n.textContent)).toEqual([
      '无有效词条',
    ]);
    // 小柱子的柱顶值（2.0%）与它自己的累计刻度（也是 2.0%）几乎贴在一起 → 刻度让路
    expect([...svg.querySelectorAll('text.cum-label')].map((n) => n.textContent)).toEqual(['100.0%']);
  });

  it('柱子密到标号摆不开时才不标柱顶值（横向放不下是唯一的例外）', () => {
    const flat = (n: number): Bars =>
      Array.from({ length: n }, (_, i) => ({
        score: i,
        total: 1 / n,
        atLeast: 1 - i / n,
        segments: [{ label: '暴击', attrs: ['暴击'], size: 1, p: 1 / n }],
      }));
    // 30 根：柱宽约 30px，「3.3%」这五个字符摆得开
    expect(
      renderQualityStacked({ bars: flat(30), tooltip: makeTooltip() }).querySelectorAll(
        'text.bar-label',
      ),
    ).toHaveLength(30);
    // 60 根：柱宽约 15px，标号会互相压字，只好整张图都不标
    expect(
      renderQualityStacked({ bars: flat(60), tooltip: makeTooltip() }).querySelectorAll(
        'text.bar-label',
      ),
    ).toHaveLength(0);
  });

  it('段内标注：名字放得下就画（长名字折成两行），概率跟在后面', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    const names = [...svg.querySelectorAll('text.seg-label')].map((n) => n.textContent);
    expect(names).toContain('暴击');
    expect(names).toContain('暴击+精通');
    // 4 条词条的名字在柱宽里一行写不下 → 折成两行，不是一个长名字也不是不画
    expect(names).not.toContain('暴击+精通+大攻击+暴伤');
    expect(names).toContain('大攻击+暴伤');
    // 6 个段画得下标注；折行的那一个占两行名字，概率仍然每段一行
    expect(names).toHaveLength(7);
    expect(svg.querySelectorAll('text.seg-pct')).toHaveLength(6);
  });

  it('每根柱子一块热区 + 一条竖线（悬停交互）', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    expect(svg.querySelectorAll('rect.hot-rect')).toHaveLength(4);
    expect(svg.querySelector('line.guide')).not.toBeNull();
  });

  it('悬停给出该分数的组合明细 + 累计概率，且不重复合计', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const tooltip = new Tooltip(host);
    host.append(renderQualityStacked({ bars, tooltip }));
    host
      .querySelectorAll('rect.hot-rect')[1]!
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    const tt = host.querySelector('.tooltip')!;
    expect(tt.querySelector('.tt-title')!.textContent).toBe('3 分');
    const badge = tt.querySelector('.tt-badge')!.textContent!;
    expect(badge).toBe('50.00%');
    const rows = [...tt.querySelectorAll('.tt-row')].map((r) => r.textContent);
    expect(rows.some((t) => t!.includes('暴击 + 精通'))).toBe(true);
    // 累计概率在图上只是一条线，读不出数值 → 浮框里给出来（作者要求）
    expect(rows.some((t) => t!.includes('累计概率 ≥ 该分数') && t!.includes('85.00%'))).toBe(true);
    // 它与上面几行不是一个类别（那条线读右轴）→ 单独一行并拉一道分隔线（作者要求）
    expect(tt.querySelector('.tt-row.tt-row-sep')!.textContent).toContain('累计概率');

    // 作者点名：「本分数合计」与右上角的 badge 是同一个数，不许再出现
    expect(tt.textContent).not.toContain('本分数合计');
    // 同一个数在浮框里只出现一次
    expect(occurrences(tt.textContent!, badge)).toBe(1);
  });

  it('关掉累计概率时，浮框里也不给那一行', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const tooltip = new Tooltip(host);
    host.append(renderQualityStacked({ bars, tooltip, showCum: false }));
    host
      .querySelectorAll('rect.hot-rect')[1]!
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(host.querySelector('.tooltip')!.textContent).not.toContain('累计概率');
  });

  it('勾选的词条：命中的段换成暖橙，其余压暗（不再描黑边）', () => {
    const svg = renderQualityStacked({ bars, highlight: ['暴击'], tooltip: makeTooltip() });
    const hits = svg.querySelectorAll('rect.bar-seg.seg-hit');
    const dim = svg.querySelectorAll('rect.bar-seg.seg-dim');
    expect(hits.length).toBeGreaterThan(0);
    expect(dim.length).toBeGreaterThan(0);
    expect(hits.length + dim.length).toBe(svg.querySelectorAll('rect.bar-seg').length);
    // 含暴击的段：第 2 根柱子 3 段 + 第 3 根柱子那一段（4 条全齐）
    expect(hits.length).toBe(4);
    // 命中段不再描边（作者：「不要用黑边框，太丑」）—— 颜色由 CSS 的
    // `.bar-seg.seg-hit { fill: var(--hit-fill) }` 换成暖橙，这里只能验到类名，
    // 真正的观感在浏览器截图里看过（temp/probe-q/）。
    for (const r of hits) expect(r.getAttribute('stroke')).toBeNull();
  });

  it('命中段的浮框色块用同一个暖橙（与图上那段颜色对得上）', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const tooltip = new Tooltip(host);
    host.append(renderQualityStacked({ bars, highlight: ['暴击'], tooltip }));
    host
      .querySelectorAll('rect.hot-rect')[1]!
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const dots = [...host.querySelectorAll<HTMLElement>('.tt-dot')].map((d) => d.style.background);
    // 三行命中段（暴击、暴击+精通、暴击+精通+大攻击）+ 一行累计概率，各带一个色块
    expect(dots).toHaveLength(4);
    for (const c of dots.slice(0, 3)) expect(c).toBe('var(--hit-fill)');
  });

  it('段色由浅到深、字色跟着翻（深段白字、浅段深字），且不落在色标两端', () => {
    const n = 5;
    const colors = [0, 1, 2, 3, 4].map((k) => segmentColor(k, n));
    // 同一列里由下到上越来越深
    for (let i = 1; i < colors.length; i++) {
      expect(luminance(colors[i]!)).toBeLessThan(luminance(colors[i - 1]!));
    }
    // 浅段深字、最深的一段白字
    expect(inkOn(colors[0]!)).toBe('#26303d');
    expect(inkOn(colors[4]!)).toBe('#ffffff');
    // 取色位置是 (k+1)/(n+1)：单段的一列取正中那档，不会淡成一片白、也不会黑成一块
    const single = segmentColor(0, 1);
    expect(luminance(single)).toBeLessThan(luminance(BLUE_RAMP[0]!));
    expect(luminance(single)).toBeGreaterThan(luminance(BLUE_RAMP[BLUE_RAMP.length - 1]!));
  });

  it('命中段的段内文字写深字（暖橙底上白字看不清）', () => {
    // 勾「暴伤」：第 2 根柱子的三段都不含暴伤（非命中），最深那一段要写白字
    const svg = renderQualityStacked({ bars, highlight: ['暴伤'], tooltip: makeTooltip() });
    const labels = [...svg.querySelectorAll('text.seg-label')];
    expect(labels.some((t) => t.classList.contains('on-dark'))).toBe(true);
    for (const t of labels) {
      if (t.textContent?.includes('暴伤')) expect(t.classList.contains('on-dark')).toBe(false);
    }
  });

  it('勾两个词条 = 同时含这两条才算命中（与参考实现的 issubset 一致）', () => {
    const svg = renderQualityStacked({ bars, highlight: ['暴击', '精通'], tooltip: makeTooltip() });
    // 暴击+精通、暴击+精通+大攻击、暴击+精通+大攻击+暴伤
    expect(svg.querySelectorAll('rect.bar-seg.seg-hit')).toHaveLength(3);
  });

  it('不勾选时不高亮也不压暗', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    expect(svg.querySelectorAll('.seg-hit, .seg-dim')).toHaveLength(0);
  });

  it('勾选词的合计画在**绘图区内**的右上角（照归档参考实现的图例位置）', () => {
    const svg = renderQualityStacked({
      bars,
      highlight: ['暴击'],
      pickNote: { label: '含 暴击', value: '12.34%' },
      tooltip: makeTooltip(),
    });
    const value = svg.querySelector('text.pick-value')!;
    expect(value.textContent).toBe('12.34%');
    expect(svg.querySelector('text.pick-label')!.textContent).toBe('含 暴击');
    expect(svg.querySelector('rect.pick-swatch')).not.toBeNull();

    const box = svg.querySelector('rect.pick-box')!;
    const height = Number(svg.getAttribute('viewBox')!.split(' ')[3]);
    const plotW = Number(svg.getAttribute('viewBox')!.split(' ')[2]) - 56 - 72;
    const plotH = height - 40 - 58;
    const x = Number(box.getAttribute('x'));
    const y = Number(box.getAttribute('y'));
    // 整框在绘图区**里面**（作者：「放在图片内的右上角，而不是图片外」）
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + Number(box.getAttribute('width'))).toBeLessThanOrEqual(plotW);
    expect(y + Number(box.getAttribute('height'))).toBeLessThanOrEqual(plotH);
    // 而且贴着右上角：右边留白 ≤ 10px，上边留白 ≤ 10px
    expect(plotW - (x + Number(box.getAttribute('width')))).toBeLessThanOrEqual(10);
    expect(y).toBeLessThanOrEqual(10);
    // 右轴的累计刻度都在绘图区外面 → 这个位置不会压到它们
    for (const t of svg.querySelectorAll('text.cum-label')) {
      expect(Number(t.getAttribute('x'))).toBeGreaterThan(plotW);
    }
  });

  it('不勾选就不画角标（没有「合计」可标）', () => {
    const svg = renderQualityStacked({ bars, tooltip: makeTooltip() });
    expect(svg.querySelector('text.pick-value')).toBeNull();
    expect(svg.querySelector('text.pick-label')).toBeNull();
  });

  it('空数据不抛错', () => {
    const svg = renderQualityStacked({ bars: [], tooltip: makeTooltip() });
    expect(svg.querySelectorAll('rect.bar-seg')).toHaveLength(0);
  });
});

describe('分类色盘（质量分布的段 + 组合概率的扇区）', () => {
  /** sRGB 相对亮度，用来挡住「又一版拉满对比」 */
  function luminance(hex: string): number {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = v.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  }

  it('全是浅色（亮度 ≥ 0.35）—— 作者退回过「对比拉满拉到爆」那一版', () => {
    // 旧版是高饱和深色（`#2563eb` 亮度 0.15、`#dc2626` 0.17），全在这条线以下
    for (const c of CATEGORICAL_COLORS) {
      expect(luminance(c), `${c} 太深了`).toBeGreaterThan(0.35);
      expect(luminance(c), `${c} 太白，段界会看不出来`).toBeLessThan(0.75);
    }
  });

  it('相邻两项换色相，一个柱子里的前 4 段互不相同', () => {
    const head = CATEGORICAL_COLORS.slice(0, 4);
    expect(new Set(head).size).toBe(4);
    for (let i = 1; i < CATEGORICAL_COLORS.length; i++) {
      expect(CATEGORICAL_COLORS[i]).not.toBe(CATEGORICAL_COLORS[i - 1]);
    }
  });
});

describe('组合名的宽度估算与折行', () => {
  it('汉字算全宽、`+` 与数字算 0.55 宽（旧版把它们等宽，白占位置）', () => {
    expect(textWidth('暴击')).toBeCloseTo(19, 6);
    expect(textWidth('+')).toBeCloseTo(5.225, 6);
    expect(textWidth('暴击+暴伤')).toBeCloseTo(43.225, 6);
  });

  it('放得下就一行，放不下只在 `+` 处折成两行', () => {
    expect(wrapCombo('暴击 + 暴伤', 100)).toEqual(['暴击+暴伤']);
    // 「暴击+精通」43.2、「大攻击+暴伤」52.7：柱宽 55 只放得下这一种折法
    expect(wrapCombo('暴击 + 精通 + 大攻击 + 暴伤', 55)).toEqual(['暴击+精通', '大攻击+暴伤']);
    // 折两行还是放不下（词条名太长）→ 交给浮框
    expect(wrapCombo('大攻击 + 暴击 + 暴伤 + 精通', 20)).toBeNull();
  });
});

describe('热力图（主词条 × 副词条）', () => {
  const rows = substatHeatmap();
  const cols = SUB_ATTRS;

  function cell(svg: SVGSVGElement, row: string, col: string): SVGRectElement {
    return svg.querySelector<SVGRectElement>(`rect.hm-cell[data-row="${row}"][data-col="${col}"]`)!;
  }

  it('每格一个矩形 + 一个数值；主词条自己那一格画成空格子', () => {
    const svg = renderHeatmap({ rows, cols, tooltip: makeTooltip() });
    // 有值的格子 + 空格子 = 全部格子
    expect(svg.querySelectorAll('rect.hm-cell')).toHaveLength(rows.length * cols.length);
    const holes = svg.querySelectorAll('rect.hm-cell.hm-hole');
    // 9 行是副词条池里的词条（各自少一格）；「其他」一行每格都有概率
    expect(holes).toHaveLength(9);
    // 每一格写的就是 core 算出来的那个数（2 位小数）
    for (const row of rows) {
      for (const col of cols) {
        const value = svg.querySelector(`text.hm-value[data-row="${row.key}"][data-col="${col}"]`)!;
        const p = row.probs.find((d) => d.attr === col)?.p ?? 0;
        expect(value.textContent, `${row.key} → ${col}`).toBe(
          p > 0 ? `${(p * 100).toFixed(2)}%` : '—',
        );
      }
    }
    // 空格子里是破折号，不是 0.00%（注意别用 `not.toContain('0.00%')` 判：
    // `10.00%` 里就含这个子串，上面按格逐条比对才是准的）
    expect([...svg.querySelectorAll('text.hm-empty')].map((t) => t.textContent)).toEqual(
      Array(9).fill('—'),
    );
  });

  it('行名与列名都画出来，当前主词条那一行被挑出来（行名上色 + 描一圈）', () => {
    const svg = renderHeatmap({ rows, cols, highlightRow: '暴伤', tooltip: makeTooltip() });
    expect([...svg.querySelectorAll('text.hm-row-label')].map((t) => t.textContent)).toEqual(
      rows.map((r) => r.label),
    );
    expect([...svg.querySelectorAll('text.hm-col-label')].map((t) => t.textContent)).toEqual([
      ...cols,
    ]);
    const on = svg.querySelectorAll('text.hm-row-label.on');
    expect(on).toHaveLength(1);
    expect(on[0]!.textContent).toBe('暴伤');
    expect(svg.querySelector('rect.hm-row-box')).not.toBeNull();
    // 不给 highlightRow 就不画框
    expect(
      renderHeatmap({ rows, cols, tooltip: makeTooltip() }).querySelector('rect.hm-row-box'),
    ).toBeNull();
  });

  it('悬停某格：浮框给出「再下一条」的横排柱，且写明口径', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const tooltip = new Tooltip(host);
    host.append(
      renderHeatmap({
        rows,
        cols,
        nextBars: (row, col) => {
          const next = nextSubstatDist(row.key as SubAttr, [col as SubAttr]);
          const peak = Math.max(...next.map((d) => d.p));
          return next.map((d) => ({
            label: d.attr,
            fraction: d.p / peak,
            value: `${(d.p * 100).toFixed(2)}%`,
          }));
        },
        nextCaption: '再下一条的概率',
        tooltip,
      }),
    );
    cell(host.querySelector('svg')!, '大攻击', '暴击').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true }),
    );

    const tt = host.querySelector('.tooltip')!;
    expect(tt.querySelector('.tt-title')!.textContent).toBe('大攻击 主词条 · 下一条 暴击');
    expect(tt.querySelector('.tt-badge')!.textContent).toBe('7.50%');
    expect(tt.querySelector('.tt-chart-cap')!.textContent).toBe('再下一条的概率');
    const bars = [...tt.querySelectorAll('.tt-bar')].map((b) => b.textContent);
    // 暴击已经抽走 → 它不在下一组里；暴伤因为分母小了，比重反而变大
    expect(bars.some((t) => t!.startsWith('暴击'))).toBe(false);
    expect(bars.some((t) => t!.startsWith('暴伤'))).toBe(true);
    // 空格子不给浮框（它没有概率可言）
    cell(host.querySelector('svg')!, '暴击', '暴击').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true }),
    );
    expect(host.querySelector('.tt-badge')!.textContent).toBe('7.50%');
  });

  it('色标：随概率单调变深，且两端都不走极端（浅格深字 / 深格白字）', () => {
    // 与「质量分布」的段共用同一条蓝色色标
    expect(heatColor(0)).toBe(BLUE_RAMP[0]);
    expect(heatColor(1)).toBe(BLUE_RAMP[BLUE_RAMP.length - 1]);
    const mid = heatColor(0.5);
    expect(mid).not.toBe(heatColor(0));
    expect(mid).not.toBe(heatColor(1));
    // 中间几档偏浅：一张表里大部分格子落在 t ≈ 0.4~0.7，整张图不能发闷
    expect(luminance(heatColor(0.5))).toBeGreaterThan(0.45);
    expect(luminance(heatColor(0.6))).toBeGreaterThan(0.35);
    // 单调变深（相邻两档可能被 8 位色深抹平，所以取不严格的不等，另外守住两端确实有差）
    for (let t = 0; t < 1; t += 0.1) {
      expect(luminance(heatColor(t))).toBeGreaterThanOrEqual(luminance(heatColor(t + 0.1)));
    }
    expect(luminance(heatColor(0))).toBeGreaterThan(luminance(heatColor(1)) + 0.2);
    // 最浅的一档是浅底深字，最深的一档是深底白字
    expect(inkOf(heatColor(0))).toBe('#26303d');
    expect(inkOf(heatColor(1))).toBe('#ffffff');
    // 越界的 t 不炸
    expect(heatColor(-1)).toBe(heatColor(0));
    expect(heatColor(2)).toBe(heatColor(1));
  });

  it('色标的两端标签都落在画布内（最大值那个曾被右边缘裁掉）', () => {
    const svg = renderHeatmap({ rows, cols, tooltip: makeTooltip() });
    const width = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    const labels = [...svg.querySelectorAll('text.axis-label')];
    expect(labels.map((t) => t.textContent)).toEqual(['0%', '15.8%']);
    const rightMost = Math.max(...labels.map((t) => Number(t.getAttribute('x')))) + 66;
    expect(rightMost + 34).toBeLessThan(width); // 标签本身还有宽度（约 29）
    const bars = [...svg.querySelectorAll('rect.hm-legend')];
    expect(bars.length).toBeGreaterThan(10);
    const barRight = Math.max(...bars.map((b) => Number(b.getAttribute('x')))) + 66;
    expect(barRight).toBeLessThan(width);
  });

  it('每格都带 data-row / data-col（测试与探针靠它定位）', () => {
    const svg = renderHeatmap({ rows, cols, tooltip: makeTooltip() });
    expect(cell(svg, '小生命', '暴击')).not.toBeNull();
    expect(cell(svg, OTHER_MAIN, '精通')).not.toBeNull();
  });

  it('空数据不抛错', () => {
    const svg = renderHeatmap({ rows: [], cols, tooltip: makeTooltip() });
    expect(svg.querySelectorAll('rect.hm-cell')).toHaveLength(0);
  });
});

describe('环形图', () => {
  const items = [
    { label: '暴击 + 暴伤', p: 0.4 },
    { label: '暴伤 + 大攻击', p: 0.3 },
    { label: '暴击 + 精通', p: 0.3 },
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

  it('每块都有图内标注：折线 + 名字，百分比写在圆环里', () => {
    const svg = renderPie({ items, title: 't', tooltip: makeTooltip() });
    expect(svg.querySelectorAll('polyline.pie-leader')).toHaveLength(3);
    expect(svg.querySelectorAll('text.pie-label')).toHaveLength(3);
    const pcts = [...svg.querySelectorAll('text.pie-pct')].map((n) => n.textContent);
    expect(pcts.sort()).toEqual(['30.00%', '30.00%', '40.00%']);
    expect([...svg.querySelectorAll('text.pie-label')].map((n) => n.textContent)).toEqual([
      '暴击 + 暴伤',
      '暴伤 + 大攻击',
      '暴击 + 精通',
    ]);
    // 宽度够的扇区：百分比画在圆环里（半径约 0.8R），不占图外的位置
    const center = 98;
    for (const t of svg.querySelectorAll('text.pie-pct')) {
      const d = Math.hypot(Number(t.getAttribute('x')) - center, Number(t.getAttribute('y')) - 63);
      expect(d).toBeGreaterThan(20);
      expect(d).toBeLessThan(42);
    }
  });

  it('扇区按分类色盘取色：颜色柔和，相邻两块不同色', () => {
    const svg = renderPie({ items, title: 't', tooltip: makeTooltip() });
    const fills = [...svg.querySelectorAll('path.pie-slice')].map((p) => p.getAttribute('fill'));
    expect(fills).toEqual([categoricalColor(0), categoricalColor(1), categoricalColor(2)]);
  });

  it('摘出来的那一块文字用橙色（作者要求高亮最高的一项）', () => {
    const svg = renderPie({
      items: [...items.slice(0, 2), { label: '暴击 + 暴伤 + 精通', p: 0.02, explode: true }],
      title: 't',
      tooltip: makeTooltip(),
    });
    // `data-top` 只挂在那一块的文字上（名字与百分比都算），其余不挂
    const tops = [...svg.querySelectorAll('text[data-top]')];
    expect(tops.length).toBeGreaterThan(0);
    expect(tops.map((n) => n.getAttribute('data-slice'))).toEqual(
      tops.map(() => '2'),
    );
    const explodedIdx = svg.querySelector('path.pie-slice[data-explode="1"]')!.getAttribute('data-slice');
    expect(tops[0]!.getAttribute('data-slice')).toBe(explodedIdx);
    // 颜色在 CSS 里（`--accent-warm`），这里只管标记挂对了位置
    for (const n of tops) expect(n.classList.contains('pie-label') || n.classList.contains('pie-pct')).toBe(true);
  });

  it('起点固定在左上角：第一块从 140° 开始铺', () => {
    const one = renderPie({ items: [{ label: 'a', p: 1 }], title: 't', tooltip: makeTooltip() });
    // 整圆看不出起点，用两块：第一块占四分之一，它的中缝应在 140 + 45 = 185°（正左偏下）
    const two = renderPie({
      items: [
        { label: 'a', p: 0.25 },
        { label: 'b', p: 0.75 },
      ],
      title: 't',
      tooltip: makeTooltip(),
    });
    expect(one.querySelectorAll('path.pie-slice')).toHaveLength(1);
    // 起点在左上：从 140° 铺 90° 的扇区，「a」的首个顶点应落在中心的左上象限
    const first = two.querySelector('path.pie-slice')!.getAttribute('d')!;
    const m = /^M([\d.]+),([\d.]+)/.exec(first)!;
    expect(Number(m[1])).toBeLessThan(98); // 在竖直中线左侧
    expect(Number(m[2])).toBeLessThan(63); // 在水平中线之上
  });

  it('窄到写不下百分比的扇区，把百分比写到图外第二行', () => {
    const svg = renderPie({
      items: [
        { label: '大块', p: 0.98 },
        { label: '大攻击 + 暴击 + 暴伤 + 精通', p: 0.02, explode: true },
      ],
      title: 't',
      tooltip: makeTooltip(),
    });
    // 两块都各有一个百分比文字，只是位置不同：窄的那块在环外（半径 > R）
    const pcts = [...svg.querySelectorAll('text.pie-pct')];
    expect(pcts).toHaveLength(2);
    const radius = (n: Element): number =>
      Math.hypot(Number(n.getAttribute('x')) - 98, Number(n.getAttribute('y')) - 63);
    const outside = pcts.filter((n) => radius(n) > 42);
    expect(outside).toHaveLength(1);
    expect(outside[0]!.textContent).toBe('2.00%');
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
