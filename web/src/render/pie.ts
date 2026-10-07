/**
 * 环形图：用于「组合概率」这类「几块加起来正好是 1」的数据。
 *
 * 手写 SVG 扇形，悬停整块高亮。不用 canvas 是为了沿用同一套 CSS 变量配色，
 * 并能直接被测试断言。
 *
 * ## 版式（照 `docs/ai-ref/v1/init_stats.py` 的 `plot_attr_pie` 抄）
 *
 * - **名字画在图外**，从扇区中缝引一条细线过去；**百分比画在圆环里**（0.8R 处）。
 *   这样图外只有一行文字，不会像「名字 + 百分比」两行那样把四周塞满。
 * - **起点固定在左上角**（140°，逆时针铺开）：得分最高的那一项概率最小、
 *   扇区最窄，固定摆在左上角，它的标签才永远有地方放 —— 参考图的 `startangle=140`
 *   配合「按概率升序画」正是这个效果。
 * - 扇区顺序**按概率升序**（最小的先画），于是从左上角逆时针走过去，扇区越来越大，
 *   最大的那个正好收在起点旁边。
 * - 窄到写不下百分比的扇区，百分比改写到图外标签的第二行 —— 否则 0.16% 这种
 *   小扇区上既看不见数字，图外也没地方读。
 *
 * 标签会**避让**：同一侧按 y 排序后强制拉开最小间距，否则相邻的两个小扇区会叠在一起。
 */

import { pct } from '../ui/format';
import { categoricalColor } from './charts';
import type { Tooltip, TooltipRow } from './tooltip';

export interface PieDatum {
  /** 展示名 */
  label: string;
  /** 概率（分片之和应为 1） */
  p: number;
  /** 颜色；省略则按索引取分类色盘（`charts.CATEGORICAL_COLORS`） */
  color?: string;
  /** 是否从圆心「摘出来」（「组合概率」里是有效词条全齐、得分最高的那一项） */
  explode?: boolean;
  /**
   * 悬停时补在标题行下面的几行。
   *
   * **只放这张图上读不到的**（如「得分 = 10」）——
   * 名字与概率已经在图上标出来了，再往浮框里抄一遍就是废话。
   */
  rows?: TooltipRow[];
}

export interface PieOptions {
  items: PieDatum[];
  title: string;
  /** 圆心留空的半径比例，0 即实心饼 */
  innerRatio?: number;
  tooltip: Tooltip;
}

const NAMESPACE = 'http://www.w3.org/2000/svg';
/** 画布是横的：左右各留出名字的位置。片数多时（16 片）标签列会很高，所以画得高一点 */
const VIEW_W = 184;
const VIEW_H = 116;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const R = 34;
/** 起点：左上角（与 matplotlib 的 `startangle=140` 同一个位置） */
const START_DEG = 140;
/** 摘出来的扇区沿中缝外移多少 */
const EXPLODE = 4;
/** 名字的锚点半径 */
const LABEL_R = R + 5;
/** 圆环里百分比所在半径 */
const PCT_R = 0.8;
/** 同侧标签之间的最小竖直间距 */
const MIN_GAP = 6.4;
/** 图外标签是一行还是两行 */
const LINE_H = 5.2;

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NAMESPACE, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const f = (x: number): string => x.toFixed(2);

/**
 * 视觉角度（逆时针、y 轴朝上的习惯，与 matplotlib 一致）→ 屏幕坐标。
 *
 * SVG 的 y 朝下，所以这里做一次翻转；扇区一律按**角度增大 = 视觉逆时针**来铺，
 * 这样「起点 140°」之类的说法与参考实现是同一套。
 */
