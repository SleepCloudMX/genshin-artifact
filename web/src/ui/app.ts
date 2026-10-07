/**
 * 界面装配。
 *
 * ## 结构
 *
 * 顶部是标题栏（标题 + 主题图标）。下面是**三栏**（两侧贴着窗口边缘，把宽度让给中间的图）：
 *   - 左：**任务树**（主任务 + 它下面的子任务）；
 *   - 中：结果，顶上一个小标题写着当前任务名，下面按**子 tab** 分页——每张图一个子 tab，
 *     切换即可，不用滚动；
 *   - 右：**这个任务的**配置（`Tab.controls`；不需要配置的任务整栏收掉）。
 *
 * ## 为什么配置按 tab 分
 *
 * 每个主 tab 是一个**独立问题**，需要的输入本来就不同：
 *   - 「得分分布」要 主词条 / 初始词条数 / 副词条与档位 / 目标分数；
 *   - 「胚子质量」只看掉落那一刻，问它「初始几条」没有意义。
 * 共享的只有**评分标准**（主词条 + 哪些副词条计分），换任务不该丢。
 * 详见 `ui/state.ts` 的两级类型划分。
 *
 * 配置放在**图表右侧**（而不是像早先那样固定在左边）是因为：配置是任务的属性，
 * 摆到右边、与任务树分列图表两侧，「这一栏配置属于谁」一眼就能看出来（作者 2026-10-07
 * 指出的问题：原来那版看起来像所有任务共用一套配置）。
 *
 * ## 子 tab 的刷新契约
 *
 * 「只渲染当前可见的那个子 tab」省掉了隐藏图表的计算，代价是需要一个明确的刷新入口：
 * 各 tab 的 `update()` 算完数据后调 `sub.refresh()`。切换子 tab 时也要调一次，
 * 否则新露出来的那张图还是上一次的内容（或空白）。
 *
 * 全部数学都在 `src/core/`，界面只负责收集输入与展示结果。
 */

import {
  SLOTS,
  SLOT_NAMES,
  SUB_ATTRS,
  GROWTH_ORDER,
  excludedAt,
  excludedSubstat,
  hasRandomMain,
  mainAttrsOf,
  type MainAttr,
  type Slot as ArtifactSlot,
  type SubAttr,
} from '../core/stats';
import {
  MAIN_ATTR_COLS,
  heatRowKey,
  mainAttrHeatmap,
  nextSubstatDist,
  substatHeatmap,
} from '../core/heatmap';
import {
  BUCKET_OPTIONS,
  bucketize,
  scoreDistribution,
  pmfByHit,
  hitProbabilities,
  hitMixAtLeast,
  probAtLeast,
  survival,
  scoreAtAlpha,
  tierLabel,
  type DistributionTable,
  type InitialRoll,
  type ScoreBucket,
} from '../core/growth';
import {
  qualityDistribution,
  qualityProbContaining,
  pieSlices,
  sameCombo,
  comboLabel,
  dropProbability,
  type QualityCombo,
  type QualityDistribution,
} from '../core/quality';
import {
  renderScoreBars,
  renderSurvival,
  renderHistogram,
  renderQualityStacked,
  categoricalColor,
  hitColor,
  type QualityBar,
} from '../render/charts';
import { renderPie } from '../render/pie';
import { renderHeatmap } from '../render/heatmap';
import { Tooltip } from '../render/tooltip';import {
  CANONICAL_WEIGHT,
  QUALITY_WEIGHT,
  QUALITY_WEIGHT_STEP,
  defaultGrowth,
  defaultQuality,
  defaultShared,
  fromQuery,
  nextWeightDown,
  nextWeightUp,
  qualityRowsInView,
  qualityUsedAttrs,
  qualityWeights,
  qualityWeightOnSelect,
  quantizeWeight,
  stepQualityWeight,
  weightOnSelect,
  selectableAttrs,
  toSpec,
  growthWeights,
  type AppState,
  type GrowthConfig,
  type QualityConfig,
  type QualityRow,
  type SharedConfig,
  type SlotInput,
} from './state';
import { oneIn, pct, score as fmtScore } from './format';
import * as C from './copy';

// ---------------------------------------------------------------------------
// DOM 小工具
// ---------------------------------------------------------------------------

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function option(value: string, label: string, selected: boolean): HTMLOptionElement {
  const el = node('option', { value }, label);
  el.selected = selected;
  return el;
}

/** 「标签 + 控件」的一行 */
function field(labelText: string, control: HTMLElement): HTMLLabelElement {
  const box = node('label', { class: 'field' });
  box.append(node('span', {}, labelText), control);
  return box;
}

function card(label: string, value: string, note?: string): HTMLElement {
  const box = node('div', { class: 'card' });
  box.append(node('div', { class: 'card-label' }, label));
  box.append(node('div', { class: 'card-value' }, value));
  if (note) box.append(node('div', { class: 'card-note' }, note));
  return box;
}

/** 面板 = 标题 +（可选）说明 + 内容 */
function panel(title: string, hint?: string): { box: HTMLElement; body: HTMLElement } {
  const box = node('section', { class: 'panel' });
  if (title) box.append(node('h2', {}, title));
  if (hint) box.append(node('p', { class: 'hint' }, hint));
  const body = node('div', { class: 'panel-body' });
  box.append(body);
  return { box, body };
}

/** 表格：`heads` 固定，`body` 每次重建 */
function dataTable(
  heads: string[],
  id?: string,
): { table: HTMLTableElement; body: HTMLTableSectionElement } {
  const table = node('table', { class: 'data', ...(id ? { id } : {}) });
  const thead = node('thead');
  const tr = node('tr');
  for (const h of heads) tr.append(node('th', {}, h));
  thead.append(tr);
  const body = node('tbody');
  table.append(thead, body);
  return { table, body };
}

function row(cells: string[]): HTMLTableRowElement {
  const tr = node('tr');
  for (const c of cells) tr.append(node('td', {}, c));
  return tr;
}

