/**
 * SVG 图表渲染（手写，无第三方图表库）。
 *
 * 三张图各司其职，**纵轴互相独立**——这是刻意的设计：
 *   - `renderScoreBars`  堆叠柱：每个分数下「命中 h 次」的概率构成，纵轴 = 单点概率；
 *   - `renderSurvival`   生存曲线：P(得分 ≥ x)，纵轴 = 0~100%；
 *   - `renderHistogram`  分类柱：每个命中档的总概率。
 *
 * 早期版本把生存曲线叠在堆叠柱上，又用两个不同的比例尺画同一个坐标系，
 * 结果曲线和柱子对不上、还被柱子的上限压缩到看不出形状。拆开就没有这个问题。
 *
 * 交互：所有图共用一个浮框（`Tooltip`），悬停时高亮整列并移动辅助线。
 */

import { pct } from '../ui/format';
import { Tooltip, type TooltipRow } from './tooltip';

const NAMESPACE = 'http://www.w3.org/2000/svg';

/** 命中档配色。索引 = 命中次数，超过则循环取模 */
export const HIT_COLORS = [
  '#94a3b8',
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#ef4444',
];

export function hitColor(h: number): string {
  return HIT_COLORS[h % HIT_COLORS.length]!;
}

/** 生存曲线 / 单序列图的固定色 */
export const SERIES_COLOR = '#2563eb';
export const CDF_COLOR = SERIES_COLOR;

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NAMESPACE, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function text(
  content: string,
  attrs: Record<string, string | number> = {},
): SVGTextElement {
  const node = el('text', attrs);
  node.textContent = content;
  return node;
}

// ---------------------------------------------------------------------------
// 坐标轴工具
// ---------------------------------------------------------------------------

/**
 * 取「整齐」的纵轴上限与刻度间隔。
 * 目标是 4~6 条网格线，且刻度落在 1/2/2.5/5 × 10^n 上。
 */
export function niceAxis(max: number, targetTicks = 4): { max: number; step: number } {
  if (!(max > 0) || !Number.isFinite(max)) return { max: 1, step: 0.25 };
  const rough = max / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = nice * pow;
  const top = Math.ceil(max / step) * step;
  return { max: top, step };
}

/**
 * 取 X 轴要标注的下标：最多 `maxLabels` 个，均匀分布且**必含首尾**。
 * 用「取整步长」而不是旋转 45° 的文字——分数有 200+ 个时旋转标签会糊成一片。
 *
 * 默认 8：柱状图下面还有图例，刻度太密会和柱子抢视线。
 */
export function tickIndices(count: number, maxLabels = 8): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const stride = Math.ceil(count / maxLabels);
  const out: number[] = [];
  for (let i = 0; i < count; i += stride) out.push(i);
  if (out[out.length - 1] !== count - 1) out.push(count - 1);
  return out;
}

// ---------------------------------------------------------------------------
// 尺寸：按容器宽度定高，避免图被"压扁"
// ---------------------------------------------------------------------------

export interface ChartSize {
  width: number;
  height: number;
}

/**
 * 按容器宽度算出一个**不扁**的画布尺寸。
 *
 * 固定 `viewBox` 的图在宽屏上会被横向拉伸——`preserveAspectRatio` 保持的是比例，
 * 但比例本身是错的（1180×400 在 1080px 宽的面板里会变成一条扁带）。
 * 所以按容器实际宽度反推高度，把宽高比控制在期望值附近。
 *
 * 取不到尺寸时（jsdom、未挂载）回落到默认值，测试仍能断言结构。
 */
export function fitSize(
  host: HTMLElement | null | undefined,
  opts: { ratio?: number; minW?: number; maxW?: number; minH?: number; maxH?: number } = {},
): ChartSize {
  const ratio = opts.ratio ?? 0.34; // 高 / 宽
  const minW = opts.minW ?? 720;
  const maxW = opts.maxW ?? 1320;
  const minH = opts.minH ?? 260;
  const maxH = opts.maxH ?? 460;

  const measured = host?.clientWidth ?? 0;
  const width = Math.round(Math.min(maxW, Math.max(minW, measured || 1040)));
  const height = Math.round(Math.min(maxH, Math.max(minH, width * ratio)));
  return { width, height };
}

// ---------------------------------------------------------------------------
// 通用骨架
// ---------------------------------------------------------------------------

