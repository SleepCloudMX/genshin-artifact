/**
 * 悬停浮框。
 *
 * 原生 `<title>` 的提示要等 1 秒左右才出现、样式不可控、也无法跟随指针，
 * 所以这里自己实现一个：一个共享的 `div`，绝对定位跟随鼠标，
 * 用 `requestAnimationFrame` 节流，避免 `mousemove` 高频触发重排。
 */

export interface TooltipRow {
  /** 左侧文字（通常是「命中 3 次」） */
  label: string;
  /** 右侧文字（通常是概率） */
  value: string;
  /** 左侧色块颜色，省略则不画色块 */
  color?: string;
}

export interface TooltipContent {
  /** 标题（通常是「14.6 分」） */
  title: string;
  /** 右上角的高亮数值（通常是概率）。标题行左、它右，对齐同一行 */
  badge?: string;
  /** 副标题，省略则不画 */
  subtitle?: string;
  rows: TooltipRow[];
  /** 分隔线之后的补充说明 */
  footer?: string;
}

const GAP = 12;
const EDGE = 8;
/**
 * 浮框锚点：**跟光标**（默认）或**跟数据点**。
 *
 * - `'cursor'`：中规中矩的悬浮提示，位置随指针走。**这是界面上的默认行为**。
 *   最初就是这么做的，作者明确要求保持。
 * - `'data'`：锚在数据点的 viewBox 坐标上。
 *
 * 注意：**「交互点与光标不一致」是命中测试的问题**（哪一列被点亮），
 * 不是浮框位置的问题 —— 别用改浮框位置去治它。见 `charts.ts` 里每列热区的注释。
 */
export type Anchor = 'cursor' | 'data';

/** 水平方向往哪边让开 */
export type Prefer = 'right' | 'left' | 'auto';

export class Tooltip {
  private readonly node: HTMLDivElement;
  private frame = 0;
  private pending: { x: number; y: number; prefer?: Prefer } | null = null;

  constructor(private readonly host: HTMLElement) {
    const node = document.createElement('div');
    node.className = 'tooltip';
    node.setAttribute('role', 'tooltip');
    node.hidden = true;
    host.append(node);
    this.node = node;
  }

  /**
   * 显示浮框。**默认跟光标**（`anchor: 'cursor'`）—— 这是界面上的标准行为。
   *
   * `anchor: 'data'` 时才用 `(x, y)`（相对该 SVG `viewBox` 的坐标）当锚点。
   */
  show(
    content: TooltipContent,
    at: {
      anchor?: Anchor;
      clientX: number;
      clientY: number;
      /** 仅 nchor: 'data' 时使用 */
      svg?: SVGSVGElement;
      x?: number;
      y?: number;
      prefer?: Prefer;
    },
  ): void {
    this.node.replaceChildren(build(content));
    this.node.hidden = false;

    const prefer = at.prefer ?? 'auto';
    if (at.anchor === 'data' && at.x !== undefined && at.y !== undefined && at.svg) {
      const box = at.svg.getBoundingClientRect();
      const scale = box.width > 0 ? box.width / (at.svg.viewBox.baseVal.width || box.width) : 1;
      const left = box.left + at.x * scale;
      const top = box.top + at.y * scale;
      const size = this.node.getBoundingClientRect();
      const wantLeft =
        prefer === 'left' || (prefer === 'auto' && left + GAP + size.width > window.innerWidth - EDGE);
      this.move(wantLeft ? left - GAP : left + GAP, top, wantLeft ? 'left' : 'right');
      return;
    }

    this.move(at.clientX + GAP, at.clientY + GAP, prefer);
  }

  /** 更新位置；同一帧内多次调用只会重排一次 */
  move(clientX: number, clientY: number, prefer: Prefer = 'auto'): void {
    this.pending = { x: clientX, y: clientY, prefer };
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const p = this.pending;
      if (!p) return;
      this.place(p.x, p.y, p.prefer ?? 'auto');
    });
  }

  hide(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.pending = null;
    this.node.hidden = true;
  }

  dispose(): void {
    this.hide();
    this.node.remove();
  }

  /**
   * `clientX/clientY` 是**摆放的参考点**（对 `cursor` 锚点来说就是光标位置，
   * 且调用方已经加好让开的间距）。水平按 `prefer` 决定以它左边缘还是右边缘对齐，
   * 竖直以它为中线，越界贴边。
   */
  private place(clientX: number, clientY: number, prefer: Prefer): void {
    const box = this.node.getBoundingClientRect();
    const goLeft = prefer === 'left';
    let left = goLeft ? clientX - box.width : clientX;
    let top = clientY - box.height / 2;

    // 越界就贴边（浮框比视口还大时也只能贴边）
    left = Math.max(EDGE, Math.min(left, window.innerWidth - box.width - EDGE));
    top = Math.max(EDGE, Math.min(top, window.innerHeight - box.height - EDGE));

    this.node.style.left = `${Math.round(left)}px`;
    this.node.style.top = `${Math.round(top)}px`;
  }
}

function build(content: TooltipContent): DocumentFragment {
  const frag = document.createDocumentFragment();

  // 标题行：左边标题，右上角是高亮数值（概率）
  const head = document.createElement('div');
  head.className = 'tt-head';
  const title = document.createElement('span');
  title.className = 'tt-title';
  title.textContent = content.title;
  head.append(title);
  if (content.badge) {
    const badge = document.createElement('span');
    badge.className = 'tt-badge';
    badge.textContent = content.badge;
    head.append(badge);
  }
  frag.append(head);

  if (content.subtitle) {
    const sub = document.createElement('div');
    sub.className = 'tt-sub';
    sub.textContent = content.subtitle;
    frag.append(sub);
  }

  if (content.rows.length > 0) {
    const table = document.createElement('div');
    table.className = 'tt-rows';
    for (const row of content.rows) {
      const line = document.createElement('div');
      line.className = 'tt-row';

      if (row.color) {
        const dot = document.createElement('span');
        dot.className = 'tt-dot';
        dot.style.background = row.color;
        line.append(dot);
      }
      const label = document.createElement('span');
      label.className = 'tt-label';
      label.textContent = row.label;
      const value = document.createElement('span');
      value.className = 'tt-value';
      value.textContent = row.value;

      line.append(label, value);
      table.append(line);
    }
    frag.append(table);
  }

  if (content.footer) {
    const foot = document.createElement('div');
    foot.className = 'tt-foot';
    foot.textContent = content.footer;
    frag.append(foot);
  }

  return frag;
}
