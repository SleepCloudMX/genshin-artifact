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
  /**
   * 这一行与上面几行**不是同一类**（如「质量分布」浮框里的累计概率：
   * 它读的是曲线、走右轴），上面拉一道分隔线。
   */
  sep?: boolean;
}

/**
 * 浮框内的**横排柱状图**的一行：条长由 `fraction` 决定。
 *
 * 用横排而不是竖排，是因为浮框是窄条（`max-width: 300px`），
 * 竖着画柱状图只能放下两三根；横排一行一根，档数多也不挤。
 * 颜色沿用图上的命中档配色，看起来是同一个东西。
 */
export interface TooltipBar {
  /** 左侧文字（通常是「命中 2 次」） */
  label: string;
  /** 条长比例，0~1（通常是该行的概率） */
  fraction: number;
  /** 右侧文字（通常是百分数） */
  value: string;
  /** 条的颜色，省略则用主色 */
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
  /** 横排柱状图；省略则不画 */
  bars?: TooltipBar[];
  /** 柱状图上方的小标题，用来交代这一组条的口径 */
  barsCaption?: string;
  /** 分隔线之后的补充说明 */
  footer?: string;
}

/** 浮框与光标的间距：太小会贴上指针，太大又离得远 */
const OFFSET = 14;
const EDGE = 8;

export class Tooltip {
  private readonly node: HTMLDivElement;
  private frame = 0;
  private pending: { x: number; y: number } | null = null;

  constructor(private readonly host: HTMLElement) {
    const node = document.createElement('div');
    node.className = 'tooltip';
    node.setAttribute('role', 'tooltip');
    node.hidden = true;
    host.append(node);
    this.node = node;
  }

  /** 显示浮框；`(x, y)` 是**光标的视口坐标** */
  show(content: TooltipContent, x: number, y: number): void {
    this.node.replaceChildren(build(content));
    this.node.hidden = false;
    this.move(x, y);
  }

  /** 更新位置；同一帧内多次调用只会重排一次 */
  move(x: number, y: number): void {
    this.pending = { x, y };
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const p = this.pending;
      if (!p) return;
      this.place(p.x, p.y);
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
   * 摆在光标**右下方**并留出 `OFFSET` 的间距；右/下越界就翻到另一侧。
   *
   * 是整体平移一个间距，**不是**以光标为中线对齐 —— 后者会让浮框的某一边
   * 正好压在指针上（作者指出过"紧贴光标、与边框重叠"）。
   */
  private place(clientX: number, clientY: number): void {
    const box = this.node.getBoundingClientRect();
    let left = clientX + OFFSET;
    let top = clientY + OFFSET;

    // 右/下越界就翻到另一侧
    if (left + box.width > window.innerWidth - EDGE) left = clientX - OFFSET - box.width;
    if (top + box.height > window.innerHeight - EDGE) top = clientY - OFFSET - box.height;

    // 仍然越界（浮框比视口还大）就贴边
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
      line.className = row.sep ? 'tt-row tt-row-sep' : 'tt-row';

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

  if (content.bars && content.bars.length > 0) {
    const chart = document.createElement('div');
    chart.className = 'tt-chart';

    if (content.barsCaption) {
      const cap = document.createElement('div');
      cap.className = 'tt-chart-cap';
      cap.textContent = content.barsCaption;
      chart.append(cap);
    }

    for (const bar of content.bars) {
      const line = document.createElement('div');
      line.className = 'tt-bar';

      const label = document.createElement('span');
      label.className = 'tt-bar-label';
      label.textContent = bar.label;

      // 条：外层是定宽轨道（`flex: 1`），内层按比例给宽度。
      // 极小值靠 CSS 的 `min-width` 保底，不在这里做「最小可见宽度」的补偿，
      // 否则条长就不再等于数值了。
      const track = document.createElement('span');
      track.className = 'tt-bar-track';
      const fill = document.createElement('span');
      fill.className = 'tt-bar-fill';
      const fraction = Math.min(Math.max(bar.fraction, 0), 1);
      fill.style.width = `${fraction * 100}%`;
      if (bar.color) fill.style.background = bar.color;
      track.append(fill);

      const value = document.createElement('span');
      value.className = 'tt-bar-value';
      value.textContent = bar.value;

      line.append(label, track, value);
      chart.append(line);
    }
    frag.append(chart);
  }

  if (content.footer) {
    const foot = document.createElement('div');
    foot.className = 'tt-foot';
    foot.textContent = content.footer;
    frag.append(foot);
  }

  return frag;
}
