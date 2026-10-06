/**
 * 环形图：用于「组合概率」这类「几块加起来正好是 1」的数据。
 *
 * 手写 SVG 扇形，悬停整块高亮并把该块从圆心「拉出来」一点。
 * 不用 canvas 是为了沿用同一套 CSS 变量配色，并能直接被测试断言。
 */

import { pct } from '../ui/format';
import { hitColor } from './charts';
import type { Tooltip } from './tooltip';

export interface PieDatum {
  /** 展示名 */
  label: string;
  /** 概率（分片之和应为 1） */
  p: number;
  /** 颜色；省略则按索引取默认配色 */
  color?: string;
  /** 悬停时补充说明 */
  note?: string;
}

export interface PieOptions {
  items: PieDatum[];
  title: string;
  /** 圆心留空的半径比例，0 即实心饼 */
  innerRatio?: number;
  size?: number;
  tooltip: Tooltip;
}

const NAMESPACE = 'http://www.w3.org/2000/svg';
const CX = 50;
const CY = 50;
const R = 44;

function arcPath(startPct: number, endPct: number, innerR: number): string {
  const a0 = (startPct * 2 - 0.5) * Math.PI;
  const a1 = (endPct * 2 - 0.5) * Math.PI;
  const p = (r: number, a: number): [number, number] => [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  const large = endPct - startPct > 0.5 ? 1 : 0;
  const [x0, y0] = p(R, a0);
  const [x1, y1] = p(R, a1);
  if (innerR <= 0) {
    return `M${CX},${CY} L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z`;
  }
  const [ix1, iy1] = p(innerR, a1);
  const [ix0, iy0] = p(innerR, a0);
  return (
    `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} ` +
    `L${ix1},${iy1} A${innerR},${innerR} 0 ${large} 0 ${ix0},${iy0} Z`
  );
}

export function renderPie(opts: PieOptions): SVGSVGElement {
  const { items, title, tooltip } = opts;
  const innerR = (opts.innerRatio ?? 0.62) * R;
  const size = opts.size ?? 320;

  const svg = document.createElementNS(NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'pie');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);

  const total = items.reduce((s, d) => s + d.p, 0);
  if (total <= 0) return svg;

  let acc = 0;
  items.forEach((d, i) => {
    if (d.p <= 0) return;
    const from = acc;
    const to = acc + d.p / total;
    acc = to;

    const path = document.createElementNS(NAMESPACE, 'path');
    path.setAttribute('d', arcPath(from, to, innerR));
    path.setAttribute('fill', d.color ?? hitColor(i));
    path.setAttribute('class', 'pie-slice');
    path.setAttribute('data-slice', String(i));

    const label = d.label.length > 22 ? `${d.label.slice(0, 21)}…` : d.label;
    path.addEventListener('mouseenter', (ev) => {
      path.classList.add('on');
      tooltip.show(
        {
          title: label,
          subtitle: `占全部可能组合的 ${pct(d.p / total, 2)}`,
          rows: [{ label: d.label, value: pct(d.p / total, 2), color: d.color ?? hitColor(i) }],
          footer: d.note ?? '「其他」是概率过小、被合并的长尾',
        },
        ev.clientX,
        ev.clientY,
      );
    });
    path.addEventListener('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY));
    path.addEventListener('mouseleave', () => {
      path.classList.remove('on');
      tooltip.hide();
    });
    svg.append(path);
  });

  // 图例用 HTML 画（`app.ts` 里排成网格），SVG 里只留扇区，
  // 这样长标签不会被 viewBox 挤压变形。
  return svg;
}
