/**
 * 界面装配。
 *
 * ## 结构
 *
 * 顶部是标题栏（标题 + 主题图标）。下面是左右两栏：
 *   - 左栏：**当前 tab 的**配置（`Tab.controls`）；
 *   - 右栏：结果，再按**子 tab** 分页——每张图一个子 tab，切换即可，不用滚动。
 *
 * ## 为什么配置按 tab 分
 *
 * 每个主 tab 是一个**独立问题**，需要的输入本来就不同：
 *   - 「得分分布」要 主词条 / 初始词条数 / 副词条与档位 / 目标分数；
 *   - 「胚子质量」只看掉落那一刻，问它「初始几条」没有意义。
 * 共享的只有**评分标准**（主词条 + 哪些副词条计分），换任务不该丢。
 * 详见 `ui/state.ts` 的两级类型划分。
 *
 * ## 子 tab 的刷新契约
 *
 * 「只渲染当前可见的那个子 tab」省掉了隐藏图表的计算，代价是需要一个明确的刷新入口：
 * 各 tab 的 `update()` 算完数据后调 `sub.refresh()`。切换子 tab 时也要调一次，
 * 否则新露出来的那张图还是上一次的内容（或空白）。
 *
 * 全部数学都在 `src/core/`，界面只负责收集输入与展示结果。
 */

import { MAIN_ATTRS, type MainAttr, type SubAttr } from '../core/stats';
import {
  scoreDistribution,
  pmfByHit,
  hitProbabilities,
  probAtLeast,
  survival,
  expectedAttempts,
  scoreAtAlpha,
  tierLabel,
  type DistributionTable,
  type InitialRoll,
} from '../core/growth';
import {
  qualityDistribution,
  pieSlices,
  comboLabel,
  type QualityDistribution,
} from '../core/quality';
import {
  renderScoreBars,
  renderSurvival,
  renderHistogram,
  hitColor,
  type StackedDatum,
} from '../render/charts';
import { renderPie } from '../render/pie';
import { Tooltip } from '../render/tooltip';
import {
  defaultGrowth,
  defaultShared,
  fromQuery,
  toQuery,
  isExcludedByMain,
  nextWeightDown,
  nextWeightUp,
  weightOnSelect,
  selectableAttrs,
  toSpec,
  weightMap,
  type AppState,
  type GrowthConfig,
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
}

interface Tab {
  id: string;
  label: string;
  blurb: string;
  /** 左栏：这个任务需要什么配置 */
  controls(host: HTMLElement, ctx: TabCtx): void;
  /** 右栏：结果区骨架，首次进入时调用一次 */
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
  const themeBtn = node('button', { type: 'button', class: 'icon-btn', id: 'themeBtn' });
  titleRow.append(themeBtn);
  hero.append(titleRow, node('p', { class: 'lede' }, C.APP_LEDE));
  root.append(hero);

  // ---- 两栏 ----
  const layout = node('div', { class: 'layout' });
  const configHost = node('div', { class: 'config-col', id: 'config' });
  const results = node('main', { class: 'results' });
  const tabBar = node('div', { class: 'tabs', role: 'tablist' });
  const tabButtons = new Map<string, HTMLButtonElement>();
  const panelHost = node('div', { class: 'tab-panels', id: 'tabPanels' });
  results.append(tabBar, panelHost);
  layout.append(configHost, results);

  const tooltipHost = node('div', { class: 'tooltip-host' });
  root.append(layout, tooltipHost);
  const tooltip = new Tooltip(tooltipHost);

  const ctx: TabCtx = { patch: (next) => setState(next), tooltip };

  // -------------------------------------------------------------------------
  // 共享控件
  // -------------------------------------------------------------------------

  function mainAttrField(): HTMLElement {
    const sel = node('select', { id: 'mainAttr' });
    for (const a of MAIN_ATTRS) sel.append(option(a, a, a === state.mainAttr));
    sel.value = state.mainAttr;
    sel.addEventListener('change', () => {
      const mainAttr = sel.value as MainAttr;
      const slots = state.slots.map((s) =>
        isExcludedByMain(mainAttr, s.attr) ? { ...s, attr: '' as const, weight: 0 } : { ...s },
      ) as AppState['slots'];
      setState({ mainAttr, slots });
    });
    return field(C.FIELD_MAIN, sel);
  }

