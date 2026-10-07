/**
 * 热力图：行 = 主词条，列 = 副词条，格子里是**概率**。
 *
 * 参考 `docs/ai-ref/v1/init_stats/主词条-副词条.png`（归档的 `plot_substat_heatmap`），
 * 但**配色换成站内那一套**：单色相的蓝色梯度（浅 → `CATEGORICAL_COLORS` 的蓝 → 深蓝），
 * 参考图那张是 matplotlib 的 `YlOrRd`，黄到深红，与网页其他地方不是一个调子。
 *
 * 每格自带命中测试（格子本身就是热区）：格子上没有别的东西可读，
 * 不像折线图那样需要一条竖线指出位置。
 */

import type { HeatRow } from '../core/heatmap';
import type { SubAttr } from '../core/stats';
import { fitSize, inkOn, luminance, rampColor, textWidth } from './charts';
import type { Tooltip, TooltipBar } from './tooltip';

const NAMESPACE = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NAMESPACE, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function text(content: string, attrs: Record<string, string | number> = {}): SVGTextElement {
  const node = el('text', attrs);
  node.textContent = content;
  return node;
}

/**
 * 色标：热力图与「质量分布」的段**共用** `charts.BLUE_RAMP`（全站就这一条蓝渐变），
 * 只是取色的方式不同 —— 这里按「该格概率 / 全场最大概率」连续取，
 * 那边按段在一列里的位置取（`segmentColor`）。
 *
 * 格子里写深字还是白字由 `inkOn`（亮度）决定，别硬编码一个颜色。
 */
export const heatColor = rampColor;
export { luminance, inkOn as inkOf };

/**
 * 一行：两个维度里的一个取值（主词条 / 部位），`probs` 是它在这一行上有值的格子。
 *
 * 两张图共用这个形状：「主词条 × 副词条」与「部位 × 主词条」——
 * 都是**行 × 列的二维概率表**，只是维度与口径不同。
 */
export interface HeatRowLike {
  /** 稳定标识（= 词条名 / 部位名 / `OTHER_MAIN`） */
  key: string;
  label: string;
  /** 不在里面的列就是**空格子**（该组合不可能出现） */
  probs: { attr: string; p: number }[];
}

export interface HeatmapOptions {
  rows: HeatRowLike[];
  /** 列，顺序即绘制顺序（元素既当标识也当列名） */
  cols: readonly string[];
  /** 当前主词条所在行的 `key`（`core/heatmap.ts` 的 `heatRowKey`）；不给就不高亮 */
  highlightRow?: string;
  /** 同时给出这一列时，只把**那一格**框出来（「你现在选的是这一格」） */
  highlightCol?: string;
  /**
   * 悬停某格时浮框里那组「再下一条」的横排柱。
   *
   * 概率由调用方用 core 算好（这里只管画），因为「已抽走哪几条」是模型的事。
   */
  nextBars?: (row: HeatRowLike, col: string) => TooltipBar[];
  /** 那组柱的说明：它是一组**条件分布**，条长也不是绝对概率，必须写清 */
  nextCaption?: string;
  /** 左侧竖排轴名 */
  rowAxis?: string;
  /** 底部轴名 */
  colAxis?: string;
  /** 行数少时别把格子拉成一整块（「部位 × 主词条」只有三行） */
  cellMaxH?: number;
  /**
   * 画布高 / 宽的期望比例，默认 0.44。
   *
   * 行数少的表要更扁：三行格子最多 168px 高，塞进 500px 高的绘图区会上下各空一大片
   * （中间那栏放宽之后更明显）。格子高度仍归 `cellMaxH` 管，两者互不影响 ——
   * 一个管画布，一个管格子。
   */
  ratio?: number;
  title?: string;
  host?: HTMLElement | null;
  width?: number;
  height?: number;
  tooltip: Tooltip;
}

