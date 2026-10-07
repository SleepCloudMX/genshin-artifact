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

import type { SubAttr } from '../core/stats';
import { pct, pctTick } from '../ui/format';
import { Tooltip, type TooltipBar, type TooltipRow } from './tooltip';

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

/**
 * 柱顶数值（`.bar-label`）的字号。
 *
 * 写在这里是因为**两处判据要用它**：「标不标得下」按 `textWidth(标签, 这个字号)` 量，
 * 而 CSS 里 `.bar-label` 的 font-size 必须与它一致 —— 改一处就要改另一处。
 * 作者 2026-10-07：「横轴标注的属性太浅/太小，改明显一点；标注的概率同理。」
 */
export const BAR_LABEL_SIZE = 11;

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
 * 纵轴上限**贴着最高的柱子**（只留一点余量放柱顶标注），刻度仍取整齐步长。
 *
 * 与 `niceAxis` 的区别在「上限」：`niceAxis` 把上限抬到步长的整数倍，
 * 最高 31.97% 的柱子会得到一个 40% 的轴 —— 上面空出一大截，柱子被压矮，
 * 作者的原话是「你为什么要固定最高 40%？按最高的柱子来，比它稍高一点就行」。
 * 这里改成 `峰值 × 余量`，刻度线只画到不超过上限的那些，
 * 于是最上面一条网格线可能略低于图顶（正常的画法），标签仍是整齐的整百分数。
 */
export function tightAxis(
  peak: number,
  headroom = 1.06,
  targetTicks = 4,
): { max: number; step: number } {
  if (!(peak > 0) || !Number.isFinite(peak)) return { max: 1, step: 0.25 };
  const max = peak * headroom;
  return { max, step: niceAxis(max, targetTicks).step };
}

/**
 * 取 X 轴要标注的下标：最多 `maxLabels` 个，均匀分布且**必含首尾**。
 * 用「均分的刻度」而不是旋转 45° 的文字——分数有 200+ 个时旋转标签会糊成一片。
 *
 * 首尾各占一个名额、中间按 `(count - 1) / (maxLabels - 1)` 均分：
 * 旧写法是「从 0 按取整步长铺，最后再补一格末尾」，补出来的那一格常常紧贴着
 * 前一个刻度，两条轴标就叠在一起（66 根柱子时出现过 `52.854.4`）。
 * 这种写法天然不会多出刻度，也不需要事后去重。
 *
 * 默认 8：柱状图下面还有图例，刻度太密会和柱子抢视线。
 */
export function tickIndices(count: number, maxLabels = 8): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (maxLabels - 1);
  const out: number[] = [];
  for (let i = 0; i < maxLabels; i++) out.push(Math.round(i * step));
  // 抹掉 round 累积的偏差：末尾必须正好是最后一根
  out[out.length - 1] = count - 1;
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

/**
 * 「概率分布」与「达到概率」共用的画布尺寸。
 *
 * 两张图是同一个位置上互相切换的**兄弟视图**，尺寸必须一样：
 * 一个 876×403、另一个 876×298，切过去会有「图的宽窄变了」的错觉
 * —— 宽度其实一直是容器宽，差的是高度，但看上去就是不齐。
 * 图内的留白仍由各自的 margin 决定（柱状图下面还有图例）。
 */
const SHARED_FIT = { ratio: 0.46, minH: 380, maxH: 620 } as const;

// ---------------------------------------------------------------------------
// 通用骨架
// ---------------------------------------------------------------------------

interface Frame {
  svg: SVGSVGElement;
  /** 绘图区（已 translate 到左上角） */
  plot: SVGGElement;
  plotW: number;
  plotH: number;
  /** 绘图区距画布上 / 左的距离（`plot` 的 translate），浮框锚点要加回去 */
  marginTop: number;
  marginLeft: number;
  width: number;
  height: number;
}