  /**
   * 副词条表：词条 / 权重（+ 可选 初始档位）。
   *
   * 权重是 `−` / 数字框 / `+`：原生 number 的上下箭头太小，而这一列几乎只做小幅微调。
   * `+` 从 0 直接跳到该词条的默认权重，`−` 从默认权重直接归零——见 `state.ts`。
   *
   * `rollColumn = false` 用于「胚子质量」：初始档位是**强化**才有的事。
   */
  function slotsField(rollColumn: boolean): { box: HTMLElement; refresh(): void } {
    const box = node('div', { class: 'slots' });
    box.append(
      node('h3', { class: 'sub' }, C.SECT_SUBSTATS),
      node('p', { class: 'hint' }, rollColumn ? C.SUBSTATS_HINT_ROLL : C.SUBSTATS_HINT_NOROLL),
    );

    const head = node('div', { class: 'slot-head' });
    head.append(node('span', {}, C.COL_ATTR), node('span', {}, C.COL_WEIGHT));
    if (rollColumn) head.append(node('span', {}, C.COL_ROLL));
    box.append(head);

    const rows = node('div', { class: 'slot-rows', id: 'slotRows' });
    box.append(rows);
    const warn = node('p', { class: 'hint warn', id: 'ignoredNote' });
    box.append(warn);

    // 一个委托接三种交互：
    //   change → 词条 / 初始档位两个下拉
    //   input  → 权重数字框（边打字边出结果）
    //   click  → 权重 − / +（按钮不产生 change/input，必须单独接）
    rows.addEventListener('change', onEdit);
    rows.addEventListener('input', (ev) => {
      if ((ev.target as HTMLElement).dataset['key'] === 'weight') onEdit(ev);
    });
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

          // 同一个词条只能占一个槽位：改成一个已被占用的词条时，两条互换
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
          // 允许中间态（空串 / 只有负号）：交给 toSpec 忽略，不要在这里抛错
          cur.weight = raw === '' ? 0 : Number(raw);
          break;
        }
        case 'step': {
          const delta = Number(t.dataset['delta']);
          // 读**输入框当前值**，不是 state 里的值：用户可能刚手动改过数字框，
          // 而那一步还没进 state。以输入框为准，「按了没反应」这类错位就不可能发生。
          const cur_input = t.parentElement?.querySelector<HTMLInputElement>('input[data-key="weight"]');
          const from = Number(cur_input?.value ?? cur.weight);
          const base = Number.isFinite(from) ? from : cur.weight;
          cur.weight =
            delta > 0 ? nextWeightUp(cur.attr, base) : nextWeightDown(cur.attr, base);
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

    function render(): void {
      const allowed = selectableAttrs(state.mainAttr);
      rows.replaceChildren();
      state.slots.forEach((slot, i) => {
        const r = node('div', { class: 'slot-row' });
        if (!rollColumn) r.classList.add('two-col');

        const sel = node('select', { 'data-slot': String(i), 'data-key': 'attr' });
        sel.append(option('', '（不计分）', slot.attr === ''));
        for (const a of allowed) sel.append(option(a, a, a === slot.attr));
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

        const roll = rollColumn
          ? node('select', { 'data-slot': String(i), 'data-key': 'roll' })
          : null;
        if (roll) fillRollOptions(roll, slot.attr, slot.weight, slot.initialRoll);

        r.append(sel, stepper);
        if (roll) r.append(roll);
        rows.append(r);
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
        render();
        warn.textContent = C.ignoredNote(toSpec(state).ignored);
      },
    };
  }

  function initialField(): HTMLElement {
    const sel = node('select', { id: 'initialVisible' });
    sel.append(option('4', '4 词条', state.initialVisible === 4));
    sel.append(option('3', '3 词条', state.initialVisible === 3));
    sel.value = String(state.initialVisible);
    sel.addEventListener('change', () => {
      setState({ initialVisible: Number(sel.value) === 3 ? 3 : 4 });
    });
    return field(C.FIELD_INITIAL, sel);
  }

  function targetField(): HTMLElement {
    const input = node('input', { id: 'targetScore', type: 'number', step: '0.5', min: '0' });
    input.value = String(state.targetScore);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= 0) setState({ targetScore: v });
    });
    return field(C.FIELD_TARGET, input);
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
  resetBtn.addEventListener('click', () => setState({ ...defaultShared(), ...defaultGrowth() }));

  // -------------------------------------------------------------------------
  // Tab 1：得分分布
  // -------------------------------------------------------------------------

  const growthTab: Tab = {
    id: 'growth',
    label: C.TAB_GROWTH,
    blurb: C.GROWTH_BLURB,

    controls(host) {
      const form = node('form', { class: 'panel sticky', id: 'form' });
      form.addEventListener('submit', (ev) => ev.preventDefault());
      form.append(panelHead(C.CONFIG, [resetBtn]));

      // 主词条与初始词条数并排一行
      const pair = node('div', { class: 'field-pair' });
      pair.append(mainAttrField(), initialField());
      form.append(pair);

      const slots = slotsField(true);
      form.append(slots.box, targetField());
      host.append(form);
      this.syncControls = () => slots.refresh();
    },

    mount(host, tabCtx) {
      const cards = node('section', { class: 'cards', id: 'cards' });
      host.append(cards);

      const panels = node('div', { class: 'subtab-panels' });
      const bar = node('div', { class: 'subtabs', role: 'tablist' });

      let table: DistributionTable | null = null;
      let shares: StackedDatum[] = [];
      let hitLabels: string[] = [];

      const subs: SubTab[] = [
        {
          label: C.SUB_DIST,
          render(box) {
            const p = panel(
              C.scoreChartTitle(state.mainAttr, state.initialVisible),
              C.SCORE_CHART_HINT,
            );
            p.box.classList.add('flush');
            const chart = node('div', { class: 'chart-wrap', id: 'scoreChart' });
            p.body.append(chart);
            box.append(p.box);
            if (!table) return;
            chart.append(
              renderScoreBars({
                data: shares,
                hitLabels,
                marker: {
                  score: state.targetScore,
                  label: C.markerScore(fmtScore(state.targetScore)),
                },
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
            const at = probAtLeast(table, state.targetScore);
            chart.append(
              renderSurvival({
                scores: table.scores,
                survival: survival(table),
                ...(at > 0
                  ? { marker: { score: state.targetScore, label: C.markerProb(pct(at)) } }
                  : {}),
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
                  label: C.hitBucketLabel(h.hits),
                  value: h.p,
                  color: hitColor(h.hits),
                })),
                title: C.HIT_CHART_TITLE,
                tooltip: tabCtx.tooltip,
              }),
            );
            t.body.replaceChildren(
              ...hitProbs.map((h) =>
                row([C.hitBucketLabel(h.hits), pct(h.p), oneIn(1 / h.p)]),
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
      ];

      const sub = mountSubTabs(bar, panels, subs);
      host.append(bar, panels);

      this.update = () => {
        const { spec, scoredCount } = toSpec(state);
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
        shares = table.scores.map((s, i) => ({
          score: s,
          byHit: byHit.map((r) => r[i] ?? 0),
        }));
        hitLabels = Array.from({ length: table.hitBuckets }, (_, h) => `命中 ${h} 次`);

        const p = probAtLeast(table, state.targetScore);
        const attempts = expectedAttempts(table, state.targetScore);
        const best = table.scores[table.scores.length - 1] ?? 0;

        cards.replaceChildren(
          card(C.CARD_TARGET, `${fmtScore(state.targetScore)} 分`, C.CARD_TARGET_NOTE),
          card(C.CARD_REACH, pct(p), C.reachNote(fmtScore(state.targetScore))),
          card(C.CARD_ATTEMPTS, attempts ? oneIn(attempts) : '—', C.CARD_ATTEMPTS_NOTE),
          card(C.CARD_BEST, fmtScore(best), C.scoredSlotsNote(scoredCount)),
        );
        sub.refresh();
      };
    },
  };

  // -------------------------------------------------------------------------
  // Tab 2：胚子质量
  // -------------------------------------------------------------------------

  const qualityTab: Tab = {
    id: 'quality',
    label: C.TAB_QUALITY,
    blurb: C.QUALITY_BLURB,

    controls(host) {
      const form = node('form', { class: 'panel sticky', id: 'form' });
      form.addEventListener('submit', (ev) => ev.preventDefault());
      form.append(panelHead(C.CONFIG, [resetBtn]));
      form.append(mainAttrField());

      const slots = slotsField(false);
      form.append(slots.box);
      host.append(form);
      this.syncControls = () => slots.refresh();
    },

    mount(host, tabCtx) {
      const cards = node('section', { class: 'cards' });
      const note = node('p', { class: 'summary' });
      host.append(cards, note);

      const panels = node('div', { class: 'subtab-panels' });
      const bar = node('div', { class: 'subtabs', role: 'tablist' });
      let dist: QualityDistribution | null = null;

      const subs: SubTab[] = [
        {
          label: C.SUB_QUALITY_DIST,
          render(box) {
            const p = panel('', C.QUALITY_DIST_HINT);
            p.box.classList.add('flush');
            const chart = node('div', { class: 'chart-wrap' });
            p.body.append(chart);
            box.append(p.box);
            if (!dist) return;
            const buckets = dist.buckets.filter((b) => b.score > 0);
            chart.append(
              renderHistogram({
                items: (buckets.length > 0 ? buckets : dist.buckets).map((b) => ({
                  label: fmtScore(b.score),
                  value: b.p,
                  note: b.combos.length > 1 ? C.sameScoreCombos(b.combos.length) : undefined,
                })),
                title: C.AXIS_SCORE,
                tooltip: tabCtx.tooltip,
              }),
            );
          },
        },
        {
          label: C.SUB_COMBOS,
          render(box) {
            const p = panel('', C.COMBOS_HINT);
            const wrap = node('div', { class: 'pie-wrap' });
            const pieBox = node('div', { class: 'pie-box' });
            const legend = node('div', { class: 'pie-legend-html' });
            wrap.append(pieBox, legend);
            p.body.append(wrap);
            box.append(p.box);
            if (!dist) return;

            const slices = pieSlices(dist.combos, { maxSlices: 8, minShare: 0.005 });
            pieBox.append(renderPie({ items: slices, title: C.SUB_COMBOS, tooltip: tabCtx.tooltip }));
            legend.replaceChildren(
              ...slices.map((s, i) => {
                const r = node('div', { class: 'legend-row' });
                const dot = node('span', { class: 'legend-dot' });
                dot.style.background = hitColor(i);
                r.append(dot, node('span', { class: 'legend-name' }, s.label));
                r.append(node('span', { class: 'legend-val' }, pct(s.p)));
                return r;
              }),
            );
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
            const weights = weightMap(state);
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
      ];

      const sub = mountSubTabs(bar, panels, subs);
      host.append(bar, panels);

      this.update = () => {
        try {
          dist = qualityDistribution({ mainAttr: state.mainAttr, weights: weightMap(state) });
        } catch (err) {
          dist = null;
          note.textContent = `${C.CALC_FAILED}${(err as Error).message}`;
          cards.replaceChildren();
          sub.refresh();
          return;
        }

        note.textContent = C.qualityNote(state.mainAttr, dist.droppedAttr, dist.attrs.length);
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
    blurb: '',
    controls(host) {
      const box = node('div', { class: 'panel sticky' });
      box.append(panelHead(C.CONFIG, [resetBtn]), node('p', { class: 'hint' }, '此页暂无内容。'));
      host.append(box);
    },
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

    return { refresh: render, select };
  }

  // -------------------------------------------------------------------------
  // tab 装配
  // -------------------------------------------------------------------------

  const TABS: Tab[] = [growthTab, qualityTab, moreTab];
  const TAB_IMPL: Record<string, Tab> = Object.fromEntries(TABS.map((t) => [t.id, t]));

  for (const tab of TABS) {
    const btn = node('button', {
      type: 'button',
      class: 'tab',
      role: 'tab',
      id: `tab-${tab.id}`,
      'aria-controls': `panel-${tab.id}`,
    });
    btn.textContent = tab.label;
    btn.addEventListener('click', () => selectTab(tab.id, true));
    tabButtons.set(tab.id, btn);
    tabBar.append(btn);
  }

  const mountedTabs = new Set<string>();
  const staleTabs = new Set<string>();

  function selectTab(id: string, writeHash: boolean): void {
    const tab = TAB_IMPL[id] ?? growthTab;
    activeTab = tab.id;

    for (const [key, btn] of tabButtons) {
      const on = key === tab.id;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }

    // 配置栏整体换掉：每个任务的配置本来就不一样
    configHost.replaceChildren();
    tab.controls(configHost, ctx);

    // 结果面板只挂载一次，之后靠 `hidden` 切换。
    // 不能「切走就 removeChild」：各 tab 的 update 闭包捕获的是自己那批节点。
    for (const p of panelHost.children) {
      (p as HTMLElement).hidden = p.getAttribute('data-tab') !== tab.id;
    }
    if (!mountedTabs.has(tab.id)) {
      const p = node('section', {
        class: 'tab-panel',
        id: `panel-${tab.id}`,
        role: 'tabpanel',
        'aria-labelledby': `tab-${tab.id}`,
        'data-tab': tab.id,
      });
      if (tab.blurb) p.append(node('p', { class: 'tab-blurb' }, tab.blurb));
      panelHost.append(p);
      tab.mount(p, ctx);
      mountedTabs.add(tab.id);
    }

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
    for (const id of mountedTabs) if (id !== activeTab) staleTabs.add(id);
    if (!staleTabs.has(activeTab)) TAB_IMPL[activeTab]?.update?.();
  }

  function readTabFromHash(): string {
    const id = location.hash.replace(/^#/, '');
    return TAB_IMPL[id] ? id : 'growth';
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
