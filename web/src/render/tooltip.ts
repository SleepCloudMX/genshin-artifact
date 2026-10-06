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
/** 从锚点往哪个方向摆 */
export type Side = 'right' | 'left' | 'auto';

export class Tooltip {
  private readonly node: HTMLDivElement;
  private frame = 0;
  private pending: { x: number; y: number; prefer?: Side } | null = null;

  constructor(private readonly host: HTMLElement) {
    const node = document.createElement('div');
    node.className = 'tooltip';
    node.setAttribute('role', 'tooltip');
    node.hidden = true;
    host.append(node);
    this.node = node;
  }

  /**
   * 在**图表数据点**对应的屏幕位置显示浮框。
   *
   * `svg` 是该图的根节点，`(x, y)` 是相对该 SVG `viewBox` 的坐标。
   * 之所以要这套换算：浮框必须和竖线、高亮点长在同一个位置上，
   * 跟着鼠标走会让三者互相错位（用户一眼就能看出来）。
   *
   * 摆放规则：默认摆在锚点右侧；右边界放不下就翻到左侧；
   * 竖直方向以锚点为中心，越界则贴边。`prefer` 可以强制左右。
   */
  showAt(
    svg: SVGSVGElement,
    x: number,
    y: number,
    content: TooltipContent,
    prefer: Side = 'auto',
  ): void {
    this.node.replaceChildren(build(content));
    this.node.hidden = false;

    const box = svg.getBoundingClientRect();
    const scale = box.width > 0 ? box.width / (svg.viewBox.baseVal.width || box.width) : 1;
    const left = box.left + x * scale;
    const top = box.top + y * scale;
    // 先量一次浮框尺寸，再决定翻不翻转（`place` 里还要按实际尺寸夹一次边）
    const size = this.node.getBoundingClientRect();
    const wantLeft = prefer === 'left' || (prefer === 'auto' && left + GAP + size.width > window.innerWidth - EDGE);

    this.move(wantLeft ? left - GAP : left + GAP, top, wantLeft ? 'left' : 'right');
  }

  /** 更新位置；同一帧内多次调用只会重排一次 */
  move(clientX: number, clientY: number, prefer: Side = 'auto'): void {
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
   * `clientX/clientY` 既是「浮框的锚点」也是「摆放的参考点」：
   * 水平方向按 `prefer` 决定往左还是往右让开，竖直方向以它为中线。
   * 这样调用方只要给出数据点的屏幕坐标，不必关心浮框多大。
   */
  private place(clientX: number, clientY: number, prefer: Side): void {
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