function frame(opts: {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  /** `undefined` = 不画图内标题（`exactOptionalPropertyTypes` 下不能传可选属性） */
  title: string | undefined;
  /**
   * 没有图内标题时预留的顶部高度（图内角标用）。
   * 默认 16：不画标题就不留白；要往右上角放东西的图把它调大。
   */
  header?: number;
  /**
   * 标题左边的小色块（一个 CSS 颜色，通常是 `var(--chart-N)`）。
   *
   * 给「这张图的主题色是哪一个」一个看得见的凭据：柱子是同一色时，
   * 标题旁边那块颜色解释了「为什么这几张图颜色不一样」。
   */
  titleChip?: string;
  ariaLabel: string;
}): Frame {
  const { width, height, title, ariaLabel } = opts;
  // 没有图内标题时不需要顶部留白（面板标题由外层 HTML 负责，语义更好）
  const margin = { ...opts.margin, top: title ? opts.margin.top : (opts.header ?? 16) };
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
    // 有小色块就把标题右移给它让位。色块的颜色走**内联样式**（`style.fill`）——
    // `fill="var(--chart-1)"` 这种写法在属性里不解析自定义属性。
    const shift = opts.titleChip ? 16 : 0;
    if (opts.titleChip) {
      const chip = el('rect', { x: margin.left, y: 11, width: 10, height: 10, class: 'chart-title-chip' });
      chip.style.fill = opts.titleChip;
      svg.append(chip);
    }
    svg.append(
      text(title, {
        x: margin.left + shift,
        y: 20,
        class: 'chart-title',
        'text-anchor': 'start',
      }),
    );
  }
  const plot = el('g', { transform: `translate(${margin.left},${margin.top})` });
  svg.append(plot);
  return { svg, plot, plotW, plotH, marginTop: margin.top, marginLeft: margin.left, width, height };
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
  const fit = fitSize(opts.host, SHARED_FIT);
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
  yAxis(f, axis, (v) => pctTick(v, axis.step));

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

  // --- 柱上标注：柱子宽到写得下这个数、且这根柱子不算太小的时候才画 ---
  //     宽度判据用**这一根自己的标签**去量（`.bar-label` 是 11px 等宽字体，
  //     作者 2026-10-07 嫌 9.5px 太浅太小，字号一改这里也得跟着改）
  data.forEach((d, i) => {
    const total = totals[i]!;
    if (total < axis.max * 0.08) return;
    const label = pct(total, 1);
    if (textWidth(label, BAR_LABEL_SIZE) > bandW) return;
    f.plot.append(
      text(label, {
        x: xOf(i),
        y: yOf(total) - 6,
        'text-anchor': 'middle',
        class: 'bar-label',
      }),
    );
  });

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

  // --- 悬停层：**每列一块透明热区，事件挂在热区自己身上**。
  //
  // 这里刻意**不做「光标坐标 → 数据下标」的换算**（见 `plotLocalPoint` 的注释）：
  // 命中的是哪块热区就是哪一列，由浏览器做命中测试，精确且不受 DPR 影响。
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
    hit.addEventListener('mouseenter', (ev) => {
      guide.setAttribute('x1', String(x));
      guide.setAttribute('x2', String(x));
      guide.classList.add('on');
      // 浮框**跟光标**：这是界面上的标准行为，不要改成锚数据点 ——
      // 「交互点与光标不一致」是命中测试的问题（见上面的热区注释），与浮框位置无关。
      tooltip.show(scoreTooltip(d, totals[i]!, hitLabels, i, data.length), ev.clientX, ev.clientY);
    });
    hit.addEventListener('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY));
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
  _i: number,
  _count: number,
): { title: string; badge: string; rows: TooltipRow[] } {
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
  // 标题只交代「这是哪一根」，概率在右上角的 badge 里。
  // **不要**再加「第 N / M 根柱子」这类脚注：竖线已经指出位置了。
  return {
    title: bucketed ? bucketRangeLabel(d) : `${d.score.toFixed(1)} 分`,
    badge: pct(total),
    rows,
  };
}

/**
 * 分桶柱的区间写法，用数学区间：`[10.0, 11.0) 分`。
 *
 * **左闭右开**，否则读的人不知道边界分数算在哪一根柱子上。
 * 桶宽按「起点 + 分桶宽度」算的是**名义**区间；桶里最后一个分数如果不到名义上界，
 * 也在括号里标出来，免得把 `[10.0, 10.8) 分` 读成「到 10.9 都有」。
 * 末尾的「分」不能省：同一行上方还有 `10.0 分` 这种单点写法，单位要一致。
 */
function bucketRangeLabel(d: StackedDatum): string {
  const min = d.range!.min;
  const max = d.range!.max;
  const hi = Math.round((max + 0.1) * 10) / 10;
  return `[${min.toFixed(1)}, ${hi.toFixed(1)}) 分`;
}

// ---------------------------------------------------------------------------
// 2. 生存曲线：P(得分 ≥ x)
// ---------------------------------------------------------------------------

export interface SurvivalChartOptions {
  /** 与 `data` 一一对应的分数（升序） */
  scores: number[];
  /** P(得分 ≥ scores[i]) */
  survival: number[];
  /** 命中档的显示名，下标 = 命中次数（浮框里的条件分布要用） */
  hitLabels?: string[];
  /**
   * 「得分 ≥ scores[i]」时**命中次数的条件分布**（Σ = 1，下标 = 命中次数）。
   *
   * 传函数而不是整张表：一次只需要一个下标的分布，
   * 而且**计算留在 `core/`**（`hitMixAtLeast`），渲染层只负责画。
   */
  hitMix?: (i: number) => number[];
  /** 条件分布那一组条上方的小标题，用来交代口径 */
  hitMixCaption?: string;
  title?: string;
  marker?: ChartMarker;
  host?: HTMLElement | null;
  width?: number;
  height?: number;
  tooltip: Tooltip;
}

