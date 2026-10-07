/**
 * 环形图：用于「组合概率」这类「几块加起来正好是 1」的数据。
 *
 * 手写 SVG 扇形，悬停整块高亮并把该块从圆心「拉出来」一点。
 * 不用 canvas 是为了沿用同一套 CSS 变量配色，并能直接被测试断言。
 *
 * ## 标注
 *
 * 名字与百分比**画在图上**（参考实现 `plot_attr_pie` 的做法）：
 * 从扇区中缝引一条折线到图外，再引到标签。小扇区因此也能被读到 ——
 * 而「有效词条全齐」的那一项概率最小、恰恰最需要被看见，所以它还会被
 * **从圆心摘出来**（`explode`），配合图外标签一眼可辨。
 *
 * 标签会**避让**：同一侧按 y 排序后强制拉开最小间距，否则相邻的两个小扇区
 * 会叠在一起（参考实现靠 matplotlib 的自动布局，这里得自己来）。
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
  /** 是否从圆心「摘出来」（「组合概率」里是有效词条全齐的那一项） */
  explode?: boolean;
}

export interface PieOptions {
  items: PieDatum[];
  title: string;
  /** 圆心留空的半径比例，0 即实心饼 */
  innerRatio?: number;
  tooltip: Tooltip;
}

const NAMESPACE = 'http://www.w3.org/2000/svg';
// 画布是横着的：左右各留出标签的位置，所以圆心在正中、半径偏小
const VIEW_W = 156;
const VIEW_H = 104;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const R = 27;
/** 摘出来的扇区沿中缝外移多少 */
const EXPLODE = 4;
/** 折线拐点半径与标签锚点半径 */
const ELBOW_R = R + 7;
const LABEL_R = R + 12;
/** 同侧标签之间的最小竖直间距（画布单位） */
const MIN_GAP = 11.5;
/** 一条标签占的竖直空间（名字 + 百分比两行） */
const LABEL_H = 7.5;

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

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NAMESPACE, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const f = (x: number): string => x.toFixed(2);

interface Slice {
  datum: PieDatum;
  /** 在 `items` 里的下标（颜色、测试断言都用它） */
  index: number;
  frac: number;
  from: number;
  to: number;
  /** 中缝角度（与 `arcPath` 同一套约定） */
  angle: number;
  /** 摘出来的位移 */
  offset: number;
  /** 标签锚点的 x（含方向） */
  anchorX: number;
  side: 'left' | 'right';
  /** 标签中心 y：先按中缝算，再避让 */
  y: number;
}

/**
 * 同侧标签避让：按 y 排序后自上而下拉开最小间距，最后整体收进画布。
 *
 * 用「拉开」而不是「挪到不重叠的位置」：后者会让标签离自己的扇区越来越远，
 * 反而指不清是哪一块。
 */
function dodge(slices: Slice[]): void {
  slices.sort((a, b) => a.y - b.y);
  for (let i = 1; i < slices.length; i++) {
    const prev = slices[i - 1]!;
    const cur = slices[i]!;
    if (cur.y - prev.y < MIN_GAP) cur.y = prev.y + MIN_GAP;
  }
  const last = slices[slices.length - 1];
  const first = slices[0];
  if (last && last.y + LABEL_H / 2 > VIEW_H - 3) {
    const shift = last.y + LABEL_H / 2 - (VIEW_H - 3);
    for (const s of slices) s.y -= shift;
  }
  if (first && first.y - LABEL_H / 2 < 3) {
    const shift = 3 - (first.y - LABEL_H / 2);
    for (const s of slices) s.y += shift;
  }
}

export function renderPie(opts: PieOptions): SVGSVGElement {
  const { items, title, tooltip } = opts;
  const innerR = (opts.innerRatio ?? 0.62) * R;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    class: 'pie',
    role: 'img',
    'aria-label': title,
  });

  const total = items.reduce((s, d) => s + d.p, 0);
  if (total <= 0) return svg;

  // --- 先算扇区与标签落点（标签要避让，得先都有位置），再画 ---
  const slices: Slice[] = [];
  let acc = 0;
  items.forEach((datum, index) => {
    const frac = datum.p / total;
    if (frac <= 0) return;
    const from = acc;
    const to = acc + frac;
    acc = to;
    const angle = ((from + to) / 2) * 2 - 0.5;
    const offset = datum.explode ? EXPLODE : 0;
    const radius = LABEL_R + offset;
    const cos = Math.cos(angle * Math.PI);
    slices.push({
      datum,
      index,
      frac,
      from,
      to,
      angle,
      offset,
      anchorX: CX + (cos >= 0 ? radius : -radius),
      side: cos >= 0 ? 'right' : 'left',
      y: CY + radius * Math.sin(angle * Math.PI),
    });
  });
  dodge(slices.filter((s) => s.side === 'left'));
  dodge(slices.filter((s) => s.side === 'right'));

  // --- 扇区 ---
  for (const s of slices) {
    const path = svgEl('path', {
      d: arcPath(s.from, s.to, innerR),
      fill: s.datum.color ?? hitColor(s.index),
      class: 'pie-slice',
      'data-slice': String(s.index),
    });
    if (s.offset > 0) {
      path.setAttribute(
        'transform',
        `translate(${f(s.offset * Math.cos(s.angle * Math.PI))},${f(s.offset * Math.sin(s.angle * Math.PI))})`,
      );
      path.classList.add('exploded');
      path.setAttribute('data-explode', '1');
    }

    path.addEventListener('mouseenter', (ev) => {
      tooltip.show(
        {
          title: s.datum.label,
          subtitle: `占全部可能组合的 ${pct(s.frac, 2)}`,
          rows: [
            {
              label: s.datum.label,
              value: pct(s.frac, 2),
              color: s.datum.color ?? hitColor(s.index),
            },
          ],
          footer: s.datum.note ?? '「其他」是概率过小、被合并的长尾',
        },
        ev.clientX,
        ev.clientY,
      );
    });
    path.addEventListener('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY));
    path.addEventListener('mouseleave', () => tooltip.hide());
    svg.append(path);
  }

  // --- 标签：折线 + 名字 + 百分比 ---
  for (const s of slices) {
    const a = s.angle * Math.PI;
    const startR = R + s.offset;
    svg.append(
      svgEl('polyline', {
        points:
          `${f(CX + startR * Math.cos(a))},${f(CY + startR * Math.sin(a))} ` +
          `${f(CX + (ELBOW_R + s.offset) * Math.cos(a))},${f(CY + (ELBOW_R + s.offset) * Math.sin(a))} ` +
          `${f(s.anchorX)},${f(s.y)}`,
        class: 'pie-leader',
        'data-slice': String(s.index),
      }),
    );
    const inward = s.side === 'right' ? 1.8 : -1.8;
    const name = svgEl('text', {
      x: s.anchorX + inward,
      y: s.y - 0.8,
      class: 'pie-label',
      'text-anchor': s.side === 'right' ? 'start' : 'end',
      'data-slice': String(s.index),
    });
    name.textContent = s.datum.label;
    const value = svgEl('text', {
      x: s.anchorX + inward,
      y: s.y + 4.8,
      class: 'pie-pct',
      'text-anchor': s.side === 'right' ? 'start' : 'end',
      'data-slice': String(s.index),
    });
    value.textContent = pct(s.frac, 2);
    svg.append(name, value);
  }

  return svg;
}