interface Frame {
  svg: SVGSVGElement;
  /** 绘图区（已 translate 到左上角） */
  plot: SVGGElement;
  plotW: number;
  plotH: number;
  width: number;
  height: number;
}

function frame(opts: {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  /** `undefined` = 不画图内标题（`exactOptionalPropertyTypes` 下不能传可选属性） */
  title: string | undefined;
  ariaLabel: string;
}): Frame {
  const { width, height, title, ariaLabel } = opts;
  // 没有图内标题时不需要顶部留白（面板标题由外层 HTML 负责，语义更好）
  const margin = { ...opts.margin, top: title ? opts.margin.top : 16 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': ariaLabel,
  });
  if (title) {
    svg.append(
      text(title, { x: margin.left, y: 20, class: 'chart-title', 'text-anchor': 'start' }),
    );
  }
  const plot = el('g', { transform: `translate(${margin.left},${margin.top})` });
  svg.append(plot);
  return { svg, plot, plotW, plotH, width, height };
}

/** 画水平网格线 + 左侧百分比刻度 */
function yAxis(
  f: Frame,
  axis: { max: number; step: number },
  format: (v: number) => string,
): void {
  for (let v = 0; v <= axis.max + 1e-9; v += axis.step) {
    const y = f.plotH - (v / axis.max) * f.plotH;
    f.plot.append(el('line', { x1: 0, x2: f.plotW, y1: y, y2: y, class: 'grid' }));
    f.plot.append(
      text(format(v), { x: -8, y: y + 3.5, 'text-anchor': 'end', class: 'axis-label' }),
    );
  }
}

/** 靠边的标注改用左/右对齐，避免被 viewBox 裁掉 */
function anchorFor(x: number, plotW: number, margin = 48): 'start' | 'middle' | 'end' {
  if (x < margin) return 'start';
  if (x > plotW - margin) return 'end';
  return 'middle';
}

/** 画 X 轴刻度与轴标题 */
function xAxis(
  f: Frame,
  labels: { x: number; text: string }[],
  title: string,
): void {
  f.plot.append(el('line', { x1: 0, x2: f.plotW, y1: f.plotH, y2: f.plotH, class: 'axis-line' }));
  for (const l of labels) {
    f.plot.append(
      text(l.text, { x: l.x, y: f.plotH + 16, 'text-anchor': 'middle', class: 'axis-label' }),
    );
  }
  if (title) {
    f.plot.append(
      text(title, { x: f.plotW / 2, y: f.plotH + 36, 'text-anchor': 'middle', class: 'axis-title' }),
    );
  }
}

/** 在绘图区下方画图例；返回下一行的 y 偏移 */
function legend(
  f: Frame,
  items: { label: string; color: string }[],
  y: number,
  width = f.plotW,
): void {
  const g = el('g', { transform: `translate(0,${y})` });
  let lx = 0;
  let ly = 0;
  for (const it of items) {
    const w = 14 + it.label.length * 12 + 14;
    if (lx > 0 && lx + w > width) {
      lx = 0;
      ly += 18;
    }
    g.append(el('rect', { x: lx, y: ly, width: 10, height: 10, rx: 2, fill: it.color }));
    g.append(text(it.label, { x: lx + 14, y: ly + 9, class: 'legend-label' }));
    lx += w;
  }
  f.plot.append(g);
}

// ---------------------------------------------------------------------------
// 1. 得分分布（堆叠柱）
// ---------------------------------------------------------------------------

export interface StackedDatum {
  /** 轴上的标号（不合并时就是分数本身；合并后是桶的起点） */
  score: number;
  /**
   * 该柱覆盖的分数区间（闭区间）。**只在分桶时有意义**：
   * 合并后一根柱子代表一批分数，浮框里必须写清区间，否则读不出具体范围。
   */
  range?: { min: number; max: number };
  /** 该分数下「命中 h 次」的概率，下标 = 命中次数 */
  byHit: number[];
}

export interface ChartMarker {
  score: number;
  label: string;
}

export interface ScoreChartOptions {
  data: StackedDatum[];
  hitLabels: string[];
  /** 图内标题；省略则不留标题位（面板标题通常由外层 HTML 提供） */
  title?: string;
  /** 若给出，则在该分数处画一条竖向参考线（目标分数） */
  marker?: ChartMarker;
  /** 用来量宽度，好把图画得宽一点而不是被压扁 */
  host?: HTMLElement | null;
  width?: number;
  height?: number;
  tooltip: Tooltip;
}