export function renderSurvival(opts: SurvivalChartOptions): SVGSVGElement {
  const { scores, survival, hitLabels, hitMix, hitMixCaption, title, marker, tooltip } = opts;
  // 尺寸与「概率分布」那张**完全一致**：两张图是同一个面板位置上的兄弟视图，
  // 一大一小会显得没对齐（曾经是 0.34/280/460，比柱状图矮一截）。
  const fit = fitSize(opts.host, SHARED_FIT);
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
  yAxis(f, axis, (v) => pctTick(v, axis.step));

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
  //
  // **每列一块热区，事件挂在热区自己身上** —— 不做「光标坐标 → 下标」的换算。
  // 之前是一整块覆盖层 + 自己算 `floor(localX / bandW)`，而那个换算在真实浏览器里
  // 有随位置增大的残差（竖线比光标偏 1~4px）。改由浏览器做命中测试就没有这个问题。
  const guide = el('line', { class: 'guide', y1: 0, y2: f.plotH, x1: -99, x2: -99 });
  const dot = el('circle', { class: 'hover-dot', r: 4.5, cx: -99, cy: -99 });
  f.plot.append(guide, dot);

  const paint = (i: number, ev: { clientX: number; clientY: number }): void => {
    const x = xOf(i);
    const y = yOf(survival[i]!);
    guide.setAttribute('x1', String(x));
    guide.setAttribute('x2', String(x));
    guide.classList.add('on');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.classList.add('on');

    // 「≥ 该分数线」的结果里，命中次数怎么分布 —— 条件概率，合计 100%
    const mix = hitMix?.(i);
    const bars = mix ? hitMixBars(mix, hitLabels) : undefined;

    tooltip.show(
      {
        // 标题只说「哪条线」，概率放 badge；**不写副标题**：
        // 图名已经叫 `P(得分 ≥ 分数线)`，再抄一遍公式是废话。
        title: `${scores[i]!.toFixed(1)} 分及以上`,
        badge: pct(survival[i]!, 2),
        rows: [
          {
            label: '大约多少个胚子',
            value: survival[i]! > 0 ? `1 / p ≈ ${formatCount(1 / survival[i]!)}` : '不可能',
          },
        ],
        ...(bars && bars.length > 0
          ? { bars, ...(hitMixCaption ? { barsCaption: hitMixCaption } : {}) }
          : {}),
      },
      ev.clientX,
      ev.clientY,
    );
  };

  scores.forEach((_, i) => {
    const x = xOf(i);
    const col = el('rect', {
      x: x - bandW / 2,
      y: 0,
      width: Math.max(bandW, 2),
      height: f.plotH,
      fill: 'transparent',
      class: 'hot-rect',
    });
    col.addEventListener('mouseenter', (ev) => paint(i, ev));
    col.addEventListener('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY));
    col.addEventListener('mouseleave', () => {
      guide.classList.remove('on');
      dot.classList.remove('on');
      tooltip.hide();
    });
    f.plot.append(col);
  });

  return f.svg;
}

/**
 * 命中次数的条件分布 → 浮框里的横排柱状图。
 *
 * 概率为 0 的档不画（`hitMixAtLeast` 返回的是定长数组，里面会有 0），
 * 顺序按命中次数升序、颜色共用 `hitColor` —— 与「命中次数」子 tab 的柱状图一致，
 * 这样「同一档 = 同一颜色」在整个界面里成立。
 */
function hitMixBars(mix: readonly number[], hitLabels?: string[]): TooltipBar[] {
  const bars: TooltipBar[] = [];
  for (let h = 0; h < mix.length; h++) {
    const p = mix[h]!;
    if (p <= 0) continue;
    bars.push({
      label: hitLabels?.[h] ?? `命中 ${h} 次`,
      fraction: p,
      value: pct(p, 1),
      color: hitColor(h),
    });
  }
  return bars;
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
// 3. 分类柱状图（每个类目一根柱子）
//
// 三处用它：「命中次数」的分布、**各部位的主词条概率**（一部位一张）、
// **副词条权重**（点柱子可以把该词条移出池子）。后两处追加了几个显示 / 交互开关，
// 但图形语言是同一套：柱子 + 柱顶数值 + 横轴标号 + 悬停浮框。
// ---------------------------------------------------------------------------

export interface HistogramItem {
  /** 轴上的标号 */
  label: string;
  value: number;
  /** 写死的颜色（`hitColor` 那套按「命中 N 次」上色的图用）；与 `tone` 二选一 */
  color?: string;
  /**
   * 这一根的**主题色号**：站内 CSS 变量的名字（`--chart-2` / `--w-150`）。
   *
   * 颜色本身写在 CSS 里（`styles.css` 的调色板），这里只挑色号 ——
   * 于是深色主题换一组值就跟着走，js 里也不会出现写死的颜色。
   * 与 `color` 的区别：`tone` 走自定义属性 `--bar-fill`，能被 `.bar-off` 之类的类盖掉。
   */
  tone?: string;
}

export interface HistogramOptions {
  items: HistogramItem[];
  title?: string;
  /** 数值格式化，默认百分比 */
  format?: (v: number) => string;
  /** 纵轴上限；省略则自适应 */
  upper?: number;
  /** 这张图的主题色号（`--chart-1` …）：当所有柱子的默认色，并画成标题左边的小色块 */
  tone?: string;
  /**
   * 画在柱子**里面**的注解（如权重）：贴底居中，颜色交给 CSS
   * （柱身是彩色时写白字、被当成主词条那一根压暗后写深字）。
   * 柱子矮到写不下就整根不画 —— 字挤出柱子外比不标更难读。
   */
  insideLabels?: readonly string[];
  /**
   * 被挑掉的那一根（下标）：压暗（`.bar-off`）**并且把柱顶数值换成 `dimmedLabel`**。
   * 用于「这一条已经不在池子里了」（权重图里它被当成了主词条）——柱高留在原处，
   * 让人看得出挑掉的是哪一条。传负数 / 不传 = 没有这一根。
   */
  dimmed?: number;
  /** 上面那根柱子顶上写什么（文案由调用方给，渲染层不写中文） */
  dimmedLabel?: string;
  /**
   * 点某一根柱子。**渲染层只回报点了哪一个**，「点了是排除还是取消」由调用方决定
   * （权重图那张就是「再点一次恢复」）。
   */
  onPick?: (index: number) => void;
  /**
   * 浮框里额外补的行（图上读不到的那些，如原始权重、这个词条能不能当主词条）。
   *
   * 浮框的规矩见 `memory.md` §5：**只放图上读不到的**，同一个数只出现一次；
   * 所以这里只该给「柱高 / 标号 / 柱内注解」之外的量。
   */
  tooltipRows?: (index: number) => TooltipRow[];
  /**
   * 纵轴贴着最高的柱子（`tightAxis`）而不是抬到整齐的整数倍上限。
   *
   * 两者的差别在「上面空多少」：最高 19.18% 的柱子，`niceAxis` 会给出 30% 的上限
   * （柱子只占 64% 高度），作者对质量分布图的原话是「按最高的柱子来，比它稍高一点就行」。
   * 默认仍是 `niceAxis`（命中次数那张图不动）。
   */
  tight?: boolean;
  host?: HTMLElement | null;
  width?: number;
  height?: number;
  tooltip: Tooltip;
}

export function renderHistogram(opts: HistogramOptions): SVGSVGElement {
  const { items, title, tooltip } = opts;
  const format = opts.format ?? ((v: number) => pct(v, 2));
  const inside = opts.insideLabels;
  const fit = fitSize(opts.host, { ratio: 0.30, minH: 260, maxH: 420 });
  const width = opts.width ?? fit.width;
  const height = opts.height ?? fit.height;
  const f = frame({
    width,
    height,
    // 上下边距按「图内标题占 26、横轴标号占 40」给：再宽只是白边，
    // 而画布本身常常被压扁（「词条权重」那几张），边距一大绘图区就没高度了
    margin: { top: 26, right: 18, bottom: 40, left: 52 },
    title,
    ...(opts.tone ? { titleChip: `var(${opts.tone})` } : {}),
    ariaLabel: title ?? '分布',
  });

  if (items.length === 0) return f.svg;

  const max = opts.upper ?? Math.max(...items.map((d) => d.value)) * 1.08;
  const axis = opts.tight ? tightAxis(max) : niceAxis(max, 4);
  yAxis(f, axis, (v) => (opts.format ? format(v) : pctTick(v, axis.step)));

  const bandW = f.plotW / items.length;
  // 上限 56：柱子细一点、留白多一点，几张图并排时看起来是一套（原来到 76，宽的太宽）
  const barW = Math.max(2, Math.min(bandW * 0.62, 56));
  const xOf = (i: number): number => (i + 0.5) * bandW;
  const yOf = (v: number): number => f.plotH - (v / axis.max) * f.plotH;

  const bars: SVGRectElement[] = [];
  items.forEach((d, i) => {
    const y = yOf(d.value);
    const off = i === opts.dimmed;
    const tone = d.tone ?? opts.tone;
    const cls = ['bar-seg', tone ? 'bar-tone' : '', off ? 'bar-off' : ''].filter(Boolean).join(' ');
    const bar = el('rect', {
      x: xOf(i) - barW / 2,
      y,
      width: barW,
      height: Math.max(f.plotH - y, 0.5),
      // 有主题色号就不写内联 `fill`（否则 `.bar-off` 盖不住它）：走自定义属性
      ...(tone ? {} : { fill: d.color ?? hitColor(i) }),
      rx: 3,
      class: cls,
    });
    if (tone) bar.style.setProperty('--bar-fill', `var(${tone})`);
    bars.push(bar);
    f.plot.append(bar);
    f.plot.append(
      text(off ? (opts.dimmedLabel ?? '') : format(d.value), {
        x: xOf(i),
        y: Math.max(y - 6, 10),
        'text-anchor': 'middle',
        class: off ? 'bar-label bar-label-off' : 'bar-label',
      }),
    );
  });

  xAxis(f, items.map((d, i) => ({ x: xOf(i), text: d.label })), '');
  // 柱子**里面**的注解（权重）：贴底居中
  if (inside) {
    items.forEach((d, i) => {
      if (f.plotH - yOf(d.value) < 22) return;
      const off = i === opts.dimmed;
      f.plot.append(
        text(inside[i] ?? '', {
          x: xOf(i),
          y: f.plotH - 7,
          'text-anchor': 'middle',
          class: off ? 'bar-inside-off' : 'bar-inside',
        }),
      );
    });
  }

  const guide = el('line', { class: 'guide', y1: 0, y2: f.plotH, x1: -99, x2: -99 });
  f.plot.append(guide);

  items.forEach((d, i) => {
    const x = xOf(i);
    const bar = bars[i]!;
    const hit = el('rect', {
      x: x - bandW / 2,
      y: 0,
      width: Math.max(bandW, 2),
      height: f.plotH,
      fill: 'transparent',
      class: opts.onPick ? 'hot-rect pickable' : 'hot-rect',
    });
    hit.addEventListener('mouseenter', (ev) => {
      guide.setAttribute('x1', String(x));
      guide.setAttribute('x2', String(x));
      guide.classList.add('on');
      // 能点的图：柱子跟着亮一点，光标在哪儿、能点哪个一目了然
      if (opts.onPick) bar.classList.add('bar-hover');
      tooltip.show(
        {
          // 纵轴就是「概率」，所以数值进 badge，不再另起一行叫「概率」
          title: d.label,
          badge: format(d.value),
          rows: opts.tooltipRows?.(i) ?? [],
        },
        ev.clientX,
        ev.clientY,
      );
    });
    hit.addEventListener('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY));
    hit.addEventListener('mouseleave', () => {
      guide.classList.remove('on');
      bar.classList.remove('bar-hover');
      tooltip.hide();
    });
    if (opts.onPick) {
      const pick = opts.onPick;
      hit.addEventListener('click', () => pick(i));
    }
    f.plot.append(hit);
  });

  return f.svg;
}

// ---------------------------------------------------------------------------
// 4. 胚子质量：按组合堆叠的柱 + 累计概率曲线
// ---------------------------------------------------------------------------

/**
 * 分类色盘：**柔和的浅色**，与参考图（`docs/ai-ref/v1/init_stats/` 下那几张
 * matplotlib 图）同一路的 pastel 观感。
 *
 * 两处用它：**质量分布的段**（同一根柱子里的第 k 段取第 k 个色）与**组合概率的扇区**
 * （按画图顺序取色）。作者对配色的要求是两头都不能过：
 *   - 全一个颜色不行 —— 段与段的界限只能靠一条细缝看；
 *   - 拉满对比也不行 —— 一根柱子上四五个高饱和色摞起来像色卡（原话「丑不啦唧」）。
 * 所以这里统一取**低饱和、同一亮度档**的浅色：相邻两项换色相（蓝→橙红→青绿→淡紫……），
 * 读得出区别，整体又是同一套调子。
 *
 * 随之而来的两条约定：
 *   - 段内文字用**深色**（浅底上白字看不清）—— 参考图也是深字；
 *   - 段之间留一道**背景色的细缝**（`quality-seg`），浅色相邻时靠这条缝分界，
 *     最上面那一段在纯白底上也有轮廓。
 */
export const CATEGORICAL_COLORS = [
  '#8cb8d7', // 蓝
  '#fb8c80', // 橙红
  '#98d7cc', // 青绿
  '#c4c0dd', // 淡紫
  '#f0c674', // 橙黄
  '#98e7aa', // 绿
  '#f2a8dc', // 粉
  '#c9c9c9', // 灰
  '#e1c1a5', // 米
  '#a8c8e8', // 淡蓝
];

export function categoricalColor(index: number): string {
  return CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length]!;
}

/**
 * 蓝色色标（浅 → 深）。**热力图与「质量分布」的段共用同一套**，全站就这一条渐变。
 *
 * 出处是归档 `init_stats.py`：热力图与质量分布都取 `sns.color_palette("Blues_d", …)`，
 * 所以网页这边也走单色相由浅到深的蓝。取色两头都不走极端（作者的老要求）：
 * 最浅那档只比背景深一点，最深那档留一点余地，格子/段里的数字才一直读得清。
 */
export const BLUE_RAMP = [
  '#eef4fa', // 几乎就是背景
  '#cfe0ee',
  '#a9c9e2',
  '#7fadd0',
  '#4a83b0',
  '#32719f', // 最深：白字
] as const;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 色标上 `t`（0~1）处的颜色，档与档之间线性插值 */
export function rampColor(t: number): string {
  const x = Math.min(Math.max(t, 0), 1) * (BLUE_RAMP.length - 1);
  const i = Math.min(Math.floor(x), BLUE_RAMP.length - 2);
  const k = x - i;
  const a = hexToRgb(BLUE_RAMP[i]!);
  const b = hexToRgb(BLUE_RAMP[i + 1]!);
  const mix: [number, number, number] = [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
  return `#${mix.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** sRGB 相对亮度（0~1）：决定一个底色上该写深字还是白字 */
export function luminance(hex: string): number {
  const lin = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** 底色上的字色：深底写白字、浅底写深字（**不要写死一个颜色**） */
export function inkOn(fill: string): string {
  return luminance(fill) < 0.28 ? '#ffffff' : '#26303d';
}

/**
 * 「质量分布」一列里第 `k` 段（共 `n` 段）的颜色。
 *
 * **渐变是段与段之间的事，段内是纯色** —— 作者的原话：「渐变色是让你一列的多个小柱子
 * 用渐变色，单个柱子内颜色不变」。位置取 `(k + 1) / (n + 1)`：既铺满整条色标，
 * 又永远不落在两端的极值上（单段的一列取正中间那档，不会淡成一片白）。
 * 跨列不复用同一套编码（作者：列间不需要区分度），每列都由浅到深。
 */
export function segmentColor(k: number, n: number): string {
  return rampColor((k + 1) / (n + 1));
}

/** 累计概率曲线（红线）的颜色。CSS 里也有一份，浮框的色块要与线一致 */
const CUM_COLOR = '#e74c3c';

/**
 * 估算一段文字的宽度。SVG 里拿不到真实排版宽度（`getComputedTextLength` 在
 * jsdom 与未挂载时是 0），所以按字数估：汉字（含全角标点）算一个全宽，
 * 其余（数字、`%`、`+`）算 0.55 —— 比「一律按字数 × 字号」准得多，
 * 组合名里的 `+` 不再白占一个汉字位。
 */
export function textWidth(s: string, fontSize = 9.5): number {
  let w = 0;
  for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.55;
  return w;
}

/**
 * 把组合名折成 1~2 行塞进 `width`；塞不下返回 `null`（交给浮框）。
 *
 * 折点只在 `+` 上：组合名本来就是「词条 + 词条」，从那里断开不会读错。
 * 「大攻击+暴击+精通」这种 3 条词条的名字在柱宽下写不下，折成两行就写得下了。
 */
export function wrapCombo(label: string, width: number, fontSize = 9.5): string[] | null {
  // 名字去掉 `+` 两侧的空格：`暴击 + 精通` 会白占两个字符位
  const compact = label.replace(/ \+ /g, '+');
  if (textWidth(compact, fontSize) <= width) return [compact];
  const parts = compact.split('+');
  if (parts.length < 2) return null;

  let best: string[] | null = null;
  let bestW = Infinity;
  for (let i = 1; i < parts.length; i++) {
    const lines = [parts.slice(0, i).join('+'), parts.slice(i).join('+')];
    const w = Math.max(...lines.map((l) => textWidth(l, fontSize)));
    if (w <= width && w < bestW) {
      best = lines;
      bestW = w;
    }
  }
  return best;
}

/** 一根柱子里的一个组合段 */
export interface QualitySegment {
  /** 组合的展示名，如 `暴击 + 充能` */
  label: string;
  /** 组合里的词条（勾选框靠它判断高亮） */
  attrs: SubAttr[];
  /** 组合里有几条有效词条（只用于决定堆叠顺序） */
  size: number;
  /** 该组合占全部胚子的概率 */
  p: number;
}

export interface QualityBar {
  /** 该柱对应的胚子得分 */
  score: number;
  /** 该分数的总概率 */
  total: number;
  /** P(得分 ≥ 该分数) */
  atLeast: number;
  /** 柱内的组合段 */
  segments: QualitySegment[];
}

export interface QualityChartOptions {
  /** 得分升序 */
  bars: QualityBar[];
  /**
   * 高亮的词条（子 tab 上的勾选框）。
   *
   * 组合**包含全部**被勾选的词条时高亮，其余压暗 —— 与参考实现
   * `plot_quality_distribution_stacked` 的 `highlight_comb` 同一套语义
   * （`set(highlight).issubset(combo)`）。空集合 = 不高亮（全部正常显示）。
   */
  highlight?: readonly SubAttr[];
  /**
   * 右上角的角标：勾选了哪几条、同时含这几条的胚子占多少。
   *
   * 文案由调用方给（`ui/copy.ts` 是全部界面文字的唯一出处），这里只管画。
   * `highlight` 为空时不传，也就不画。
   */
  pickNote?: { label: string; value: string };
  /** 是否画累计概率（红线 + 右轴）。默认画；勾选框可以关掉 */
  showCum?: boolean;
  /** 图内标题；通常由外层 HTML 负责 */
  title?: string;
  host?: HTMLElement | null;
  width?: number;
  height?: number;
  tooltip: Tooltip;
}

/**
 * 胚子质量分布：每根柱子按「是哪几条词条的组合」拆开堆叠，
 * 再把累计概率 `P(得分 ≥ 该分数)` 叠成一条红线。
 *
 * ## 为什么这一张图允许「两个量纲同框」
 *
 * 站内的一般规矩是**纵轴各自独立、不叠量纲**（生存曲线当初就是因为被柱子上限压扁才拆出去的）。
 * 这张图是作者点名要的（参考 `docs/ai-ref/v1/init_stats/暴伤/质量分布-详细-1.png`），
 * 处理办法与参考实现一致：**把累计概率按比例缩放进柱子的量纲**（除以 1.1），
 * 右侧再画一条从 0 到 1 的轴把真实概率标出来 —— 曲线不会被压扁，
 * 也不会与柱子共用同一个读数。
 *
 * ## 堆叠顺序与配色
 *
 * 段按**组合里的有效词条条数**从少到多堆（0 条在最下、4 条在最上），同档内按概率降序。
 * 颜色按**堆叠顺序**取 `CATEGORICAL_COLORS`：同一根柱子里的段必定不同色，
 * 而跨柱子不复用同一套编码（作者要的就是这个：柱内要分得清，列间不必一致）。
 *
 * ## 标注
 *
 * 柱顶的**总概率每根都标**（作者 2026-10-07：柱子再小，柱子上方也放得下），
 * 只有柱子窄到写不下这几个字符时才不标；柱内的组合名与概率仍是「放得下才画」。
 * 柱顶标注与累计刻度竖直挨太近时舍掉刻度，保柱顶。
 */
export function renderQualityStacked(opts: QualityChartOptions): SVGSVGElement {
  const { bars, title, tooltip } = opts;
  const highlight = opts.highlight ?? [];
  const showCum = opts.showCum ?? true;
  /** 该组合是否含全部被勾选的词条 */
  const isHit = (s: QualitySegment): boolean =>
    highlight.length > 0 && highlight.every((a) => s.attrs.includes(a));

  const fit = fitSize(opts.host, SHARED_FIT);
  const width = opts.width ?? fit.width;
  const height = opts.height ?? fit.height;
  const f = frame({
    width,
    height,
    // 右轴（累计概率）不画时不必留那条轴的位置
    margin: { top: 40, right: showCum ? 72 : 18, bottom: 58, left: 56 },
    title,
    // 没有图内标题也要留白：右上角要放「含勾选词条的胚子比例」
    header: 40,
    ariaLabel: title ?? '胚子质量分布',
  });

  if (bars.length === 0) return f.svg;

  // 纵轴贴着最高的柱子（只留 6% 放柱顶标注），不再抬到 40% 这种整齐的上限。
  // 曲线按 /1.1 缩放进同一个量纲，所以上限变小与它无关。
  const peak = Math.max(...bars.map((b) => b.total));
  const axis = tightAxis(peak);
  yAxis(f, axis, (v) => pctTick(v, axis.step));

  const bandW = f.plotW / bars.length;
  const barW = Math.max(2, Math.min(bandW * 0.66, 84));
  const xOf = (i: number): number => (i + 0.5) * bandW;
  const yOf = (v: number): number => f.plotH - (v / axis.max) * f.plotH;
  /**
   * 累计概率的纵向映射：**右轴是一条真正的 0~100% 轴**，铺满整个绘图区高度。
   *
   * 参考实现把曲线缩进柱子的量纲时除了个 1.1（那时左轴留了 25% 余量）。
   * 现在左轴贴着峰值，再除 1.1 会让 100% 落在最高那根柱子的顶**下面**十几像素 ——
   * 曲线的起点钻进柱子里。改成不缩（`v * axis.max`）之后曲线恒在柱顶之上，
   * 右轴的读数也不再受左轴上限的影响（上限怎么调，右轴都是 0~100% 铺满）。
   */
  const yOfCum = (v: number): number => yOf(v * axis.max);

  /** 堆叠顺序：条数少的在下面，同档按概率降序。颜色按这个顺序取 */
  const segsOf = bars.map((b) => [...b.segments].sort((x, y) => x.size - y.size || y.p - x.p));
  /**
   * 段 → 图上真正的填充色，浮框的色块靠它与图上对上。
   *
   * 命中段在图上会被 CSS 换成暖橙（`seg-hit`），所以这里也存那个颜色 ——
   * 写成 `var(--accent-warm)` 能跟着主题走（浮框的色块是内联样式，认得 CSS 变量）。
   */
  const colorOf = new Map<QualitySegment, string>();
  /** 命中段的填充色（与 CSS `.seg-hit` 里的值保持一致） */
  const HIT_FILL = 'var(--hit-fill)';

  // --- 标注放不放得下：先算，画的时候按这个来 ---
  //
  // 柱顶标注的口径（作者 2026-10-07）：「标在柱子上方，无论柱子有多小，
  // 都不可能空间不够」—— 所以**每根柱子都标**，不再按概率大小省略。
  // 旧版是「> 4% 一定标、其余要 ≥ 纵轴上限的 8%」，于是 0.2% 那根柱子顶上光秃秃的，
  // 而它恰恰是最需要写出来的一档。
  //
  // 唯一保留下来的例外是**横向**放不下：柱子窄到连「27.1%」这五个字符都摆不开时，
  // 相邻的标号会压在一起（那不是「柱子小」，是「柱子密」）。
  /** 柱顶标注与累计刻度挨得比这个还近时，让刻度让路 */
  const MIN_GAP = 11;
  const barLabel = bars.map((b) => textWidth(pct(b.total, 1), BAR_LABEL_SIZE) <= bandW);
  /**
   * 累计刻度画不画。
   *
   * 柱顶值在柱子正上方、累计刻度在图的右边缘，两者竖直方向挨得近时会显得挤；
   * 柱顶值优先（它说的是「这根柱子多少」），所以挤的时候让**刻度**让路 ——
   * 刻度只是辅助，累计概率在浮框里也给了。
   *
   * 判据取**绝对**竖直距离：累计曲线按 `v * axis.max` 映射到真正的 0~100% 右轴，
   * 它落在柱顶上面还是下面都不一定（多数柱子上在下面，离得很远）。
   */
  const cumLabel = bars.map(
    (b, i) =>
      showCum &&
      b.atLeast >= 0.001 &&
      !(barLabel[i] && Math.abs(yOf(b.total) - yOfCum(b.atLeast)) < MIN_GAP),
  );
  // 刻度之间也不许叠：末尾几根柱子的概率都很小，累计值挨得很近（`2.6%` 压在 `0.2%` 上）。
  // 从上往下扫，离上一个刻度太近的就不画 —— 刻度是参考，缺一格不影响读图。
  let lastCumY = -Infinity;
  bars.forEach((b, i) => {
    if (!cumLabel[i]) return;
    const y = yOfCum(b.atLeast);
    if (y - lastCumY < MIN_GAP) {
      cumLabel[i] = false;
      return;
    }
    lastCumY = y;
  });

  // --- 累计概率：每根柱子一条虚线引到右轴 ---
  if (showCum) {
    bars.forEach((b, i) => {
      if (!cumLabel[i]) return;
      const y = yOfCum(b.atLeast);
      f.plot.append(el('line', { x1: xOf(i), x2: f.plotW, y1: y, y2: y, class: 'cum-guide' }));
    });
  }

  // --- 柱子：按组合的条数从少到多堆；一列里由浅到深渐变，段内纯色 ---
  bars.forEach((b, i) => {
    const x = xOf(i);
    const segs = segsOf[i]!;
    let bottom = 0;
    for (const [k, s] of segs.entries()) {
      if (s.p <= 0) continue;
      const y0 = yOf(bottom + s.p);
      const h = yOf(bottom) - y0;
      const hit = isHit(s);
      // 段色：命中段在 CSS 里被换成暖橙（`.seg-hit`），所以只算非命中段要画的那个色
      const color = segmentColor(k, segs.length);
      const ink = inkOn(color);
      colorOf.set(s, hit ? HIT_FILL : color);
      const rect = el('rect', {
        x: x - barW / 2,
        y: y0,
        width: barW,
        height: Math.max(h, 0.6),
        fill: color,
        // `quality-seg`：段之间留一道背景色细缝，浅色相邻时靠它分界
        class: 'bar-seg quality-seg',
      });
      // 勾选框的命中段：**换成暖橙**（照归档参考实现 `facecolor='#FF8C00'`），
      // 其余压暗。不再描那一圈黑边 —— 作者：「不要用黑边框，太丑」。
      if (highlight.length > 0) {
        rect.classList.add(hit ? 'seg-hit' : 'seg-dim');
      }
      f.plot.append(rect);

      // 段内标注：名字（1~2 行）+ 概率。高度不够就整段交给浮框 ——
      // 字压出段外比不标更难读。两行字连行距约占 20px，留 2px 上下余量。
      const lines = wrapCombo(s.label, barW - 6);
      const rows = lines ? lines.length + 1 : 0;
      if (lines && h >= rows * 10 + 2) {
        const dim = highlight.length > 0 && !hit;
        // 命中段是橙色底 → 深字；非命中段按段的深浅翻白字
        const onDark = !hit && ink === '#ffffff';
        const top = y0 + h / 2 - ((rows - 1) * 10) / 2 + 3.5;
        lines.forEach((line, n) => {
          const t = text(line, {
            x,
            y: top + n * 10,
            'text-anchor': 'middle',
            class: onDark ? 'seg-label on-dark' : 'seg-label',
          });
          if (dim) t.classList.add('seg-dim');
          f.plot.append(t);
        });
        const value = text(pct(s.p, 1), {
          x,
          y: top + lines.length * 10,
          'text-anchor': 'middle',
          class: onDark ? 'seg-pct on-dark' : 'seg-pct',
        });
        if (dim) value.classList.add('seg-dim');
        f.plot.append(value);
      }
      bottom += s.p;
    }
  });

  // --- 累计概率折线 ---
  if (showCum) {
    const cum = bars
      .map((b, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(2)},${yOfCum(b.atLeast).toFixed(2)}`)
      .join(' ');
    f.plot.append(el('path', { d: cum, class: 'cum-line' }));
    bars.forEach((b, i) => {
      f.plot.append(
        el('rect', {
          x: xOf(i) - 3,
          y: yOfCum(b.atLeast) - 3,
          width: 6,
          height: 6,
          transform: `rotate(45 ${xOf(i).toFixed(2)} ${yOfCum(b.atLeast).toFixed(2)})`,
          class: 'cum-dot',
        }),
      );
    });

    // 真实概率标在右轴外侧；轴名竖排，免得与右上角的角标抢地方
    bars.forEach((b, i) => {
      if (!cumLabel[i]) return;
      f.plot.append(
        text(pctTick(b.atLeast, 0.001), {
          x: f.plotW + 6,
          y: yOfCum(b.atLeast) + 3.5,
          'text-anchor': 'start',
          class: 'cum-label',
        }),
      );
    });
    // 竖排轴名落在「刻度数字」与画布右边缘之间：刻度数字最多约 38px 宽（`100.0%`），
    // 右边距 72px，所以中缝在 plotW + 58 左右 —— 两边各留 6~8px。
    const titleX = f.plotW + 58;
    f.plot.append(
      text('累计概率', {
        x: titleX,
        y: f.plotH / 2,
        transform: `rotate(90 ${titleX} ${f.plotH / 2})`,
        'text-anchor': 'middle',
        class: 'cum-title',
      }),
    );
  }

  // --- 柱顶总概率 ---
  bars.forEach((b, i) => {
    if (!barLabel[i]) return;
    f.plot.append(
      text(pct(b.total, 1), {
        x: xOf(i),
        y: yOf(b.total) - 5,
        'text-anchor': 'middle',
        class: 'bar-label',
      }),
    );
  });

  // --- 勾选词条的合计：**画在绘图区内的右上角**（照归档参考实现的图例） ---
  //
  // 参考实现是 `ax1.legend(loc=…)`，也就是画在坐标区里面；作者要的是同一个位置
  // （原话「放在图片内的右上角，而不是图片外」），所以坐标从绘图区右上角往内收，
  // 右端停在 plotW 之内 —— 也就不会压到右轴那排累计刻度（它们在绘图区外面）。
  if (opts.pickNote) {
    const padX = 8;
    const swatch = 9;
    const h = 20;
    const top = 8;
    const valueW = textWidth(opts.pickNote.value, 12);
    const labelW = textWidth(opts.pickNote.label, 11);
    const right = f.plotW - 8;
    const left = right - padX * 2 - swatch - 6 - labelW - 6 - valueW;
    const baseline = top + h / 2 + 4;
    // 底框：白底 + 暖橙描边（与命中段同一个颜色，一眼看出这个数说的是哪些段）
    f.plot.append(
      el('rect', {
        x: left,
        y: top,
        width: right - left,
        height: h,
        rx: 6,
        class: 'pick-box',
      }),
    );
    f.plot.append(
      el('rect', {
        x: left + padX,
        y: top + h / 2 - swatch / 2,
        width: swatch,
        height: swatch,
        rx: 2,
        class: 'pick-swatch',
      }),
    );
    f.plot.append(
      text(opts.pickNote.label, {
        x: left + padX + swatch + 6,
        y: baseline,
        'text-anchor': 'start',
        class: 'pick-label',
      }),
    );
    f.plot.append(
      text(opts.pickNote.value, {
        x: right - padX,
        y: baseline,
        'text-anchor': 'end',
        class: 'pick-value',
      }),
    );
  }

  xAxis(
    f,
    tickIndices(bars.length, 12).map((i) => ({ x: xOf(i), text: String(bars[i]!.score) })),
    '胚子得分（分）',
  );

  // --- 悬停：每列一块热区（浏览器做命中测试，不自己换算坐标） ---
  const guide = el('line', { class: 'guide', y1: 0, y2: f.plotH, x1: -99, x2: -99 });
  f.plot.append(guide);

  bars.forEach((b, i) => {
    const x = xOf(i);
    const hit = el('rect', {
      x: x - bandW / 2,
      y: 0,
      width: Math.max(bandW, 2),
      height: f.plotH,
      fill: 'transparent',
      class: 'hot-rect',
    });
    hit.addEventListener('mouseenter', (ev) => {
      guide.setAttribute('x1', String(x));
      guide.setAttribute('x2', String(x));
      guide.classList.add('on');
      // 明细行 = 这根柱子由哪些组合凑成（图上标不下的，浮框里都有）。
      // 本分数的合计已经在 badge 里了，**不要再补一行「本分数合计」**。
      const rows: TooltipRow[] = [...b.segments]
        .sort((p, q) => q.p - p.p)
        .map((s) => ({
          label: s.label,
          value: pct(s.p, 2),
          color: colorOf.get(s) ?? categoricalColor(0),
        }));
      // 累计概率：曲线本身读不出具体数值，作者要求标在浮框里。
      // 它与上面那些行**不是同一类**（走右轴、来自另一条曲线），拉一道分隔线分开。
      if (showCum) {
        rows.push({ label: '累计概率 ≥ 该分数', value: pct(b.atLeast, 2), color: CUM_COLOR, sep: true });
      }
      tooltip.show(
        {
          title: `${b.score} 分`,
          badge: pct(b.total, 2),
          rows,
        },
        ev.clientX,
        ev.clientY,
      );
    });
    hit.addEventListener('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY));
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
 * **本文件已不再用它**，保留是因为它记录了一个踩过的坑，别的地方（如热力图）若要
 * 自己做命中判定会需要。用在界面上时优先考虑**让浏览器做命中测试**
 * （每列一块热区、事件挂在热区上），那比任何手写换算都准。
 *
 * 用 `getScreenCTM()` 的逆矩阵，而不是 `svgBox.width / viewBox.width`：
 * 后者假设了等比缩放，而 `svg.chart { width: 100% }` 会横向拉伸 viewBox。
 * 但实测**即使换成逆矩阵仍有随位置增大的残差**（`ctm.a` 比真实渲染比例多约 0.6%，
 * 竖线比光标偏 1~4px），所以坐标换算这条路整体不可靠。
 *
 * 取不到 CTM（jsdom、未挂载）时返回 `null`，调用方自己退化。
 */
export function plotLocalPoint(
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