// ---------------------------------------------------------------------------
// 主题图标
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 太阳 / 月亮图标。用 SVG 而不是字符，跨平台字形不会有差异 */
function themeIcon(theme: 'light' | 'dark'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const add = (tag: string, attrs: Record<string, string>): void => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };

  if (theme === 'light') {
    // 当前是浅色 → 点击会切到深色 → 显示月亮
    add('path', { d: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z' });
  } else {
    add('circle', { cx: '12', cy: '12', r: '4' });
    add('path', { d: 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4' });
  }
  return svg;
}

/** GitHub 图标（实心，24×24）。与主题图标同样用 SVG，不用字形 */
function repoIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    'M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.57 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z',
  );
  svg.append(path);
  return svg;
}

// ---------------------------------------------------------------------------
// 子 tab
// ---------------------------------------------------------------------------

/** 一个子 tab：一张图（或一张表） */
interface SubTab {
  label: string;
  render(host: HTMLElement): void;
}

function subTabNode(label: string, id: string, active: boolean): HTMLButtonElement {
  const btn = node('button', {
    type: 'button',
    class: `subtab${active ? ' on' : ''}`,
    role: 'tab',
    id: `subtab-${id}`,
    'aria-selected': active ? 'true' : 'false',
  });
  btn.textContent = label;
  return btn;
}

// ---------------------------------------------------------------------------
// 初始档位下拉
// ---------------------------------------------------------------------------

const ROLL_CHOICES: readonly InitialRoll[] = ['random', 0, 1, 2, 3];

function rollValue(roll: InitialRoll): string {
  return roll === 'random' ? 'random' : String(roll);
}

function rollLabel(attr: SubAttr | '', roll: InitialRoll, weight: number): string {
  if (roll === 'random') return C.ROLL_RANDOM;
  // 选项必须带数值，否则用户没法判断选哪一档
  if (attr === '') return C.rollFixed(roll);
  return tierLabel(attr, roll, weight > 0 ? weight : 1);
}

/**
 * 重建档位选项。数值取决于词条与权重，所以词条或权重一变就得重建。
 * 注意：`option.selected` 在 jsdom 下不足以让 `select.value` 跟上，末尾要显式赋值。
 */
function fillRollOptions(
  sel: HTMLSelectElement,
  attr: SubAttr | '',
  weight: number,
  selected: InitialRoll,
): void {
  sel.replaceChildren();
  for (const roll of ROLL_CHOICES) {
    sel.append(option(rollValue(roll), rollLabel(attr, roll, weight), roll === selected));
  }
  sel.value = rollValue(selected);
}

// ---------------------------------------------------------------------------
// Tab 定义
// ---------------------------------------------------------------------------

interface TabCtx {
  patch(next: Partial<AppState>): void;
  tooltip: Tooltip;
  /** 子 tab 建好后登记进来：侧边栏要按任务列出「任务 → 子任务」 */
  reportSubs?(api: SubsApi): void;
  /** 当前子 tab 变了 → 让侧边栏重画高亮 */
  navChanged(): void;
}

/** 一个任务的子 tab 导航（侧边栏与图上那一排共用同一份状态） */
interface SubsApi {
  labels: string[];
  index(): number;
  select(i: number): void;
}

interface Tab {
  id: string;
  label: string;
  /**
   * 左栏……不，是**右栏**：这个任务需要什么配置。
   *
   * **省略 = 这个任务不需要配置**（如「更多」），那一栏整栏收掉。
   * 配置是任务的属性，所以它跟着任务走，而不是一组全局控件。
   */
  controls?(host: HTMLElement, ctx: TabCtx): void;
  /** 结果区骨架，首次进入时调用一次 */
  mount(host: HTMLElement, ctx: TabCtx): void;
  /** 配置栏同步（不重建节点，避免夺走输入焦点） */
  syncControls?(): void;
  /** 结果刷新 */
  update?(): void;
}

// ---------------------------------------------------------------------------

export function mount(root: HTMLElement): void {
  let state = fromQuery(location.search);
  let activeTab = 'growth';

  root.replaceChildren();
  root.dataset.mounted = '1';

  // ---- 标题栏 ----
  const hero = node('header', { class: 'hero' });
  const titleRow = node('div', { class: 'title-row' });
  titleRow.append(node('h1', {}, C.APP_TITLE));

  // 右侧图标组：源码仓库 + 主题切换。一起放在 `.title-actions` 里靠右对齐，
  // 免得 `margin-left: auto` 只作用在第一个图标上。
  const titleActions = node('div', { class: 'title-actions' });
  const repoLink = node('a', {
    class: 'icon-btn',
    id: 'repoLink',
    href: C.REPO_URL,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: C.REPO_LINK,
    'aria-label': C.REPO_LINK,
  });
  repoLink.append(repoIcon());
  const themeBtn = node('button', { type: 'button', class: 'icon-btn', id: 'themeBtn' });
  titleActions.append(repoLink, themeBtn);
  titleRow.append(titleActions);

  hero.append(titleRow);
  root.append(hero);

  // ---- 三栏：任务树 / 图表 / 这个任务的配置 ----
  const layout = node('div', { class: 'layout' });
  const sidebar = node('aside', { class: 'sidebar' });
  const tree = node('nav', { class: 'tree', 'aria-label': '任务' });
  sidebar.append(tree);
  const results = node('main', { class: 'results' });
  const panelHost = node('div', { class: 'tab-panels', id: 'tabPanels' });
  const configHost = node('aside', { class: 'config-col', id: 'config' });
  results.append(panelHost);
  layout.append(sidebar, results, configHost);

  const tooltipHost = node('div', { class: 'tooltip-host' });
  root.append(layout, tooltipHost);
  const tooltip = new Tooltip(tooltipHost);

  /** 各任务的子 tab 导航（`Tab.mount` 时登记进来，见 `SubsApi`） */
  const subsOf = new Map<string, SubsApi>();

  const ctx: TabCtx = {
    patch: (next) => setState(next),
    tooltip,
    navChanged: () => renderTree(),
  };

  // -------------------------------------------------------------------------
  // 共享控件
  // -------------------------------------------------------------------------

  /**
   * 换上新的主词条后，把「与它同名的副词条」从两份配置里剔掉。
   *
   * 两份配置各认各的口径，但它们此刻要剔的是同一条：主词条自己。
   *   - 槽位（得分分布）：`excludedAt(主词条)` —— 花 / 羽也一样（花不出小生命、羽不出小攻击）；
   *   - 权重表（胚子质量）：`excludedSubstat`，与 `core/quality.ts` 的 `qualityAttrs` 一致。
   *
   * 不剔的话，界面上会留着一行「计分」的非法词条，而 core 那边悄悄把它丢掉 ——
   * 卡片上的「有效词条 N 条」和表里的行数就对不上了。
   */
  function withoutConflicts(mainAttr: MainAttr): Pick<AppState, 'slots' | 'rows'> {
    const bad = excludedAt(mainAttr);
    const slots = state.slots.map((s) =>
      s.attr !== '' && s.attr === bad ? { ...s, attr: '' as const, weight: 0 } : { ...s },
    ) as AppState['slots'];

    // 词条表：**整行删掉**（不是清成空行）—— 这一行已经不可能成立了，留着只是噪音
    const rows = state.rows.filter((r) => r.attr === '' || r.attr !== bad);
    return { slots, rows };
  }

  /**
   * 主词条下拉：可选项由**部位**限定（火伤只有杯能出）。
   *
   * 两条口径（作者 2026-10-08 定的）：
   *   1. **花 / 羽只有一个主词条**，换过去就直接转成它（旧版把下拉锁死在旧值上，
   *      于是「杯里选火伤 → 切到花」会拿火伤当花的主词条算，副词条池也不对）；
   *   2. 沙 / 杯 / 头 之间切换时，原主词条可能在新部位不合法 —— 那时**不替用户挑**，
   *      把下拉标成浅红、把当前值原样显示出来，等用户重新选。
   */
  function mainAttrField(): { box: HTMLElement; sync(): void } {
    const sel = node('select', { id: 'mainAttr' });
    const note = node('p', { class: 'hint err', id: 'mainAttrNote' });
    note.hidden = true;
    /** 选项的重建键：部位 + 当前值合不合法（不合法时要把它作为一项列出来） */
    let bound = '';

    sel.addEventListener('change', () => {
      if (sel.disabled) return;
      const mainAttr = sel.value as MainAttr;
      setState({ mainAttr, ...withoutConflicts(mainAttr) });
    });

    function sync(): void {
      const mains = mainAttrsOf(state.slot);
      // 花 / 羽：该部位只有一个主词条 → 固定
      const fixed = mains.length === 1;
      const valid = mains.includes(state.mainAttr);
      const key = `${state.slot}|${valid ? '' : state.mainAttr}`;
      if (bound !== key) {
        bound = key;
        sel.replaceChildren();
        for (const a of mains) sel.append(option(a, a, a === state.mainAttr));
        // 不合法的当前值也要列出来，否则下拉显示不出它（用户就看不到自己选的是什么）
        if (!valid) sel.append(option(state.mainAttr, state.mainAttr, true));
      }
      sel.disabled = fixed;
      sel.classList.toggle('invalid', !valid);
      sel.value = state.mainAttr;
      if (!valid) sel.title = C.MAIN_INVALID_HINT;
      else if (fixed) sel.title = C.MAIN_FIXED_HINT;
      else sel.removeAttribute('title');
      note.textContent = valid ? '' : C.MAIN_INVALID_HINT;
      note.hidden = valid;
    }

    const box = node('label', { class: 'field' });
    box.append(node('span', {}, C.FIELD_MAIN), sel, note);

    sync();
    return { box, sync };
  }

  /** 部位下拉：决定主词条的可选项，也决定主词条概率 */
  function slotField(): { box: HTMLElement; sync(): void } {
    const sel = node('select', { id: 'slot' });
    for (const s of SLOTS) sel.append(option(s, SLOT_NAMES[s], s === state.slot));
    sel.value = state.slot;

    sel.addEventListener('change', () => {
      const slot = sel.value as ArtifactSlot;
      const mains = mainAttrsOf(slot);
      // 花 / 羽只有一个主词条 → **强制转**过去；
      // 沙 / 杯 / 头 之间切换时保留原值（可能不合法，界面标红等用户重选，见 mainAttrField）。
      // 旧版反过来：花 / 羽锁死不动，沙 / 杯 / 头 却悄悄替用户挑一个。
      const mainAttr = mains.length === 1 ? mains[0]! : state.mainAttr;
      setState({ slot, mainAttr, ...withoutConflicts(mainAttr) });
    });

    return {
      box: field(C.FIELD_SLOT, sel),
      sync() {
        sel.value = state.slot;
      },
    };
  }

  /**
   * 副词条表：词条 / 权重（+ 可选 初始档位）。
   *
   * 权重是 `−` / 数字框 / `+`：原生 number 的上下箭头太小，而这一列几乎只做小幅微调。
   * `+` 从 0 直接跳到该词条的默认权重，`−` 从默认权重直接归零——见 `state.ts`。
   *
   * **只有「得分分布」用它**：「初始档位」是强化才有的事；
   * 「胚子质量」的权重表条数不限、也不看档位，是另一张表（`qualityWeightsField`）。
   */
  function slotsField(): { box: HTMLElement; refresh(): void } {
    const box = node('div', { class: 'slots' });
    box.append(
      node('h3', { class: 'sub' }, C.SECT_SUBSTATS),
      node('p', { class: 'hint' }, C.SUBSTATS_HINT_ROLL),
    );

    const head = node('div', { class: 'slot-head' });
    head.append(node('span', {}, C.COL_ATTR), node('span', {}, C.COL_WEIGHT));
    head.append(node('span', {}, C.COL_ROLL));
    box.append(head);

    const rows = node('div', { class: 'slot-rows', id: 'slotRows' });
    box.append(rows);
    const warn = node('p', { class: 'hint warn', id: 'ignoredNote' });
    box.append(warn);

    // 一个委托接两种交互：
    //   change → 词条 / 初始档位两个下拉，**以及权重数字框**
    //   click  → 权重 − / +（按钮不产生 change，必须单独接）
    //
    // 权重框刻意**不接 `input`**：那样每敲一个字符就提交一次、整张表重建、
    // 焦点被夺走 —— 连「清空重打」都做不到，也敲不出小数点（`0.` 会被重建掉）。
    // 现在与原生表单一致：**回车或失焦才提交**。
    rows.addEventListener('change', onEdit);
    rows.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).dataset['key'] === 'step') onEdit(ev);
    });

    function onEdit(ev: Event): void {
      const t = ev.target as HTMLSelectElement | HTMLInputElement | HTMLButtonElement;
      const idxRaw = t.dataset['slot'];
      if (idxRaw === undefined) return;
      const idx = Number(idxRaw);
      const slots = state.slots.map((s) => ({ ...s })) as AppState['slots'];
      const cur = slots[idx]!;

      switch (t.dataset['key']) {
        case 'attr': {
          const attr = (t as HTMLSelectElement).value as SubAttr | '';
          const previous = cur.attr;
          cur.attr = attr;
          // 选中一个词条就给它权重初值（暴击 → 2，其余 → 1），取消则清零
          cur.weight = weightOnSelect(attr);

          // 同一个词条只能占一个槽位。界面上已经选不到重复的词条了，
          // 但分享链接里的槽位是原样读进来的（两个人手改的链接可能带重复），
          // 所以这里保留一条兜底：真撞上了就让两条互换。
          const dup = slots.findIndex((s, i) => i !== idx && s.attr === attr);
          if (attr !== '' && dup >= 0) {
            const other = slots[dup]!;
            other.attr = previous;
            other.weight = weightOnSelect(previous);
          }
          break;
        }
        case 'weight': {
          const raw = (t as HTMLInputElement).value.trim();
          // 允许中间态（空串 / 只有负号）：按 0 处理，交给 toSpec 忽略，不要在这里抛错。
          // 归整到两位小数是**权重的唯一精度口径**，见 state.quantizeWeight。
          cur.weight = raw === '' ? 0 : quantizeWeight(Number(raw));
          break;
        }
        case 'step': {
          const delta = Number(t.dataset['delta']);
          // 读**输入框当前值**，不是 state 里的值：用户可能刚手动改过数字框，
          // 而那一步还没进 state。以输入框为准，「按了没反应」这类错位就不可能发生。
          const cur_input = t.parentElement?.querySelector<HTMLInputElement>('input[data-key="weight"]');
          const from = Number(cur_input?.value ?? cur.weight);
          const base = Number.isFinite(from) ? from : cur.weight;
          const canonical = cur.attr === '' ? 0 : CANONICAL_WEIGHT[cur.attr];
          cur.weight = delta > 0 ? nextWeightUp(base, canonical) : nextWeightDown(base, canonical);
          break;
        }
        case 'roll': {
          const raw = (t as HTMLSelectElement).value;
          cur.initialRoll = raw === 'random' ? 'random' : (Number(raw) as InitialRoll);
          break;
        }
        default:
          return;
      }
      setState({ slots });
    }

    /**
     * 行结构的指纹：**主词条 + 每行的词条**。
     *
     * 它决定下拉里有哪些选项，也就决定「能不能原地改」——权重和档位只是值，
     * 原地写回即可。
     */
    let structure = '';

    function structureOf(): string {
      return `${state.mainAttr}|${state.slots.map((s) => s.attr).join(',')}`;
    }

    function render(): void {
      const allowed = selectableAttrs(state.mainAttr);
      rows.replaceChildren();
      state.slots.forEach((slot, i) => {
        const r = node('div', { class: 'slot-row' });

        const sel = node('select', { 'data-slot': String(i), 'data-key': 'attr' });
        sel.append(option('', C.NOT_SCORED, slot.attr === ''));
        // 一个词条只能占一个槽位：**已经被别的槽位选走的词条不再列出来**
        // （作者：列出来却点不了是反人类设计）。自己的那一项留着，否则下拉显示不出当前值。
        const taken = state.slots.filter((_, k) => k !== i).map((s) => s.attr);
        for (const a of allowed) {
          if (a !== slot.attr && taken.includes(a)) continue;
          sel.append(option(a, a, a === slot.attr));
        }
        // 词条可能已不可选（主词条被改成同名词条），退回「不计分」，
        // 与 toSpec 对冲突词条的处理一致
        sel.value = allowed.includes(slot.attr as SubAttr) ? slot.attr : '';

        const stepper = node('div', { class: 'stepper' });
        const minus = node(
          'button',
          {
            type: 'button',
            class: 'step',
            'data-slot': String(i),
            'data-key': 'step',
            'data-delta': '-1',
            'aria-label': C.ARIA_WEIGHT_DOWN,
          },
          '−',
        );
        const input = node('input', {
          type: 'number',
          min: '0',
          step: '0.1',
          inputmode: 'decimal',
          'data-slot': String(i),
          'data-key': 'weight',
          'aria-label': C.ariaWeightOf(slot.attr, i),
        });
        input.value = String(slot.weight);
        const plus = node(
          'button',
          {
            type: 'button',
            class: 'step',
            'data-slot': String(i),
            'data-key': 'step',
            'data-delta': '1',
            'aria-label': C.ARIA_WEIGHT_UP,
          },
          '+',
        );
        stepper.append(minus, input, plus);

        const roll = node('select', { 'data-slot': String(i), 'data-key': 'roll' });
        fillRollOptions(roll, slot.attr, slot.weight, slot.initialRoll);

        r.append(sel, stepper, roll);
        rows.append(r);
        syncRow(r, slot);
      });
      structure = structureOf();
    }

    /**
     * 不重建，只把 state 写回既有行。
     *
     * 正在被编辑的那个输入框**不覆盖**：回车提交时焦点还在框里，
     * 覆盖会让光标跳到末尾（连续微调时很别扭）。
     */
    function syncRows(): void {
      state.slots.forEach((slot, i) => {
        const r = rows.children[i] as HTMLElement | undefined;
        if (!r) return;
        const sel = r.querySelector<HTMLSelectElement>('select[data-key="attr"]');
        if (sel && sel.value !== slot.attr) sel.value = slot.attr;
        const input = r.querySelector<HTMLInputElement>('input[data-key="weight"]');
        if (input && document.activeElement !== input) input.value = String(slot.weight);
        syncRow(r, slot);
      });
    }

    /** 减号在 0 处禁用；档位下拉的标签跟着词条与权重走 */
    function syncRow(r: HTMLElement, slot: SlotInput): void {
      const minus = r.querySelector<HTMLButtonElement>('.step[data-delta="-1"]');
      if (minus) minus.disabled = !(slot.weight > 0);
      const roll = r.querySelector<HTMLSelectElement>('select[data-key="roll"]');
      if (roll) fillRollOptions(roll, slot.attr, slot.weight, slot.initialRoll);
    }

    return {
      box,
      refresh() {
        // 只有结构变了才重建。**不能无条件重建**：权重框失焦提交时还没事，
        // 但回车提交时焦点仍在框里，重建会把它摘掉，下一次输入就落空了。
        if (structureOf() === structure) syncRows();
        else render();
        warn.textContent = C.ignoredNote(toSpec(state).ignored);
      },
    };
  }

  interface Control {
    box: HTMLElement;
    /** 把 state 同步到既有节点上（**不重建**，避免夺走输入焦点） */
    sync(): void;
  }

  /**
   * 「胚子质量」的词条权重表：**一份用户自己增删的清单**，条数不限。
   *
   * 与「得分分布」那张表的区别：
   *   - 那边是「4 个槽位」——胚子终态就是 4 条副词条，槽位顺序还有语义（决定 3 词条胚子
   *     的第 4 条是谁），所以必须定长、必须带「初始档位」；
   *   - 这一页统计的是「这些词条长在胚子上的情况」，关心一条还是十条都行。
   *
   * 三条交互口径（作者定的，别改回去）：
   *   1. **删除只走 ×**：权重减到 0 只是「这条暂时不计分」，行还在表里。
   *      旧版把「权重归零」当成删除，于是「按减号有时候直接没了」，很反直觉；
   *   2. **「+ 添加词条」在最后追加一行**：不替用户猜词条（旧版取「剩下第一条」，
   *      看着像随机添加、还因为按 `SUB_ATTRS` 排序而插到最前面），
   *      新行的词条是空的、权重 1，**选之前不参与绘图**；
   *   3. **表按权重从高到低排**（同权重保持添加顺序，空行垫底）。
   *      权重一改行可能换位置，所以重建后要把焦点还回同一个控件（见 `refocus`）。
   *
   * 权重就是**分**，不乘成长值；默认口径是暴击 3 / 暴伤 3 / 精通 2 / 大攻击 2。
   * 候选集由 `selectableAttrs` 给出：主词条自己不能当副词条（`爆伤` / `暴伤` 也算同一条），
   * 表里已经有的词条**不出现在下拉里**（列出来却点不了是反人类设计，作者要求删掉）。
   */
  function qualityWeightsField(): { box: HTMLElement; refresh(): void } {
    const box = node('div', { class: 'slots' });
    box.append(
      node('h3', { class: 'sub' }, C.SECT_SUBSTATS),
      node('p', { class: 'hint' }, C.QUALITY_WEIGHTS_HINT),
    );
    const head = node('div', { class: 'slot-head three-col' });
    // 第三列是 × 的位置，表头留空
    head.append(node('span', {}, C.COL_ATTR), node('span', {}, C.COL_WEIGHT), node('span', {}, ''));
    box.append(head);

    const rows = node('div', { class: 'slot-rows', id: 'qualityRows' });
    const add = node(
      'button',
      { type: 'button', class: 'ghost small add-row', id: 'addQualityAttr' },
      C.ADD_ATTR,
    );
    box.append(rows, add);

    /** 还能加进来的词条：不是主词条、也还不在表里 */
    function freeAttrs(): SubAttr[] {
      const used = new Set(qualityUsedAttrs(state.rows));
      return selectableAttrs(state.mainAttr).filter((a) => !used.has(a));
    }

    /**
     * 加一行：**追加在最后、默认不选词条、权重 1**。
     *
     * 不替用户猜词条（旧版「取剩下第一条」看着就像随机加的）；这一行在用户选之前
     * 不参与绘图（`qualityWeights` 忽略空行）。空行永远排在表尾，见 `qualityRowsInView`。
     */
    add.addEventListener('click', () => {
      if (freeAttrs().length === 0) return;
      setState({ rows: [...state.rows, { attr: '', weight: 1 }] });
    });

    /**
     * 行结构的指纹：**主词条 + 有哪些行**（行的标识**排序后**再拼，与先后无关）。
     *
     * 标识只认「这一行是哪个词条」（空行按出现次序编号，因为空行永远垫底、相对次序不变）。
     * 指纹里**不含顺序**是有意的：只改了权重时，变化的只有顺序 ——
     * 那时不必重建，把节点按新顺序搬一遍就行，正在输入的那个框连焦点带光标都原样留着。
     */
    let structure = '';

    function keyOf(view: readonly QualityRow[]): string[] {
      let empty = 0;
      return view.map((r) => (r.attr === '' ? `e:${empty++}` : `a:${r.attr}`));
    }

    function structureOf(): string {
      return `${state.mainAttr}|${keyOf(qualityRowsInView(state.rows)).sort().join(',')}`;
    }

    /** DOM 上的行序 = 显示顺序：把这个下标写回每个控件，事件处理靠它认行 */
    function stampRows(): void {
      [...rows.children].forEach((child, i) => {
        for (const el of child.querySelectorAll<HTMLElement>('[data-key]')) {
          el.dataset['row'] = String(i);
        }
      });
    }

    /**
     * 只改了权重时：把行按新顺序排好，**但不重建任何节点**。
     *
     * 用「最少移动」的排法（从后往前，已经在该在的位置上就不碰）：
     * 一个节点被移出再插回会掉焦点，而这里通常只需要挪动别的行 ——
     * 正在输入的那一行原地不动，焦点与光标都是原样。
     * 万一那一行自己确实要挪位（焦点掉了），搬完再还给它。
     */
    function reorder(view: readonly QualityRow[]): void {
      const byKey = new Map<string, Element>();
      for (const child of [...rows.children]) {
        byKey.set((child as HTMLElement).dataset['rowKey'] ?? '', child);
      }
      const target = keyOf(view)
        .map((k) => byKey.get(k))
        .filter((el): el is Element => el !== undefined);
      const active = document.activeElement as HTMLElement | null;
      const hadFocus = active && rows.contains(active) ? active : null;

      let ref: Element | null = null;
      for (let i = target.length - 1; i >= 0; i--) {
        const el = target[i]!;
        const inPlace = ref ? ref.previousElementSibling === el : rows.lastElementChild === el;
        if (!inPlace) rows.insertBefore(el, ref);
        ref = el;
      }
      stampRows();
      if (hadFocus && document.activeElement !== hadFocus) hadFocus.focus();
    }

    /** 重建表格（行数、词条、主词条变了才走这里） */
    function render(): void {
      const view = qualityRowsInView(state.rows);
      const keys = keyOf(view);
      const allowed = selectableAttrs(state.mainAttr);
      const used = qualityUsedAttrs(view);
      rows.replaceChildren();
      view.forEach((row, i) => {
        const r = node('div', { class: 'slot-row three-col' });
        r.dataset['rowKey'] = keys[i]!;

        const sel = node('select', { 'data-key': 'qattr' });
        sel.append(option('', C.NOT_SCORED, row.attr === ''));
        for (const a of allowed) {
          // 已经被别的行占着的词条**直接不列出来**（作者要求：留着但点不了是反人类设计）。
          // 自己那一行占着的仍要列，否则下拉的当前值对不上 state。
          if (a !== row.attr && used.includes(a)) continue;
          sel.append(option(a, a, a === row.attr));
        }
        sel.value = row.attr;

        const stepper = node('div', { class: 'stepper' });
        const step = (delta: -1 | 1): HTMLButtonElement =>
          node(
            'button',
            {
              type: 'button',
              class: 'step',
              'data-key': 'qstep',
              'data-delta': String(delta),
              'aria-label': delta > 0 ? C.ARIA_WEIGHT_UP : C.ARIA_WEIGHT_DOWN,
            },
            delta > 0 ? '+' : '−',
          );
        const input = node('input', {
          type: 'number',
          min: '0',
          step: String(QUALITY_WEIGHT_STEP),
          inputmode: 'decimal',
          'data-key': 'qweight',
          'aria-label': C.ariaWeightOf(row.attr, i),
        });
        input.value = String(row.weight);
        stepper.append(step(-1), input, step(1));

        // 删除：**只有这个叉号会删行**（权重减到 0 不再顺手把行抹掉）
        const del = node(
          'button',
          {
            type: 'button',
            class: 'row-del',
            'data-key': 'qdel',
            'aria-label': C.ARIA_ROW_DELETE,
            title: C.ARIA_ROW_DELETE,
          },
          '×',
        );

        r.append(sel, stepper, del);
        rows.append(r);
      });
      stampRows();
      structure = structureOf();
      syncAdd();
    }

    /** 只是数值变了：不重建行，只写回（正在编辑的那个框不覆盖，避免光标跳到末尾） */
    function syncRows(): void {
      const view = qualityRowsInView(state.rows);
      view.forEach((row, i) => {
        const r = rows.children[i] as HTMLElement | undefined;
        if (!r) return;
        const input = r.querySelector<HTMLInputElement>('input[data-key="qweight"]');
        if (input && document.activeElement !== input) input.value = String(row.weight);
        const minus = r.querySelector<HTMLButtonElement>('.step[data-delta="-1"]');
        if (minus) minus.disabled = !(row.weight > 0);
      });
      syncAdd();
    }

    /** 加号：没有可加的词条时禁用（并说明为什么） */
    function syncAdd(): void {
      const free = freeAttrs();
      add.disabled = free.length === 0;
      add.title = free.length === 0 ? C.ADD_ATTR_NONE : C.ADD_ATTR_TITLE;
    }

    // 与「得分分布」同一套提交时机：**回车 / 失焦才提交**（见 slotsField 的注释），
    // 步进按钮读输入框的当前值而不是 state。
    rows.addEventListener('change', onEdit);
    rows.addEventListener('click', (ev) => {
      const key = (ev.target as HTMLElement).dataset['key'];
      if (key === 'qstep' || key === 'qdel') onEdit(ev);
    });

    function onEdit(ev: Event): void {
      const t = ev.target as HTMLInputElement | HTMLButtonElement | HTMLSelectElement;
      const idx = Number(t.dataset['row']);
      if (!Number.isInteger(idx)) return;
      const list = [...state.rows];
      // DOM 上的行序是**显示顺序**（权重降序、空行垫底），要换算回 state 里的下标
      const view = qualityRowsInView(state.rows);
      const row = view[idx];
      if (!row) return;
      const at = list.indexOf(row);
      if (at < 0) return;

      switch (t.dataset['key']) {
        case 'qattr': {
          // 选词条：按该词条的默认口径给权重初值（与槽位表选词条一致）；
          // 选「不计分」= 这一行空着（不删行）
          const next = (t as HTMLSelectElement).value as SubAttr | '';
          list[at] = { attr: next, weight: next === '' ? 1 : qualityWeightOnSelect(next) };
          break;
        }
        case 'qweight': {
          const raw = t.value.trim();
          list[at] = { ...row, weight: raw === '' ? 0 : quantizeWeight(Number(raw)) };
          break;
        }
        case 'qstep': {
          // 以**输入框里的值**为准（用户可能刚手改过、那一步还没进 state）
          const input = t.parentElement?.querySelector<HTMLInputElement>('input[data-key="qweight"]');
          const from = Number(input?.value);
          const base = Number.isFinite(from) ? from : row.weight;
          list[at] = { ...row, weight: stepQualityWeight(base, Number(t.dataset['delta'])) };
          break;
        }
        case 'qdel': {
          list.splice(at, 1);
          break;
        }
        default:
          return;
      }
      setState({ rows: list });
    }

    return {
      box,
      refresh() {
        // 行数 / 词条 / 主词条变了才重建；**只改了权重就只搬节点、只写数值** ——
        // 这样权重框里正在输入的东西（焦点、光标）原样留着，行却已经按新权重排好。
        if (structureOf() === structure) {
          reorder(qualityRowsInView(state.rows));
          syncRows();
        } else {
          render();
        }
      },
    };
  }

  function initialField(): Control {
    const sel = node('select', { id: 'initialVisible' });
    sel.append(option('4', '4 词条', state.initialVisible === 4));
    sel.append(option('3', '3 词条', state.initialVisible === 3));
    sel.addEventListener('change', () => {
      setState({ initialVisible: Number(sel.value) === 3 ? 3 : 4 });
    });
    return {
      box: field(C.FIELD_INITIAL, sel),
      sync: () => {
        sel.value = String(state.initialVisible);
      },
    };
  }

  function targetField(): Control {
    const input = node('input', { id: 'targetScore', type: 'number', step: '0.5', min: '0' });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= 0) setState({ targetScore: v });
    });
    return {
      box: field(C.FIELD_TARGET, input),
      sync: () => {
        // 正在输入时不要覆盖用户手上的值（否则光标会跳）
        if (document.activeElement !== input) input.value = String(state.targetScore);
      },
    };
  }

  /**
   * 左栏底部的成长值表：只列**当前参与计分**的词条。
   *
   * 全部 10 条词条的完整表在「得分分布 → 成长值」子 tab 里（`GROWTH_ORDER`），
   * 这里留一张小的，是为了让「分数是怎么来的」在配置栏旁边就能核对，不用切走。
   * 两处共用 `tierLabel`，数值不可能不一致。
   */
  function growthTableField(): { box: HTMLElement; refresh(): void } {
    const box = node('div', { class: 'panel growth-table' });
    box.append(node('h2', {}, C.GROWTH_TABLE_TITLE));
    box.append(node('p', { class: 'hint' }, C.GROWTHS_HINT));
    const t = dataTable([C.TH_GROWTH_ATTR, ...C.TH_GROWTH_TIERS]);
    box.append(t.table);

    return {
      box,
      refresh() {
        const weights = growthWeights(state);
        // 按计分权重降序：常用的排在上面
        const attrs = SUB_ATTRS.filter((a) => (weights[a] ?? 0) > 0).sort(
          (a, b) => (weights[b] ?? 0) - (weights[a] ?? 0),
        );
        if (attrs.length === 0) {
          t.body.replaceChildren(row([C.GROWTH_TABLE_EMPTY, '—', '—', '—', '—']));
          return;
        }
        t.body.replaceChildren(
          ...attrs.map((a) => row([a, ...[0, 1, 2, 3].map((tier) => tierLabel(a, tier))])),
        );
      },
    };
  }
  /** 面板标题行：左标题、右操作（目前只有「重置」） */
  function panelHead(title: string, actions: HTMLElement[]): HTMLElement {
    const head = node('div', { class: 'panel-head' });
    head.append(node('h2', {}, title));
    if (actions.length > 0) {
      const box = node('div', { class: 'panel-actions' });
      box.append(...actions);
      head.append(box);
    }
    return head;
  }

  const resetBtn = node(
    'button',
    { type: 'button', class: 'ghost small', id: 'resetBtn', title: C.RESET_TITLE },
    C.RESET,
  );
  // 「重置」= 三块配置一起回默认：点它的人要的是「回到刚打开的样子」，
  // 而不是「把当前这一页的输入清掉」（两页共用部位/主词条，只清一半反而更费解）
  resetBtn.addEventListener('click', () =>
    setState({ ...defaultShared(), ...defaultGrowth(), ...defaultQuality() }),
  );

  // -------------------------------------------------------------------------
  // Tab 1：得分分布
  // -------------------------------------------------------------------------

  const growthTab: Tab = {
    id: 'growth',
    label: C.TAB_GROWTH,

    controls(host) {      const form = node('form', { class: 'panel sticky', id: 'form' });
      form.addEventListener('submit', (ev) => ev.preventDefault());
      form.append(panelHead(C.CONFIG, [resetBtn]));

      // 第一行三个框：部位 / 主词条 / 初始词条数
      const slot = slotField();
      const main = mainAttrField();
      const initial = initialField();
      const pair = node('div', { class: 'field-trio' });
      pair.append(slot.box, main.box, initial.box);
      form.append(pair);

      const slots = slotsField();
      const target = targetField();
      form.append(slots.box, target.box);

      const growth = growthTableField();
      host.append(form, growth.box);
      this.syncControls = () => {
        slot.sync();
        main.sync();
        initial.sync();
        slots.refresh();
        target.sync();
        growth.refresh();
      };
    },

    mount(host, tabCtx) {
      const cards = node('section', { class: 'cards', id: 'cards' });
      host.append(cards);

      const panels = node('div', { class: 'subtab-panels' });
      const bar = node('div', { class: 'subtabs', role: 'tablist' });

      let table: DistributionTable | null = null;
      let hitLabels: string[] = [];
      /** 分桶后的柱子；`bucketSize` 为「不合并」时就是逐分数 */
      let bars: ScoreBucket[] = [];
      let barsBucketed = false;

      const subs: SubTab[] = [
        {
          label: C.SUB_DIST,
          render(box) {
            const p = panel(
              C.scoreChartTitle(state.mainAttr, state.initialVisible),
              C.SCORE_CHART_HINT,
            );
            p.box.classList.add('flush');

            // 分桶选择器：柱数太多时把相邻分数并成一根柱子。
            // 默认 0.2 分（见 state.defaultGrowth），**不做自动挑档**：
            // 自动挑的档会随输入悄悄变，看起来还是同一个视图，比例尺却换了。
            const tools = node('div', { class: 'chart-tools' });
            const label = node('label', { class: 'inline-field' });
            label.append(node('span', {}, C.BUCKET_LABEL));
            const sel = node('select', { id: 'bucketSize' });
            for (const size of BUCKET_OPTIONS) {
              sel.append(option(String(size), C.bucketSizeLabel(size), size === state.bucketSize));
            }
            sel.value = String(state.bucketSize);
            sel.addEventListener('change', () => {
              setState({ bucketSize: Number(sel.value) });
            });
            label.append(sel);
            tools.append(label);
            p.body.append(tools);

            const chart = node('div', { class: 'chart-wrap', id: 'scoreChart' });
            p.body.append(chart);
            box.append(p.box);
            if (!table) return;
            chart.append(
              renderScoreBars({
                data: bars.map((b) => ({
                  score: b.score,
                  byHit: b.byHit,
                  ...(barsBucketed ? { range: { min: b.minScore, max: b.maxScore } } : {}),
                })),
                hitLabels,
                marker: {
                  score: state.targetScore,
                  label: C.markerScore(fmtScore(state.targetScore)),
                },
                host: chart,
                tooltip: tabCtx.tooltip,
              }),
            );
          },
        },
        {
          label: C.SUB_SURVIVAL,
          render(box) {
            const p = panel(C.SURVIVAL_TITLE, C.SURVIVAL_HINT);
            p.box.classList.add('flush');
            const chart = node('div', { class: 'chart-wrap', id: 'survChart' });
            p.body.append(chart);
            box.append(p.box);
            if (!table) return;
            const tbl = table;
            const at = probAtLeast(tbl, state.targetScore);
            chart.append(
              renderSurvival({
                scores: tbl.scores,
                survival: survival(tbl),
                hitLabels,
                hitMix: (i) => hitMixAtLeast(tbl, i),
                hitMixCaption: C.HIT_MIX_CAPTION,
                ...(at > 0
                  ? { marker: { score: state.targetScore, label: C.markerProb(pct(at)) } }
                  : {}),
                host: chart,
                tooltip: tabCtx.tooltip,
              }),
            );
          },
        },
        {
          label: C.SUB_HITS,
          render(box) {
            const p = panel('');
            p.box.classList.add('flush');
            const chart = node('div', { class: 'chart-wrap', id: 'hitChart' });
            const t = dataTable([C.TH_HITS, C.TH_PROB, C.TH_ATTEMPTS], 'hitTable');
            p.body.append(chart, t.table);
            box.append(p.box);
            if (!table) return;
            const hitProbs = hitProbabilities(table);
            chart.append(
              renderHistogram({
                items: hitProbs.map((h) => ({
                  label: C.hitLabel(h.hits),
                  value: h.p,
                  color: hitColor(h.hits),
                })),
                title: C.HIT_CHART_TITLE,
                host: chart,
                tooltip: tabCtx.tooltip,
              }),
            );
            t.body.replaceChildren(
              ...hitProbs.map((h) =>
                row([C.hitLabel(h.hits), pct(h.p), oneIn(1 / h.p)]),
              ),
            );
          },
        },
        {
          label: C.SUB_QUANTILE,
          render(box) {
            const p = panel('', C.QUANTILE_HINT);
            p.box.classList.add('flush');
            const t = dataTable([C.TH_ALPHA, C.TH_LINE, C.TH_ATTEMPTS], 'quantileTable');
            p.body.append(t.table);
            box.append(p.box);
            if (!table) return;
            t.body.replaceChildren(
              ...[0.5, 0.1, 0.01].map((alpha) => {
                const q = scoreAtAlpha(table!, alpha);
                if (q === undefined) {
                  return row([C.topPercent(alpha), '—', C.QUANTILE_OUT_OF_RANGE]);
                }
                return row([
                  C.topPercent(alpha),
                  `${fmtScore(q)} 分`,
                  oneIn(1 / probAtLeast(table!, q)),
                ]);
              }),
            );
          },
        },
        {
          /**
           * 全部副词条的成长值。
           *
           * **纯参考表，不依赖任何计算结果**（也就不判 `table` 是否为空）：
           * 它回答的是「这些分是怎么算出来的」，配置错到算不出分布时更应该看得到。
           */
          label: C.SUB_GROWTHS,
          render(box) {
            const p = panel('', C.SUB_GROWTHS_HINT);
            const t = dataTable([C.TH_GROWTH_ATTR, ...C.TH_GROWTH_TIERS], 'growthsTable');
            p.body.append(t.table);
            box.append(p.box);
            t.body.replaceChildren(
              ...GROWTH_ORDER.map((attr) =>
                row([attr, ...[0, 1, 2, 3].map((tier) => tierLabel(attr, tier))]),
              ),
            );
          },
        },
      ];

      const sub = mountSubTabs(bar, panels, subs, tabCtx);
      host.append(bar, panels);

      this.update = () => {
        const { spec } = toSpec(state);
        try {
          table = scoreDistribution(spec);
        } catch (err) {
          table = null;
          cards.replaceChildren(
            node('p', { class: 'error' }, `${C.CALC_FAILED}${(err as Error).message}`),
          );
          sub.refresh();
          return;
        }

        const byHit = pmfByHit(table);
        hitLabels = Array.from({ length: table.hitBuckets }, (_, h) => C.hitLabel(h));

        // 分桶：0.1 = 不合并
        const size = state.bucketSize;
        barsBucketed = size > 0.1;
        bars = bucketize(
          table.scores,
          table.scores.map((_, i) => byHit.map((row) => row[i] ?? 0)),
          size,
        );

        const p = probAtLeast(table, state.targetScore);
        // 「前 10% 分数」：概率从高到低累积到 10% 时的那条分数线（与「分位分数线」子 tab 同一口径）
        const top10 = scoreAtAlpha(table, 0.1);

        // 该部位的胚子概率：不含成长值，只回答「能不能刷到这件胚子」。
        // 用「得分分布」那套计分词条 —— 这张卡在这一页，问的就是这一页要的词条。
        const drop = dropProbability(
          { mainAttr: state.mainAttr, weights: growthWeights(state) },
          state.slot,
        );
        const dropNote =
          drop.p > 0
            ? C.dropBreakdown(pct(drop.mainP), pct(drop.subsP))
            : C.DROP_OUT_OF_RANGE;

        cards.replaceChildren(
          card(C.CARD_DROP, pct(drop.p), dropNote),
          card(
            C.cardReach(fmtScore(state.targetScore)),
            pct(p),
            C.CARD_REACH_NOTE,
          ),
          card(
            C.CARD_TOP10,
            top10 === undefined ? '—' : `${fmtScore(top10)} 分`,
            top10 === undefined ? C.QUANTILE_OUT_OF_RANGE : C.CARD_TOP10_NOTE,
          ),
        );
        sub.refresh();
      };
    },
  };

  // -------------------------------------------------------------------------
  // Tab 2：胚子质量
  // -------------------------------------------------------------------------

  /**
   * 得分最高的那个组合（= 有效词条全齐的那一项），用来把饼图上那一块摘出来。
   *
   * 概率最大的组合往往只有一两条词条，得分最高的那一项反而最稀有 ——
   * 不摘出来、不单独标注，它在饼上就是一道看不见的缝。
   * 平局时取词条多的那个（语义上更是「全齐」）；没有有效词条时返回 `undefined`。
   */
  function topComboOf(d: QualityDistribution): SubAttr[] | undefined {
    let best: QualityCombo | undefined;
    for (const c of d.combos) {
      if (!best || c.score > best.score || (c.score === best.score && c.combo.length > best.combo.length)) {
        best = c;
      }
    }
    return best && best.score > 0 ? [...best.combo] : undefined;
  }

  /** 把质量分布整理成「详细图」的柱子：得分升序，并补上 P(≥ 该分数) */
  function qualityBarsOf(d: QualityDistribution): QualityBar[] {
    const out: QualityBar[] = [];
    let acc = 0;
    for (let i = d.buckets.length - 1; i >= 0; i--) {
      const b = d.buckets[i]!;
      acc += b.p;
      out.push({
        score: b.score,
        total: b.p,
        atLeast: acc,
        segments: b.combos.map((c) => ({
          label: comboLabel(c.combo),
          attrs: [...c.combo],
          size: c.combo.length,
          p: c.p,
        })),
      });
    }
    return out.reverse();
  }

  const qualityTab: Tab = {
    id: 'quality',
    label: C.TAB_QUALITY,

    controls(host) {
      const form = node('form', { class: 'panel sticky', id: 'form' });
      form.addEventListener('submit', (ev) => ev.preventDefault());
      const slot = slotField();
      const main = mainAttrField();
      // 部位与主词条同一行：这一页没有「初始词条数」，两栏摆开刚好
      const pair = node('div', { class: 'field-pair' });
      pair.append(slot.box, main.box);
      form.append(panelHead(C.CONFIG, [resetBtn]), pair);

      const weights = qualityWeightsField();
      form.append(weights.box);
      host.append(form);
      this.syncControls = () => {
        slot.sync();
        main.sync();
        weights.refresh();
      };
    },

    mount(host, tabCtx) {
      const cards = node('section', { class: 'cards' });
      const note = node('p', { class: 'summary' });
      host.append(cards, note);

      const panels = node('div', { class: 'subtab-panels' });
      const bar = node('div', { class: 'subtabs', role: 'tablist' });
      let dist: QualityDistribution | null = null;
      /** 「质量分布」里勾选高亮的词条；纯看图状态，不进 URL */
      const picked = new Set<SubAttr>();
      /** 是否画累计概率曲线；纯看图状态，不进 URL */
      let showCum = true;

      const subs: SubTab[] = [
        {
          /**
           * 组合概率（第一个子 tab，作者指定）——「这一页最该先回答的问题」。
           *
           * 标注全部画在图上；**得分最高的那一项（有效词条全齐）从圆心摘出来**：
           * 它概率最小，不摘出来根本看不见，而它恰恰是玩家最关心的那一档。
           */
          label: C.SUB_COMBOS,
          render(box) {
            const p = panel('');
            const wrap = node('div', { class: 'pie-wrap' });
            const pieBox = node('div', { class: 'pie-box' });
            wrap.append(pieBox);
            p.body.append(wrap);
            box.append(p.box);
            if (!dist) return;

            const top = topComboOf(dist);
            // **每个组合一片**，不做「其他」合并：长尾里那些「几条全齐」的组合
            // 正是这张图最值得看的东西（作者点名）。
            const slices = pieSlices(dist.combos, top ? { keep: top } : {});
            pieBox.append(
              renderPie({
                items: slices.map((s) => ({
                  label: s.label,
                  p: s.p,
                  // 浮框里只放图上读不到的：名字与概率图上都有，这里给「这一项值多少分」
                  rows: [{ label: '得分', value: `${s.combo.score} 分` }],
                  ...(top && sameCombo(s.combo.combo, top) ? { explode: true } : {}),
                })),
                title: C.SUB_COMBOS,
                tooltip: tabCtx.tooltip,
              }),
            );
          },
        },
        {
          /**
           * 质量分布：每根柱子按「是哪几条词条的组合」拆开堆叠，
           * 再叠一条累计概率曲线。参考 `docs/ai-ref/v1/init_stats/暴伤/质量分布-详细-1.png`。
           *
           * 上面那排勾选框对应「有效词条」：勾上就把它所在的**子柱子**（组合段）
           * 挑出来、其余压暗 —— 参考图的 `highlight_comb` 就是这个用法；
           * 同时含这几条词条的胚子占多少，标在图内右上角（作者要求）。
           * 勾选状态与「累计概率」开关都是**看图用的，不进 URL**（换个链接不该带着别人的视图）。
           */
          label: C.SUB_QUALITY_DIST,
          render(box) {
            const p = panel('', C.QUALITY_DIST_HINT);
            p.box.classList.add('flush');

            const tools = node('div', { class: 'chart-tools checks' });

            // 累计概率：勾掉就整条曲线（含右轴与虚线）都不画
            const cumLab = node('label', { class: 'check' });
            const cumInput = node('input', { type: 'checkbox', id: 'showCum' });
            cumInput.checked = showCum;
            cumInput.addEventListener('change', () => {
              showCum = cumInput.checked;
              paint();
            });
            cumLab.append(cumInput, node('span', {}, C.CUM_SERIES));
            tools.append(cumLab, node('span', { class: 'tool-sep' }));

            // 勾选框只写词条名：各词条的边缘概率在「词条概率」子 tab 里，
            // 这里要的是「同时含这几条」的合计（标在图上）。
            for (const a of dist?.attrProbs ?? []) {
              const lab = node('label', { class: 'check' });
              const input = node('input', { type: 'checkbox', 'data-attr': a.attr });
              input.checked = picked.has(a.attr);
              input.addEventListener('change', () => {
                if (input.checked) picked.add(a.attr);
                else picked.delete(a.attr);
                paint();
              });
              lab.append(input, node('span', {}, a.attr));
              tools.append(lab);
            }

            const chart = node('div', { class: 'chart-wrap', id: 'qualityDist' });
            p.body.append(tools, chart);
            box.append(p.box);
            if (!dist) return;

            const bars = qualityBarsOf(dist);
            function paint(): void {
              const d = dist!;
              const attrs = d.attrs.filter((a) => picked.has(a));
              chart.replaceChildren(
                renderQualityStacked({
                  bars,
                  highlight: attrs,
                  showCum,
                  ...(attrs.length > 0
                    ? {
                        pickNote: {
                          label: C.pickedLabel(attrs),
                          value: pct(qualityProbContaining(d, attrs)),
                        },
                      }
                    : {}),
                  host: chart,
                  tooltip: tabCtx.tooltip,
                }),
              );
            }
            paint();
          },
        },
        {
          label: C.SUB_ATTRS,
          render(box) {
            const p = panel('', C.ATTRS_HINT);
            const t = dataTable([C.TH_ATTR, C.TH_ATTR_PROB, C.TH_WEIGHT, C.TH_ATTR_ATTEMPTS]);
            p.body.append(t.table);
            box.append(p.box);
            if (!dist) return;
            const weights = qualityWeights(state);
            t.body.replaceChildren(
              ...dist.attrProbs
                .slice()
                .sort((a, b) => b.p - a.p)
                .map((a) =>
                  row([a.attr, pct(a.p), String(weights[a.attr] ?? 0), a.p > 0 ? oneIn(1 / a.p) : '—']),
                ),
            );
          },
        },
        {
          /**
           * 「主词条 · 副词条」：**掉落是怎么抽出来的**。两张二维概率表，都与配置无关 ——
           * 部位 / 主词条在这里是表格的维度，不是你填的输入。
           *
           * 第一张：部位（纵）× 主词条（横），格 = P(该部位出该主词条)；
           * 第二张：主词条（纵）× 副词条（横），格 = 「下一条副词条是该词条」的概率
           * （热力图那套逐条抽取的口径，不是「词条概率」子 tab 的「4 条里含有它」）。
           *
           * 第二张悬停某格会给出**再下一条**的分布：同一套「加权不放回」模型往下走一层。
           */
          label: C.SUB_MAIN_SUB,
          render(box) {
            // ① 部位 × 主词条：行是沙 / 杯 / 头，列是所有能当主词条的词条
            const p1 = panel(C.MAIN_PROB_TITLE, C.MAIN_PROB_HINT);
            p1.box.classList.add('flush');
            const chart1 = node('div', { class: 'chart-wrap', id: 'mainProbChart' });
            p1.body.append(chart1);
            box.append(p1.box);
            chart1.append(
              renderHeatmap({
                rows: mainAttrHeatmap(),
                cols: MAIN_ATTR_COLS,
                // 把「你现在选的那一格」框出来：概率与配置无关，这只是个位置提示
                ...(hasRandomMain(state.slot)
                  ? { highlightRow: state.slot, highlightCol: state.mainAttr }
                  : {}),
                rowAxis: C.MAIN_PROB_ROW_AXIS,
                colAxis: C.MAIN_PROB_COL_AXIS,
                // 只有三行，格子别拉成一整块
                cellMaxH: 56,
                host: chart1,
                tooltip: tabCtx.tooltip,
              }),
            );

            // ② 主词条 × 副词条
            const rows = substatHeatmap();
            const p2 = panel(C.HEAT_TITLE, C.HEAT_HINT);
            p2.box.classList.add('flush');
            const chart2 = node('div', { class: 'chart-wrap', id: 'substatHeatmap' });
            p2.body.append(chart2);
            box.append(p2.box);
            chart2.append(
              renderHeatmap({
                rows,
                cols: SUB_ATTRS,
                highlightRow: heatRowKey(state.mainAttr),
                // 浮框里的条：把「这一格已经抽走」代进模型，得到再下一条的分布。
                // 条长按本组最大值折算（这几个概率都在 10% 上下，按原值画全是一小截），
                // 所以 `nextCaption` 必须写明这件事。
                nextBars: (row, col) => {
                  const next = nextSubstatDist(row.key as MainAttr, [col as SubAttr]);
                  const peak = Math.max(...next.map((d) => d.p));
                  return next.map((d) => ({
                    label: d.attr,
                    fraction: d.p / peak,
                    value: pct(d.p, 2),
                    color: categoricalColor(0),
                  }));
                },
                nextCaption: C.HEAT_NEXT_CAPTION,
                rowAxis: C.HEAT_ROW_AXIS,
                colAxis: C.HEAT_COL_AXIS,
                host: chart2,
                tooltip: tabCtx.tooltip,
              }),
            );
          },
        },
      ];

      const sub = mountSubTabs(bar, panels, subs, tabCtx);
      host.append(bar, panels);

      this.update = () => {
        try {
          // 胚子质量用自己的权重表（每条词条一个分，不乘成长值），与「得分分布」无关。
          // 空行 / 权重 0 的行在这里被 `qualityWeights` 忽略掉（作者要求空行不参与绘图）。
          dist = qualityDistribution({ mainAttr: state.mainAttr, weights: qualityWeights(state) });
        } catch (err) {
          dist = null;
          note.textContent = `${C.CALC_FAILED}${(err as Error).message}`;
          cards.replaceChildren();
          sub.refresh();
          return;
        }

        note.textContent = C.qualityNote(state.mainAttr, dist.droppedAttr, dist.attrs.length);
        // 权重表换过之后，勾选框里可能留着已经不计分的词条：剔掉。
        // 留着的话「高亮含这条的段」一段都命中不了，整张图会被压暗。
        for (const a of [...picked]) if (!dist.attrs.includes(a)) picked.delete(a);
        cards.replaceChildren(
          card(C.CARD_ATTRS, `${dist.attrs.length} 条`, dist.attrs.join(' / ') || '—'),
          card(C.CARD_MEAN, fmtScore(dist.mean), C.CARD_MEAN_NOTE),
          card(C.CARD_BEST_DROP, fmtScore(dist.best), C.CARD_BEST_DROP_NOTE),
          card(
            C.CARD_MODE,
            dist.mode ? pct(dist.mode.p) : '—',
            dist.mode ? comboLabel(dist.mode.combo) : '—',
          ),
        );
        sub.refresh();
      };
    },
  };

  // -------------------------------------------------------------------------
  // Tab 3：占位
  // -------------------------------------------------------------------------

  const moreTab: Tab = {
    id: 'more',
    label: C.TAB_MORE,
    // **不需要配置**：侧边栏这一页右边那一栏会整栏收掉（`selectTab` 里判断）
    mount(host) {
      const p = panel(C.MORE_TITLE);
      const list = node('ul', { class: 'todo' });
      for (const item of C.MORE_ITEMS) list.append(node('li', {}, item));
      p.body.append(list);
      host.append(p.box);
    },
  };

  /**
   * 装配子 tab：`bar` 放按钮，`panels` 放内容。
   *
   * **只渲染当前可见的那个**：四个子 tab 里有三张图，全部渲染等于白算三遍
   * （得分分布一次 5~20 ms，大表更久）。切回来时重渲染一次即可。
   */
  function mountSubTabs(
    bar: HTMLElement,
    panels: HTMLElement,
    subs: SubTab[],
    tabCtx: TabCtx,
  ): { refresh(): void; select(i: number): void } {
    const buttons: HTMLButtonElement[] = [];
    const holders: HTMLElement[] = [];
    let active = 0;

    subs.forEach((s, i) => {
      const btn = subTabNode(s.label, `${bar.id || 'sub'}-${i}`, i === 0);
      btn.addEventListener('click', () => select(i));
      bar.append(btn);
      buttons.push(btn);

      const holder = node('div', {
        class: 'subtab-panel',
        role: 'tabpanel',
        'data-sub': String(i),
      });
      holder.hidden = i !== 0;
      panels.append(holder);
      holders.push(holder);
    });

    function select(i: number): void {
      if (i < 0 || i >= subs.length) return;
      active = i;
      buttons.forEach((b, k) => {
        b.classList.toggle('on', k === i);
        b.setAttribute('aria-selected', k === i ? 'true' : 'false');
      });
      holders.forEach((h, k) => {
        h.hidden = k !== i;
      });
      // 侧边栏里同一份导航要跟着高亮
      tabCtx.navChanged();
      // 新露出来的那张图还是空的（或上一次的内容），必须重渲染
      render();
    }

    function render(): void {
      const holder = holders[active];
      const sub = subs[active];
      if (!holder || !sub) return;
      holder.replaceChildren();
      sub.render(holder);
    }

    // 登记给侧边栏：它与图表上方那一排是同一份状态
    tabCtx.reportSubs?.({
      labels: subs.map((s) => s.label),
      index: () => active,
      select,
    });

    return { refresh: render, select };
  }

  // -------------------------------------------------------------------------
  // tab 装配
  // -------------------------------------------------------------------------

  const TABS: Tab[] = [growthTab, qualityTab, moreTab];
  const TAB_IMPL: Record<string, Tab> = Object.fromEntries(TABS.map((t) => [t.id, t]));

  const staleTabs = new Set<string>();

  /**
   * 侧边栏的任务树：主任务 + **当前任务**的子任务。
   *
   * 子任务只在它是当前任务时才列出来（手风琴）：一屏里同时铺开四个任务的二十个子项
   * 反而找不到自己在哪。窄屏时子任务整段隐藏，由图表上方那一排负责切换
   * （见 `styles.css` 的 1180px 断点）。
   */
  function renderTree(): void {
    tree.replaceChildren();
    for (const tab of TABS) {
      const group = node('div', { class: 'tree-group' });
      const btn = node('button', {
        type: 'button',
        class: tab.id === activeTab ? 'tab on' : 'tab',
        role: 'tab',
        id: `tab-${tab.id}`,
        'aria-controls': `panel-${tab.id}`,
        'aria-selected': tab.id === activeTab ? 'true' : 'false',
      });
      btn.textContent = tab.label;
      btn.addEventListener('click', () => selectTab(tab.id, true));
      group.append(btn);

      const api = subsOf.get(tab.id);
      if (api && tab.id === activeTab) {
        const list = node('div', { class: 'tree-subs' });
        api.labels.forEach((label, i) => {
          const sub = node('button', {
            type: 'button',
            class: i === api.index() ? 'tree-sub on' : 'tree-sub',
            'aria-current': i === api.index() ? 'true' : 'false',
          });
          sub.textContent = label;
          sub.addEventListener('click', () => api.select(i));
          list.append(sub);
        });
        group.append(list);
      }
      tree.append(group);
    }
  }

  function selectTab(id: string, writeHash: boolean): void {
    const tab = TAB_IMPL[id] ?? growthTab;
    activeTab = tab.id;

    // 配置属于任务：这一栏整体换成当前任务的；**不需要配置的任务整栏收掉**
    configHost.replaceChildren();
    configHost.hidden = tab.controls === undefined;
    layout.classList.toggle('no-config', tab.controls === undefined);
    tab.controls?.(configHost, ctx);

    // 结果面板只挂载一次，之后靠 `hidden` 切换。
    // 不能「切走就 removeChild」：各 tab 的 update 闭包捕获的是自己那批节点。
    for (const p of panelHost.children) {
      (p as HTMLElement).hidden = p.getAttribute('data-tab') !== tab.id;
    }

    renderTree();
    tooltip.hide();
    staleTabs.delete(tab.id);
    tab.syncControls?.();
    tab.update?.();

    if (writeHash) {
      const next = `#${tab.id}`;
      if (location.hash !== next) history.replaceState(null, '', next);
    }
  }

  /** 只刷新当前 tab，其余记为过期（切回去时 `selectTab` 会重算） */
  function refreshActiveTab(): void {
    for (const p of panelHost.children) {
      const id = p.getAttribute('data-tab');
      if (id && id !== activeTab) staleTabs.add(id);
    }
    if (!staleTabs.has(activeTab)) TAB_IMPL[activeTab]?.update?.();
  }

  function readTabFromHash(): string {
    const id = location.hash.replace(/^#/, '');
    return TAB_IMPL[id] ? id : 'growth';
  }

  /**
   * 先把**所有**任务的结果骨架挂好（只建 DOM，不画图、不计算）。
   *
   * 两个原因：
   *   1. 侧边栏要列出当前任务的子任务，而子任务清单是 `mount()` 里登记的；
   *   2. 各 tab 的 `update` 闭包捕获的是自己那批节点 —— 面板必须一直留着，
   *      之后只靠 `hidden` 切换，绝不能「切走就 replaceChildren」。
   *
   * 骨架是纯 DOM 操作（卡片、子 tab 按钮、空面板），不触发任何渲染：
   * 图表由各自的 `update()` → `sub.refresh()` 画。
   */
  for (const tab of TABS) {
    const panel = node('section', {
      class: 'tab-panel',
      id: `panel-${tab.id}`,
      role: 'tabpanel',
      'aria-labelledby': `tab-${tab.id}`,
      'data-tab': tab.id,
    });
    // 正文顶上的小标题 = 当前任务的**名字**（作者 2026-10-08：中间上方要有个小标题）。
    // 侧边栏在窄屏会收成一行横条，标题就是那时唯一的位置提示。
    // 各页原有的「这一页在算什么」那句话被作者删掉了（两句都嫌费解），所以这里只写名字。
    panel.append(node('h2', { class: 'tab-title' }, tab.label));
    panel.hidden = true;
    panelHost.append(panel);
    tab.mount(panel, { ...ctx, reportSubs: (api) => subsOf.set(tab.id, api) });
  }

  activeTab = readTabFromHash();
  applyTheme(state.theme);

  // -------------------------------------------------------------------------

  function applyTheme(theme: 'light' | 'dark'): void {
    document.documentElement.dataset['theme'] = theme;
    const toDark = theme === 'light';
    themeBtn.title = toDark ? C.THEME_TO_DARK : C.THEME_TO_LIGHT;
    themeBtn.setAttribute('aria-label', themeBtn.title);
    themeBtn.replaceChildren(themeIcon(theme));
  }

  function setState(next: Partial<AppState>): void {
    state = { ...state, ...next };
    applyTheme(state.theme);
    // 只同步配置栏的既有节点，**不重建**：目标分数输入框正在被输入时，
    // 重建会夺走焦点，表现为「打字打一半光标飞了」。
    TAB_IMPL[activeTab]?.syncControls?.();
    refreshActiveTab();
  }

  themeBtn.addEventListener('click', () => {
    setState({ theme: state.theme === 'dark' ? 'light' : 'dark' });
  });

  window.addEventListener('hashchange', () => {
    const id = readTabFromHash();
    if (id !== activeTab) selectTab(id, false);
  });

  selectTab(activeTab, false);
}