function point(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

/** 一段圆环：外弧逆时针，内弧顺时针兜回来 */
function arcPath(fromDeg: number, toDeg: number, innerR: number): string {
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  const [x0, y0] = point(R, fromDeg);
  const [x1, y1] = point(R, toDeg);
  if (innerR <= 0) {
    return `M${CX},${CY} L${f(x0)},${f(y0)} A${R},${R} 0 ${large} 0 ${f(x1)},${f(y1)} Z`;
  }
  const [ix1, iy1] = point(innerR, toDeg);
  const [ix0, iy0] = point(innerR, fromDeg);
  return (
    `M${f(x0)},${f(y0)} A${R},${R} 0 ${large} 0 ${f(x1)},${f(y1)} ` +
    `L${f(ix1)},${f(iy1)} A${innerR},${innerR} 0 ${large} 1 ${f(ix0)},${f(iy0)} Z`
  );
}

interface Slice {
  datum: PieDatum;
  /** 在 `items` 里的下标（颜色与测试断言都用它） */
  index: number;
  frac: number;
  fromDeg: number;
  toDeg: number;
  /** 中缝角度 */
  midDeg: number;
  offset: number;
  side: 'left' | 'right';
  /** 标签锚点（图外、在自己那条中缝的延长线上） */
  x: number;
  /** 标签首行 y（避让后） */
  y: number;
  /** 百分比是否写在圆环里（窄扇区写不下，改到图外第二行） */
  pctInside: boolean;
}

/** 同侧标签避让：按 y 拉开最小间距，再整体收进画布 */
function dodge(slices: Slice[]): void {
  slices.sort((a, b) => a.y - b.y);
  for (let i = 1; i < slices.length; i++) {
    const prev = slices[i - 1]!;
    const cur = slices[i]!;
    if (cur.y - prev.y < MIN_GAP) cur.y = prev.y + MIN_GAP;
  }
  // 标签都是**一行**（名字 + 百分比各占一列），所以半高就是 LINE_H / 2
  const half = LINE_H / 2;
  const last = slices[slices.length - 1];
  const first = slices[0];
  if (last && last.y + half > VIEW_H - 2) {
    const shift = last.y + half - (VIEW_H - 2);
    for (const s of slices) s.y -= shift;
  }
  if (first && first.y - half < 2) {
    const shift = 2 - (first.y - half);
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

  // 扇区：起点固定在左上角，按 items 顺序逆时针铺开
  const slices: Slice[] = [];
  let angle = START_DEG;
  items.forEach((datum, index) => {
    const frac = datum.p / total;
    if (frac <= 0) return;
    const fromDeg = angle;
    const toDeg = angle + frac * 360;
    angle = toDeg;
    const midDeg = (fromDeg + toDeg) / 2;
    const offset = datum.explode ? EXPLODE : 0;
    const cos = Math.cos((midDeg * Math.PI) / 180);
    // 圆环在 0.8R 处的弧长够不够写下这串百分比（一个字符约 1.8 单位）
    const arcAtPct = 2 * Math.PI * PCT_R * R * frac;
    const pctInside = arcAtPct >= pct(frac, 2).length * 1.8 + 3;
    const [ax, ay] = point(LABEL_R + offset, midDeg);
    slices.push({
      datum,
      index,
      frac,
      fromDeg,
      toDeg,
      midDeg,
      offset,
      side: cos >= 0 ? 'right' : 'left',
      x: ax,
      y: ay,
      pctInside,
    });
  });
  dodge(slices.filter((s) => s.side === 'left'));
  dodge(slices.filter((s) => s.side === 'right'));

  // --- 扇区 ---
  for (const s of slices) {
    const path = svgEl('path', {
      d: arcPath(s.fromDeg, s.toDeg, innerR),
      fill: s.datum.color ?? categoricalColor(s.index),
      class: 'pie-slice',
      'data-slice': String(s.index),
    });
    if (s.offset > 0) {
      const [dx, dy] = point(s.offset, s.midDeg);
      path.setAttribute('transform', `translate(${f(dx - CX)},${f(dy - CY)})`);
      path.classList.add('exploded');
      path.setAttribute('data-explode', '1');
    }
    path.addEventListener('mouseenter', (ev) => {
      tooltip.show(
        {
          title: s.datum.label,
          badge: pct(s.frac, 2),
          rows: s.datum.rows ?? [],
        },
        ev.clientX,
        ev.clientY,
      );
    });
    path.addEventListener('mousemove', (ev) => tooltip.move(ev.clientX, ev.clientY));
    path.addEventListener('mouseleave', () => tooltip.hide());
    svg.append(path);
  }

  // --- 圆环里的百分比 ---
  for (const s of slices) {
    if (!s.pctInside) continue;
    const [x, y] = point(PCT_R * R + s.offset, s.midDeg);
    const value = svgEl('text', {
      x: f(x),
      y: f(y + 1.1),
      class: 'pie-pct',
      'text-anchor': 'middle',
      'data-slice': String(s.index),
    });
    value.textContent = pct(s.frac, 2);
    svg.append(value);
  }

  // --- 图外的名字：一行之内「名字 + 百分比」两列，百分比贴着引线（照参考图） ---
  for (const s of slices) {
    const [wx, wy] = point(R + s.offset, s.midDeg);
    // 引线是**径向**的：从扇区外缘直着连到标签，不绕水平段
    svg.append(
      svgEl('polyline', {
        points: `${f(wx)},${f(wy)} ${f(s.x)},${f(s.y)}`,
        class: 'pie-leader',
        'data-slice': String(s.index),
      }),
    );
    const inward = s.side === 'right' ? 1.6 : -1.6;
    const anchor = s.side === 'right' ? 'start' : 'end';
    const baseline = s.y + 1.1;
    const put = (content: string, x: number, cls: string): void => {
      const t = svgEl('text', {
        x: f(x),
        y: f(baseline),
        class: cls,
        'text-anchor': anchor,
        'data-slice': String(s.index),
      });
      t.textContent = content;
      svg.append(t);
    };
    const value = pct(s.frac, 2);
    if (s.pctInside) {
      // 宽度够：百分比画在圆环里，图外只留名字
      put(s.datum.label, s.x + inward, 'pie-label');
    } else {
      // 写不下：百分比挪到图外，但仍在引线这一侧、名字的外面 —— 一行放得下
      const w = value.length * 1.8;
      put(value, s.x + inward, 'pie-pct');
      put(s.datum.label, s.x + inward + (s.side === 'right' ? w + 2 : -(w + 2)), 'pie-label');
    }
  }

  return svg;
}
