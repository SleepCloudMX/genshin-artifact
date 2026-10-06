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
  /** 副标题，省略则不画 */
  subtitle?: string;
  rows: TooltipRow[];
  /** 分隔线之后的补充说明 */
  footer?: string;
}

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

  /** 在 (x, y) 处显示（坐标相对 `host`，通常直接传鼠标事件的 clientX/Y） */
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

  private place(clientX: number, clientY: number): void {
    const hostBox = this.host.getBoundingClientRect();
    // 节点 position: fixed，所以直接用视口坐标，不用再减 hostBox
    void hostBox;
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

  const title = document.createElement('div');
  title.className = 'tt-title';
  title.textContent = content.title;
  frag.append(title);

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
