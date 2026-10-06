/**
 * SVG 图表渲染。
 *
 * 对照归档 `init_stats.plot_quality_distribution_stacked` 的信息设计
 * （堆叠柱 + 累积曲线 + 右轴标注），但改为交互式 SVG：
 *   - 悬停高亮该分数，并显示各命中档的权重
 *   - 可横向滚动 / 缩放（分数多时必要）
 *   - 只在一个分数段内标注文字，避免 300+ 根柱子时糊成一片
 */

import { pct, score as fmtScore } from '../ui/format';

export interface StackedDatum {
  /** 分数 */
  score: number;
  /** 该分数下「命中 h 次」的概率，下标 = 命中次数 */
  byHit: number[];
}

export interface StackedChartOptions {
  data: StackedDatum[];
  /** 命中次数标签，如 ['命中 0 次', ...] */
  hitLabels: string[];
  width?: number;
  height?: number;
  /** 是否在柱子上写字（分数多时建议关） */
  showLabels?: boolean;
  /** 标题 */
  title?: string;
}

const NAMESPACE = 'http://www.w3.org/2000/svg';
const HIT_COLORS = ['#334155', '#3b82f6', '#22d3ee', '#34d399', '#fbbf24', '#f472b6'];
const CDF_COLOR = '#f87171';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NAMESPACE, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** 生成堆叠柱状图 + 累积曲线 */
export function renderStackedChart(opts: StackedChartOptions): SVGSVGElement {
  const {
    data,
    hitLabels,
    width = 1200,
    height = 460,
    showLabels = true,
    title = '',
  } = opts;

  const margin = { top: title ? 42 : 20, right: 64, bottom: 78, left: 62 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': title || '得分分布',
  });
  if (title) {
    const t = el('text', {
      x: width / 2,
      y: 22,
      'text-anchor': 'middle',
      class: 'chart-title',
    });
    t.textContent = title;
    svg.append(t);
  }

  const g = el('g', { transform: `translate(${margin.left},${margin.top})` });
  svg.append(g);

  if (data.length === 0) return svg;

  const totals = data.map((d) => d.byHit.reduce((s, v) => s + v, 0));
  const yMax = Math.max(...totals) * 1.15 || 1;
  const bandW = plotW / data.length;
  const barW = Math.min(bandW * 0.72, 26);

  const xOf = (i: number) => i * bandW + bandW / 2;
  const yOf = (p: number) => plotH - (p / yMax) * plotH;

  // --- 网格与 Y 轴 ---
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax / ticks) * i;
    const y = yOf(v);
    g.append(el('line', { x1: 0, x2: plotW, y1: y, y2: y, class: 'grid' }));
    const label = el('text', { x: -8, y: y + 4, 'text-anchor': 'end', class: 'axis-label' });
    label.textContent = pct(v, 1);
    g.append(label);
  }

  // --- 堆叠柱 ---
  data.forEach((d, i) => {
    let bottom = 0;
    d.byHit.forEach((p, h) => {
      if (p <= 0) return;
      const y0 = yOf(bottom + p);
      const h0 = yOf(bottom) - y0;
      const rect = el('rect', {
        x: xOf(i) - barW / 2,
        y: y0,
        width: barW,
        height: Math.max(h0, 0.4),
        fill: HIT_COLORS[h % HIT_COLORS.length]!,
        class: 'bar-seg',
        'data-hit': h,
      });
      const tip = el('title');
      tip.textContent = `${fmtScore(d.score)} 分 · ${hitLabels[h] ?? `命中 ${h} 次`}：${pct(p)}`;
      rect.append(tip);
      g.append(rect);
      bottom += p;
    });
  });

  // --- 只标注「有内容」的柱子：默认标 top 峰值的邻域 ---
  if (showLabels && bandW >= 26) {
    data.forEach((d, i) => {
      const total = d.byHit.reduce((s, v) => s + v, 0);
      if (total < yMax * 0.06) return;
      const t = el('text', {
        x: xOf(i),
        y: yOf(total) - 4,
        'text-anchor': 'middle',
        class: 'bar-label',
      });
      t.textContent = pct(total, 1);
      g.append(t);
    });
  }

  // --- X 轴刻度（最多 ~14 个） ---
  const step = Math.max(1, Math.ceil(data.length / 14));
  data.forEach((d, i) => {
    if (i % step !== 0 && i !== data.length - 1) return;
    const t = el('text', {
      x: xOf(i),
      y: plotH + 18,
      'text-anchor': 'end',
      class: 'axis-label',
      transform: `rotate(-45 ${xOf(i)} ${plotH + 18})`,
    });
    t.textContent = fmtScore(d.score);
    g.append(t);
  });
  const xTitle = el('text', {
    x: plotW / 2,
    y: plotH + 60,
    'text-anchor': 'middle',
    class: 'axis-title',
  });
  xTitle.textContent = '胚子得分';
  g.append(xTitle);

  // --- 累积曲线（≥ 该分数） ---
  const surv: number[] = new Array(data.length).fill(0);
  let acc = 0;
  for (let i = data.length - 1; i >= 0; i--) {
    acc += totals[i]!;
    surv[i] = acc;
  }

  const cdfPath = data
    .map((_, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(2)},${yOf(surv[i]!).toFixed(2)}`)
    .join(' ');
  g.append(
    el('path', { d: cdfPath, fill: 'none', stroke: CDF_COLOR, 'stroke-width': 2, class: 'cdf' }),
  );
  data.forEach((d, i) => {
    const dot = el('circle', {
      cx: xOf(i),
      cy: yOf(surv[i]!),
      r: data.length > 120 ? 1.2 : 2.6,
      fill: CDF_COLOR,
    });
    const tip = el('title');
    tip.textContent = `≥ ${fmtScore(d.score)} 分：${pct(surv[i]!)}`;
    dot.append(tip);
    g.append(dot);
  });

  // --- 右轴：累积概率 ---
  const rightX = plotW + 8;
  for (let i = 0; i <= 5; i++) {
    const v = i / 5;
    const label = el('text', {
      x: rightX,
      y: yOf(0) - plotH * v + 4,
      class: 'axis-label cdf-label',
    });
    label.textContent = `${Math.round(v * 100)}%`;
    g.append(label);
  }
  // 用独立比例画一个「累积概率」标尺说明：把 yOf 映射到 1.15 上限
  const yOfSurv = (p: number) => plotH - (p / 1.15) * plotH;
  const ruler = el('line', {
    x1: rightX - 3,
    x2: rightX - 3,
    y1: yOfSurv(0),
    y2: yOfSurv(1),
    stroke: CDF_COLOR,
    'stroke-width': 1,
    opacity: 0.5,
  });
  g.append(ruler);

  // --- 图例 ---
  const legend = el('g', { transform: `translate(0,${plotH + 26})` });
  const items = [
    ...hitLabels.map((label, h) => ({ label, color: HIT_COLORS[h % HIT_COLORS.length]! })),
    { label: '累积概率（≥ 该分数）', color: CDF_COLOR },
  ];
  let lx = 0;
  for (const it of items) {
    legend.append(
      el('rect', { x: lx, y: 0, width: 10, height: 10, rx: 2, fill: it.color }),
    );
    const t = el('text', { x: lx + 14, y: 9, class: 'legend-label' });
    t.textContent = it.label;
    legend.append(t);
    lx += 14 + it.label.length * 11 + 16;
  }
  g.append(legend);

  return svg;
}