export function renderScoreBars(opts: ScoreChartOptions): SVGSVGElement {
  const { data, hitLabels, title, marker, tooltip } = opts;
  // 柱状图下面还有图例，所以画布要高一点；图例占掉的高度另外扣
  const fit = fitSize(opts.host, { ratio: 0.46, minH: 380, maxH: 620 });
  const width = opts.width ?? fit.width;
  const height = opts.height ?? fit.height;
  const legendRows = Math.ceil((hitLabels.length * 90) / 900) + 1;
  const f = frame({
    width,
    height,
    margin: { top: 40, right: 18, bottom: 56 + legendRows * 18, left: 52 },
    title,
    ariaLabel: title ?? '得分分布',
  });

  if (data.length === 0) return f.svg;

  const totals = data.map((d) => d.byHit.reduce((s, v) => s + v, 0));
  const axis = niceAxis(Math.max(...totals));
  yAxis(f, axis, (v) => pct(v, 0));

  const bandW = f.plotW / data.length;
  const barW = Math.max(1, Math.min(bandW * 0.74, 30));
  const xOf = (i: number): number => i * bandW + bandW / 2;
  const yOf = (p: number): number => f.plotH - (p / axis.max) * f.plotH;

  // --- 参考线（目标分数）画在柱子下面 ---
  if (marker) {
    const i = nearestIndex(data.map((d) => d.score), marker.score);
    if (i >= 0) {
      const x = xOf(i);
      f.plot.append(el('line', { x1: x, x2: x, y1: 0, y2: f.plotH, class: 'marker-line' }));
      f.plot.append(
        text(marker.label, {
          x,
          y: -8,
          'text-anchor': anchorFor(x, f.plotW),
          class: 'marker-label',
        }),
      );
    }
  }

  // --- 堆叠柱 ---
  data.forEach((d, i) => {
    let bottom = 0;
    d.byHit.forEach((p, h) => {
      if (p <= 0) return;
      const y0 = yOf(bottom + p);
      const h0 = yOf(bottom) - y0;
      f.plot.append(
        el('rect', {
          x: xOf(i) - barW / 2,
          y: y0,
          width: barW,
          height: Math.max(h0, 0.5),
          fill: hitColor(h),
          class: 'bar-seg',
        }),
      );
      bottom += p;
    });
  });

  // --- 柱上标注：只在柱子够宽、且不密集时画 ---
  const showLabels = bandW >= 26;
  if (showLabels) {
    data.forEach((d, i) => {
      const total = totals[i]!;
      if (total < axis.max * 0.08) return;
      f.plot.append(
        text(pct(total, 1), {
          x: xOf(i),
          y: yOf(total) - 5,
          'text-anchor': 'middle',
          class: 'bar-label',
        }),
      );
    });
  }

  xAxis(
    f,
    tickIndices(data.length).map((i) => ({ x: xOf(i), text: data[i]!.score.toFixed(1) })),
    '胚子得分（分）',
  );
  legend(
    f,
    hitLabels.map((label, h) => ({ label, color: hitColor(h) })),
    f.plotH + 48,
  );

  // --- 悬停层放在最后（绘制顺序 = z 序）：
  //     每列一块透明热区，比逐个柱段监听省事，也不会在柱段之间留缝漏掉指针。
  //     辅助线与概率角标也画在最上层，否则会被柱子盖住。
  const guide = el('line', { class: 'guide', y1: 0, y2: f.plotH, x1: -99, x2: -99 });
  f.plot.append(guide);


  data.forEach((d, i) => {
    const x = xOf(i);
    const hit = el('rect', {
      x: x - bandW / 2,
      y: 0,
      width: Math.max(bandW, 2),
      height: f.plotH,
      fill: 'transparent',
      class: 'hot-rect',
    });
    hit.addEventListener('mouseenter', () => {
      guide.setAttribute('x1', String(x));
      guide.setAttribute('x2', String(x));
      guide.classList.add('on');
      // 浮框锚在**柱顶**（与竖线同一位置）：竖线、浮框、数据点必须是一套坐标。
      // 概率写在浮框标题行的右上角（badge），不再另设图内角标。
      tooltip.showAt(
        f.svg,
        x,
        yOf(totals[i]!),
        scoreTooltip(d, totals[i]!, hitLabels, i, data.length),
      );
    });
    hit.addEventListener('mouseleave', () => {
      guide.classList.remove('on');
      tooltip.hide();
    });
    f.plot.append(hit);
  });

  return f.svg;
}