export function renderHeatmap(opts: HeatmapOptions): SVGSVGElement {
  const { rows, cols, tooltip } = opts;
  const fit = fitSize(opts.host, { ratio: opts.ratio ?? 0.44, minH: 340, maxH: 620 });
  const width = opts.width ?? fit.width;
  const height = opts.height ?? fit.height;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart heatmap',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': opts.title ?? '主词条与副词条的概率',
  });

  const margin = { top: 40, right: 16, bottom: 46, left: 66 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  if (opts.title) {
    svg.append(text(opts.title, { x: margin.left, y: 20, class: 'chart-title', 'text-anchor': 'start' }));
  }
  const plot = el('g', { transform: `translate(${margin.left},${margin.top})` });
  svg.append(plot);

  if (rows.length === 0 || cols.length === 0) return svg;

  const cellW = plotW / cols.length;
  const cellH = Math.min(plotH / rows.length, opts.cellMaxH ?? Infinity);
  // 行数少时格子不铺满，整块表竖直居中（列名仍然贴着绘图区底部）
  const gridTop = (plotH - cellH * rows.length) / 2;
  // 色标按**实际最大值**归一：分母写死 15.79% 的话，换个配置整张图就一片浅色
  const maxP = Math.max(...rows.flatMap((r) => r.probs.map((d) => d.p)), 0);

  rows.forEach((row, i) => {
    const y = gridTop + i * cellH;
    cols.forEach((col, j) => {
      const x = j * cellW;
      const p = row.probs.find((d) => d.attr === col)?.p ?? 0;
      // 1.5px 的缝：格子之间靠背景色分开，不再描边（与堆叠图的段缝同一个做法）
      const rect = el('rect', {
        x: x + 0.75,
        y: y + 0.75,
        width: Math.max(cellW - 1.5, 1),
        height: Math.max(cellH - 1.5, 1),
        rx: 2,
        class: 'hm-cell',
        'data-row': row.key,
        'data-col': col,
      });
      if (p > 0) {
        const fill = heatColor(p / maxP);
        rect.setAttribute('fill', fill);
        plot.append(rect);
        plot.append(
          text(`${(p * 100).toFixed(2)}%`, {
            x: x + cellW / 2,
            y: y + cellH / 2 + 3.5,
            'text-anchor': 'middle',
            class: 'hm-value',
            fill: inkOn(fill),
            'data-row': row.key,
            'data-col': col,
          }),
        );
      } else {
        // 主词条自己那一格：游戏里不可能出现，画成「空格」而不是 0.00%
        rect.classList.add('hm-hole');
        plot.append(rect);
        plot.append(
          text('—', {
            x: x + cellW / 2,
            y: y + cellH / 2 + 3.5,
            'text-anchor': 'middle',
            class: 'hm-value hm-empty',
            'data-row': row.key,
            'data-col': col,
          }),
        );
      }

      if (p > 0) {
        rect.addEventListener('mouseenter', (ev) => {
          const bars = opts.nextBars?.(row, col) ?? [];
          tooltip.show(
            {
              title: `${row.label} 主词条 · 下一条 ${col}`,
              badge: `${(p * 100).toFixed(2)}%`,
              rows: [],
              ...(bars.length > 0 ? { bars } : {}),
              ...(bars.length > 0 && opts.nextCaption ? { barsCaption: opts.nextCaption } : {}),
            },
            ev.clientX,
            ev.clientY,
          );
        });
        rect.addEventListener('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY));
        rect.addEventListener('mouseleave', () => tooltip.hide());
      }
    });

    // 行名
    plot.append(
      text(row.label, {
        x: -10,
        y: y + cellH / 2 + 3.5,
        'text-anchor': 'end',
        class: row.key === opts.highlightRow ? 'hm-row-label on' : 'hm-row-label',
        'data-row': row.key,
      }),
    );

    // 当前那一行 / 那一格：描一圈（作者一贯要求「当前这一项要看得出来」）
    if (row.key === opts.highlightRow) {
      const colIdx = opts.highlightCol ? cols.indexOf(opts.highlightCol) : -1;
      // 给了列就只框那一格（「部位 × 主词条」：你选的是这一个组合）
      const box =
        colIdx >= 0
          ? { x: colIdx * cellW - 0.75, width: cellW + 1.5 }
          : { x: -0.75, width: plotW + 1.5 };
      plot.append(
        el('rect', {
          x: box.x,
          y: y + 0.75,
          width: box.width,
          height: Math.max(cellH - 1.5, 1),
          rx: 3,
          class: colIdx >= 0 ? 'hm-cell-box' : 'hm-row-box',
        }),
      );
    }
  });

  // 列名
  cols.forEach((col, j) => {
    plot.append(
      text(col, {
        x: j * cellW + cellW / 2,
        y: plotH + 16,
        'text-anchor': 'middle',
        class: 'hm-col-label',
      }),
    );
  });

  if (opts.colAxis) {
    plot.append(
      text(opts.colAxis, {
        x: plotW / 2,
        y: plotH + 36,
        'text-anchor': 'middle',
        class: 'axis-title',
      }),
    );
  }
  if (opts.rowAxis) {
    plot.append(
      text(opts.rowAxis, {
        x: -56,
        y: plotH / 2,
        'text-anchor': 'middle',
        transform: `rotate(-90 -56 ${plotH / 2})`,
        class: 'axis-title',
      }),
    );
  }

  // 色标：两端标 0 与最大值（中间是连续插值，标多了像刻度）。
  // 右端按**绘图区右缘**对齐：往右越界的话最大值那个标签会被画布裁掉。
  const legendW = 90;
  const legendY = -24;
  const maxLabel = `${(maxP * 100).toFixed(1)}%`;
  const barRight = plotW - textWidth(maxLabel, 10.5) - 6;
  const barLeft = barRight - legendW;
  for (let k = 0; k < legendW; k++) {
    plot.append(
      el('rect', {
        x: barLeft + k,
        y: legendY,
        width: 1.5,
        height: 6,
        fill: heatColor(k / (legendW - 1)),
        class: 'hm-legend',
      }),
    );
  }
  plot.append(
    text('0%', { x: barLeft - 6, y: legendY + 6, 'text-anchor': 'end', class: 'axis-label' }),
  );
  plot.append(
    text(maxLabel, {
      x: barRight + 6,
      y: legendY + 6,
      'text-anchor': 'start',
      class: 'axis-label',
    }),
  );

  return svg;
}