function scoreTooltip(
  d: StackedDatum,
  total: number,
  hitLabels: string[],
  i: number,
  count: number,
): { title: string; badge: string; rows: TooltipRow[]; footer?: string } {
  // 只有一根柱子时不必说「占本柱的 100%」——那是废话
  const only = d.byHit.filter((p) => p > 0).length === 1;
  const rows: TooltipRow[] = [];
  for (let h = d.byHit.length - 1; h >= 0; h--) {
    const p = d.byHit[h]!;
    if (p <= 0) continue;
    const share = total > 0 ? p / total : 0;
    rows.push({
      label: hitLabels[h] ?? `命中 ${h} 次`,
      value: only ? pct(p) : `${pct(p)}（占本柱 ${pct(share, 1)}）`,
      color: hitColor(h),
    });
  }

  const bucketed = d.range !== undefined && d.range.min !== d.range.max;
  return {
    title: bucketed ? bucketRangeLabel(d) : `${d.score.toFixed(1)} 分`,
    badge: pct(total),
    rows,
    // 概率已经标在柱子右上角了，这里不再重复；脚注只留给「第几根」
    footer: bucketed
      ? `第 ${i + 1} / ${count} 根柱子（每根合并若干分数）`
      : `第 ${i + 1} / ${count} 个可能分数`,
  };
}

/**
 * 分桶柱的区间写法，用数学区间：`[10.0, 11.0)`。
 *
 * **左闭右开**，否则读的人不知道边界分数算在哪一根柱子上。
 * 桶宽按「起点 + 分桶宽度」算的是**名义**区间；桶里最后一个分数如果不到名义上界，
 * 也在括号里标出来，免得把 `[10.0, 10.8)` 读成「到 10.9 都有」。
 */
function bucketRangeLabel(d: StackedDatum): string {
  const min = d.range!.min;
  const max = d.range!.max;
  const hi = Math.round((max + 0.1) * 10) / 10;
  return `[${min.toFixed(1)}, ${hi.toFixed(1)})`;
}

// ---------------------------------------------------------------------------
// 2. 生存曲线：P(得分 ≥ x)
// ---------------------------------------------------------------------------

export interface SurvivalChartOptions {
  /** 与 `data` 一一对应的分数（升序） */
  scores: number[];
  /** P(得分 ≥ scores[i]) */
  survival: number[];
  title?: string;
  marker?: ChartMarker;
  host?: HTMLElement | null;
  width?: number;
  height?: number;
  tooltip: Tooltip;
}

export function renderSurvival(opts: SurvivalChartOptions): SVGSVGElement {
  const { scores, survival, title, marker, tooltip } = opts;
  const fit = fitSize(opts.host, { ratio: 0.34, minH: 280, maxH: 460 });
  const width = opts.width ?? fit.width;
  const height = opts.height ?? fit.height;
  const f = frame({
    width,
    height,
    margin: { top: 40, right: 18, bottom: 56, left: 52 },
    title,
    ariaLabel: title ?? 'P(得分 ≥ 分数线)',
  });

  if (scores.length === 0) return f.svg;

  // 纵轴固定 0~100%：概率本身就是这个量纲，不需要自适应
  const axis = { max: 1, step: 0.25 };
  yAxis(f, axis, (v) => pct(v, 0));

  const bandW = f.plotW / scores.length;
  const xOf = (i: number): number => (i + 0.5) * bandW;
  const yOf = (p: number): number => f.plotH - (p / axis.max) * f.plotH;

  const line = scores
    .map((_, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(2)},${yOf(survival[i]!).toFixed(2)}`)
    .join(' ');
  const area = `${line} L${xOf(scores.length - 1).toFixed(2)},${f.plotH} L${xOf(0).toFixed(2)},${f.plotH} Z`;
  f.plot.append(el('path', { d: area, class: 'series-area' }));
  f.plot.append(el('path', { d: line, class: 'series-line' }));

  if (marker) {
    const i = nearestIndex(scores, marker.score);
    if (i >= 0) {
      const x = xOf(i);
      f.plot.append(el('line', { x1: x, x2: x, y1: 0, y2: f.plotH, class: 'marker-line' }));
      f.plot.append(
        text(marker.label, {
          x,
          y: -8,
          'text-anchor': anchorFor(x, f.plotW),
          class: 'marker-label',
        }),
      );
    }
  }

  xAxis(
    f,
    tickIndices(scores.length).map((i) => ({ x: xOf(i), text: scores[i]!.toFixed(1) })),
    '分数线（分）',
  );

  // --- 悬停：垂直线 + 高亮点 + 浮框 ---
  // 透明捕获层要在曲线**之后**追加，才能盖在填充区上面接住指针事件。
  const overlay = el('rect', {
    x: 0,
    y: 0,
    width: f.plotW,
    height: f.plotH,
    fill: 'transparent',
    class: 'hot-rect',
  });
  f.plot.append(overlay);

  const guide = el('line', { class: 'guide', y1: 0, y2: f.plotH, x1: -99, x2: -99 });
  const dot = el('circle', { class: 'hover-dot', r: 4.5, cx: -99, cy: -99 });
  f.plot.append(guide, dot);

  const localPoint = plotLocalPoint(f.plot);
  const pick = (ev: MouseEvent): number => {
    const p = localPoint?.(ev.clientX, ev.clientY);
    if (!p) {
      // 退不到几何量算时（未挂载 / jsdom），用事件在组内的偏移比例兜底
      const box = f.plot.getBoundingClientRect();
      const ratio = box.width > 0 ? (ev.clientX - box.left) / box.width : 0;
      return Math.max(0, Math.min(scores.length - 1, Math.floor(ratio * scores.length)));
    }
    const i = Math.floor(p.x / bandW);
    return Math.max(0, Math.min(scores.length - 1, i));
  };

  let shown = -1;
  const paint = (i: number): void => {
    if (i === shown) return;
    shown = i;
    const x = xOf(i);
    const y = yOf(survival[i]!);
    guide.setAttribute('x1', String(x));
    guide.setAttribute('x2', String(x));
    guide.classList.add('on');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.classList.add('on');
    // 浮框锚在**曲线上的那个点**，和竖线、高亮点是同一个位置
    tooltip.showAt(
      f.svg,
      x,
      y,
      {
        title: `${scores[i]!.toFixed(1)} 分及以上`,
        subtitle: `P(得分 ≥ ${scores[i]!.toFixed(1)})`,
        rows: [
          { label: '概率', value: pct(survival[i]!, 2), color: SERIES_COLOR },
          {
            label: '大约多少个胚子',
            value: survival[i]! > 0 ? `1 / p ≈ ${formatCount(1 / survival[i]!)}` : '不可能',
          },
        ],
        footer: '曲线越靠右越低，说明高分越稀有',
      },
      // 锚点靠右时把浮框翻到左边，免得跑出图表
      x > f.plotW * 0.6 ? 'left' : 'right',
    );
  };

  overlay.addEventListener('mouseenter', (ev) => paint(pick(ev)));
  overlay.addEventListener('mousemove', (ev) => paint(pick(ev)));
  overlay.addEventListener('mouseleave', () => {
    shown = -1;
    guide.classList.remove('on');
    dot.classList.remove('on');
    tooltip.hide();
  });

  return f.svg;
}

/** 粗略的「多少个」文案，避免长串数字 */
function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿个`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万个`;
  if (n >= 10) return `${Math.round(n)} 个`;
  return `${n.toFixed(1)} 个`;
}

// ---------------------------------------------------------------------------
// 3. 分类柱状图（命中次数分布）
// ---------------------------------------------------------------------------

export interface HistogramItem {
  label: string;
  value: number;
  color?: string;
  /** 悬停时补充说明；给 `undefined` 等价于不给 */
  note?: string | undefined;
}

export interface HistogramOptions {
  items: HistogramItem[];
  title?: string;
  /** 数值格式化，默认百分比 */
  format?: (v: number) => string;
  /** 纵轴上限；省略则自适应 */
  upper?: number;
  host?: HTMLElement | null;
  width?: number;
  height?: number;
  tooltip: Tooltip;
}

export function renderHistogram(opts: HistogramOptions): SVGSVGElement {
  const { items, title, tooltip } = opts;
  const format = opts.format ?? ((v: number) => pct(v, 2));
  const fit = fitSize(opts.host, { ratio: 0.30, minH: 260, maxH: 420 });
  const width = opts.width ?? fit.width;
  const height = opts.height ?? fit.height;
  const f = frame({
    width,
    height,
    margin: { top: 40, right: 18, bottom: 48, left: 52 },
    title,
    ariaLabel: title ?? '分布',
  });

  if (items.length === 0) return f.svg;

  const max = opts.upper ?? Math.max(...items.map((d) => d.value)) * 1.08;
  const axis = niceAxis(max, 4);
  yAxis(f, axis, (v) => (opts.format ? format(v) : pct(v, 0)));

  const bandW = f.plotW / items.length;
  const barW = Math.max(2, Math.min(bandW * 0.62, 76));
  const xOf = (i: number): number => (i + 0.5) * bandW;
  const yOf = (v: number): number => f.plotH - (v / axis.max) * f.plotH;

  items.forEach((d, i) => {
    const y = yOf(d.value);
    f.plot.append(
      el('rect', {
        x: xOf(i) - barW / 2,
        y,
        width: barW,
        height: Math.max(f.plotH - y, 0.5),
        fill: d.color ?? hitColor(i),
        rx: 3,
        class: 'bar-seg',
      }),
    );
    f.plot.append(
      text(format(d.value), {
        x: xOf(i),
        y: Math.max(y - 6, 10),
        'text-anchor': 'middle',
        class: 'bar-label',
      }),
    );
  });

  xAxis(f, items.map((d, i) => ({ x: xOf(i), text: d.label })), '');

  const guide = el('line', { class: 'guide', y1: 0, y2: f.plotH, x1: -99, x2: -99 });
  f.plot.append(guide);

  items.forEach((d, i) => {
    const x = xOf(i);
    const hit = el('rect', {
      x: x - bandW / 2,
      y: 0,
      width: Math.max(bandW, 2),
      height: f.plotH,
      fill: 'transparent',
      class: 'hot-rect',
    });
    hit.addEventListener('mouseenter', () => {
      guide.setAttribute('x1', String(x));
      guide.setAttribute('x2', String(x));
      guide.classList.add('on');
      // 浮框锚在**柱顶**，和竖线一致
      tooltip.showAt(
        f.svg,
        x,
        yOf(d.value),
        {
          title: d.label,
          rows: [
            { label: '概率', value: format(d.value), color: d.color ?? hitColor(i) },
            ...(d.note ? [{ label: '说明', value: d.note }] : []),
          ],
        },
        'right',
      );
    });
    hit.addEventListener('mouseleave', () => {
      guide.classList.remove('on');
      tooltip.hide();
    });
    f.plot.append(hit);
  });

  return f.svg;
}

// ---------------------------------------------------------------------------

/**
 * 把鼠标的视口坐标换算成**绘图区局部坐标**。
 *
 * **必须用 `getScreenCTM()` 的逆矩阵**，不能自己算 `svgBox.width / viewBox.width`：
 * `svg.chart { width: 100% }` 会把 viewBox 横向拉伸到容器宽度（横竖比例不同），
 * 用「平均缩放比」在右侧会越走越偏。
 *
 * 曾经就是这么错的：viewBox 898 宽、绘图区实际 934px，于是光标放到最右时
 * 命中的是第 86 根柱子而不是第 84 根，**屏幕上差一百多像素**。
 * 逆矩阵是浏览器命中测试用的同一套变换，天然对齐，也顺带处理了 `viewBox` 偏移。
 *
 * 取不到 CTM（jsdom、未挂载）时返回 `null`，调用方自己退化。
 */
function plotLocalPoint(
  plot: SVGGElement,
): ((clientX: number, clientY: number) => { x: number; y: number } | null) | null {
  const svg = plot.ownerSVGElement;
  if (!svg) return null;
  return (clientX: number, clientY: number) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    // p 是「绘图区局部坐标」：CTM 里已含 `<g transform="translate(left, top)">`
    return { x: p.x, y: p.y };
  };
}

/** 在升序数组里找最接近 `value` 的下标；空数组返回 -1 */
export function nearestIndex(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return -1;
  let best = 0;
  let bestDiff = Math.abs(sorted[0]! - value);
  for (let i = 1; i < sorted.length; i++) {
    const diff = Math.abs(sorted[i]! - value);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  }
  return best;
}
