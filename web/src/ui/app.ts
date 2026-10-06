/**
 * 界面装配。
 *
 * ## 结构：配置属于任务
 *
 * 每个 tab（= 一个**独立问题**）自带左右两栏：
 *   - 左栏 `controls(host)`：**这个任务需要什么配置**；
 *   - 右栏 `mount(host)` + `update()`：结果。
 *
 * 这不是「同一个问题的不同画法」，所以配置也各不相同：
 *   - 「得分分布」要 主词条 / 副词条与权重 / 初始档位 / 初始词条数 / 目标分数；
 *   - 「胚子质量」只关心掉落那一刻，**问它「掉落时可见几条」没有意义**，所以不问。
 *
 * 共享的是**评分标准**（主词条 + 哪些副词条计分），换任务不该丢；
 * 任务特有的输入（初始词条数、目标分数）各自持有。详见 `ui/state.ts` 的类型划分。
 *
 * 界面只负责收集输入与展示结果，全部数学都在 `src/core/`，可单独测试。
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
  defaultShared,
  defaultGrowth,
  fromQuery,
  toQuery,
  isExcludedByMain,
  selectableAttrs,
  toSpec,
  weightMap,
  type AppState,
  type GrowthConfig,
  type SharedConfig,
  type SlotInput,
} from './state';
import { oneIn, pct, score as fmtScore } from './format';

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
  if (selected) el.selected = true;
  return el;
}

/** 一行「标签 + 控件」 */
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

/** 表格：`heads` + 每次 `rows` 调用重建 tbody */
function dataTable(heads: string[], id?: string): { table: HTMLTableElement; body: HTMLTableSectionElement } {
  const table = node('table', { class: 'data', ...(id ? { id } : {}) });
  const thead = node('thead');
  const tr = node('tr');
  for (const h of heads) tr.append(node('th', {}, h));
  thead.append(tr);
  const tbody = node('tbody');
  table.append(thead, tbody);
  return { table, body: tbody };
}

// ---------------------------------------------------------------------------
// 共享控件：主词条、副词条表（词条 / 权重 / 初始档位）
// ---------------------------------------------------------------------------

/** 权重一步的幅度。权重口径都很小（0.1～2），0.1 用起来最顺手 */
const WEIGHT_STEP = 0.1;

/** 初始档位的 5 个选项：随机 + 四档 */
const ROLL_CHOICES: readonly InitialRoll[] = ['random', 0, 1, 2, 3];

function rollLabel(attr: SubAttr | '', roll: InitialRoll, weight: number): string {
  if (roll === 'random') return '随机';
  if (attr === '') return `第 ${roll + 1} 档`;
  return tierLabel(attr, roll, weight > 0 ? weight : 1);
}

function rollValue(roll: InitialRoll): string {
  return roll === 'random' ? 'random' : String(roll);
}

/**
 * 重建档位选项。
 *
 * 选项文案要带数值（`2.7` 而不是「第 1 档」），否则用户没法判断该选哪一档；
 * 而数值取决于词条与权重，所以词条或权重一变就得重建。
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
  // 显式赋值一次：`option.selected` 在 jsdom 下不足以让 select.value 跟上
  sel.value = rollValue(selected);
}

// ---------------------------------------------------------------------------
// Tab 定义
// ---------------------------------------------------------------------------

interface TabCtx {
  shared(): SharedConfig;
  growth(): GrowthConfig;
  patch(next: Partial<AppState>): void;
  tooltip: Tooltip;
}

interface Tab {
  id: string;
  label: string;
  /** 一句话说明这个 tab 回答什么问题 */
  blurb: string;
  /** 左栏：这个任务需要什么配置 */
  controls(host: HTMLElement, ctx: TabCtx): void;
  /** 右栏：结果区骨架，首次进入时调用一次 */
  mount(host: HTMLElement, ctx: TabCtx): void;
  /**
   * 配置栏的同步（不重建节点，避免夺走输入焦点）。
   * 由 `controls` 在挂载时赋值。
   */
  syncControls?(): void;
  /** 结果的刷新；不需要响应式就省略 */
  update?(): void;
}

// ---------------------------------------------------------------------------

export function mount(root: HTMLElement): void {
  let state = fromQuery(location.search);
  let activeTab = 'growth';

  // ---- 骨架 ----
  root.replaceChildren();
  root.dataset.mounted = '1';

  const hero = node('header', { class: 'hero' });
  const titleRow = node('div', { class: 'title-row' });
  titleRow.append(node('h1', {}, '圣遗物词条概率分布'));
  const themeBtn = node('button', { type: 'button', class: 'ghost small', id: 'themeBtn' });
  titleRow.append(themeBtn);
  hero.append(titleRow);
  hero.append(
    node(
      'p',
      { class: 'lede' },
      '给定主词条与各副词条的计分权重，算出「胚子练满后得分」的完整概率分布——' +
        '不是给单件打分，而是回答「我有多大几率练出这样的」。',
    ),
  );
  root.append(hero);

  const layout = node('div', { class: 'layout' });
  /** 左栏：**当前 tab 的**配置 */
  const configHost = node('div', { class: 'config-col', id: 'config' });
  const results = node('main', { class: 'results' });
  const tabBar = node('div', { class: 'tabs', role: 'tablist' });
  const tabButtons = new Map<string, HTMLButtonElement>();
  const panelHost = node('div', { class: 'tab-panels', id: 'tabPanels' });

  // 分享 / 重置是所有任务共用的动作，固定挂在左栏底部
  const globalActions = node('div', { class: 'actions global' });
  const shareBtn = node('button', { type: 'button', class: 'ghost', id: 'shareBtn' }, '复制链接');
  const resetBtn = node('button', { type: 'button', class: 'ghost', id: 'resetBtn' }, '重置');
  globalActions.append(shareBtn, resetBtn);

  results.append(tabBar, panelHost);
  layout.append(configHost, results);

  const tooltipHost = node('div', { class: 'tooltip-host' });
  root.append(layout, tooltipHost);
  const tooltip = new Tooltip(tooltipHost);

  const ctx: TabCtx = {
    shared: () => state,
    growth: () => state,
    patch: (next) => setState(next),
    tooltip,
  };

  // -------------------------------------------------------------------------
  // 共享控件构造
  // -------------------------------------------------------------------------

  /** 主词条下拉 + 冲突清理 */
  function mainAttrField(id: string): HTMLElement {
    const sel = node('select', { id });
    for (const a of MAIN_ATTRS) sel.append(option(a, a, a === state.mainAttr));
    sel.value = state.mainAttr;
    sel.addEventListener('change', () => {
      const mainAttr = sel.value as MainAttr;
      const slots = state.slots.map((s) =>
        isExcludedByMain(mainAttr, s.attr) ? { ...s, attr: '' as const, weight: 0 } : { ...s },
      ) as AppState['slots'];
      setState({ mainAttr, slots });
    });
    return field('主词条', sel);
  }

  /**
   * 副词条表：**词条 / 权重**（+ 可选 **初始档位**）。
   *
   * 权重用一个 − / + 夹着的数字框：`<input type=number>` 自带的上下箭头又小又难按，
   * 而这一列几乎只会小幅微调。数字框仍可直接输入任意值。
   *
   * `rollColumn = false` 用于「胚子质量」——那个任务只看掉落那一刻，
   * 初始档位是**强化**才有的事，放在那里只会误导。
   */
  function slotsField(idPrefix: string, rollColumn: boolean): { box: HTMLElement; refresh(): void } {
    const box = node('div', { class: 'slots' });
    box.append(node('h3', { class: 'sub' }, '副词条与权重'));

    const hint = node('p', { class: 'hint' });
    hint.append(document.createTextNode('只统计权重大于 0 的词条，默认口径暴击 1、暴伤 1。'));
    if (rollColumn) {
      hint.append(
        node('br'),
        document.createTextNode(
          '「初始档位」= 掉落时那一次成长取第几档，固定它可以算「初始最小 / 最大」的极端情况。',
        ),
      );
    }
    box.append(hint);

    const head = node('div', { class: `slot-head${rollColumn ? '' : ' two-col'}` });
    head.append(node('span', {}, '词条'), node('span', {}, '权重'));
    if (rollColumn) head.append(node('span', {}, '初始档位'));
    box.append(head);

    const rows = node('div', { class: `slot-rows${rollColumn ? '' : ' two-col'}`, id: `${idPrefix}slotRows` });
    box.append(rows);

    const warnNote = node('p', { class: 'hint warn', id: `${idPrefix}ignoredNote` });
    box.append(warnNote);

    // 一个委托处理三种交互：
    //   change → 两个下拉（词条 / 初始档位）
    //   input  → 权重数字框（边打字边出结果）
    //   click  → 权重的 − / + 按钮（按钮不产生 change/input，必须单独接）
    rows.addEventListener('change', onSlotEdit);
    rows.addEventListener('input', (ev) => {
      if ((ev.target as HTMLElement).dataset['key'] === 'weight') onSlotEdit(ev);
    });
    rows.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).dataset['key'] === 'step') onSlotEdit(ev);
    });

    function onSlotEdit(ev: Event): void {
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
          if (attr === '') cur.weight = 0;
          else if (!(cur.weight > 0)) cur.weight = 1;

          // 同一个词条只能占一个槽位：改成一个已被占用的词条时，两条互换
          const dupIdx = slots.findIndex((s, i) => i !== idx && s.attr === attr);
          if (attr !== '' && dupIdx >= 0) {
            const other = slots[dupIdx]!;
            other.attr = previous;
            if (previous === '') other.weight = 0;
          }
          break;
        }
        case 'weight': {
          const raw = (t as HTMLInputElement).value.trim();
          // 允许中间态（空串 / 只有负号）：交给 toSpec 去忽略，不要在这里抛错
          cur.weight = raw === '' ? 0 : Number(raw);
          break;
        }
        case 'step': {
          const delta = Number(t.dataset['delta']);
          const next = cur.weight + delta;
          // 只在 0 处夹住；两位小数就够，避免 0.1 反复加减攒出 0.30000000000000004
          cur.weight = Math.max(0, Math.round(next * 100) / 100);
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
        const row = node('div', { class: 'slot-row' });

        const sel = node('select', { 'data-slot': String(i), 'data-key': 'attr' });
        sel.append(option('', '（不计分）', slot.attr === ''));
        for (const a of allowed) sel.append(option(a, a, a === slot.attr));
        // 词条可能已不可选（主词条被改成同名词条），此时退回「不计分」，
        // 与 `toSpec` 对冲突词条的处理一致
        sel.value = allowed.includes(slot.attr as SubAttr) ? slot.attr : '';

        const stepper = node('div', { class: 'stepper' });
        const minus = node('button', {
          type: 'button',
          class: 'step',
          'data-slot': String(i),
          'data-key': 'step',
          'data-delta': String(-WEIGHT_STEP),
          'aria-label': '减小权重',
        }, '−');
        const input = node('input', {
          type: 'number',
          min: '0',
          step: String(WEIGHT_STEP),
          inputmode: 'decimal',
          'data-slot': String(i),
          'data-key': 'weight',
          'aria-label': `${slot.attr || `第 ${i + 1} 条`}的权重`,
        });
        input.value = String(slot.weight);
        const plus = node('button', {
          type: 'button',
          class: 'step',
          'data-slot': String(i),
          'data-key': 'step',
          'data-delta': String(WEIGHT_STEP),
          'aria-label': '增大权重',
        }, '+');
        stepper.append(minus, input, plus);

        const roll = rollColumn
          ? node('select', { 'data-slot': String(i), 'data-key': 'roll' })
          : null;
        if (roll) fillRollOptions(roll, slot.attr, slot.weight, slot.initialRoll);

        row.append(sel, stepper);
        if (roll) row.append(roll);
        rows.append(row);

        syncRow(row, slot);
      });
    }

    /** 减号在 0 处禁用；档位下拉的标签跟着词条与权重走 */
    function syncRow(row: HTMLElement, slot: SlotInput): void {
      const minus = row.querySelector<HTMLButtonElement>('.step[data-delta^="-"]');
      if (minus) minus.disabled = !(slot.weight > 0);
      const roll = row.querySelector<HTMLSelectElement>('select[data-key="roll"]');
      if (roll) fillRollOptions(roll, slot.attr, slot.weight, slot.initialRoll);
    }

    return { box, refresh: render };
  }

  /** 初始词条数（只属于「得分分布」） */
  function initialVisibleField(): HTMLElement {
    const sel = node('select', { id: 'initialVisible' });
    sel.append(option('4', '4 词条', state.initialVisible === 4));
    sel.append(option('3', '3 词条', state.initialVisible === 3));
    sel.value = String(state.initialVisible);
    sel.addEventListener('change', () => {
      setState({ initialVisible: Number(sel.value) === 3 ? 3 : 4 });
    });
    return field('掉落时可见的词条数', sel);
  }

  /** 目标分数（只属于「得分分布」） */
  function targetField(): HTMLElement {
    const input = node('input', { id: 'targetScore', type: 'number', step: '0.5', min: '0' });
    input.value = String(state.targetScore);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= 0) setState({ targetScore: v });
    });
    return field('目标分数', input);
  }

  // -------------------------------------------------------------------------
  // Tab 1：得分分布
  // -------------------------------------------------------------------------

  const growthTab: Tab = {
    id: 'growth',
    label: '得分分布',
    blurb: '胚子练满 +20 之后的得分分布（含 5 次成长）',

    controls(host) {
      const panel = node('form', { class: 'panel sticky', id: 'form' });
      panel.addEventListener('submit', (ev) => ev.preventDefault());
      panel.append(node('h2', {}, '配置'));
      panel.append(mainAttrField('mainAttr'));
      panel.append(initialVisibleField());

      const slots = slotsField('', true);
      panel.append(slots.box);
      panel.append(targetField());
      panel.append(globalActions);

      host.append(panel);
      this.syncControls = () => {
        slots.refresh();
        const note = panel.querySelector<HTMLElement>('#ignoredNote');
        const { ignored } = toSpec(state);
        if (note) {
          note.textContent = ignored.length > 0 ? `已忽略权重非法的词条：${ignored.join('、')}` : '';
        }
      };
    },

    mount(host, tabCtx) {
      const tooltip = tabCtx.tooltip;
      const cards = node('section', { class: 'cards', id: 'cards' });
      const summary = node('p', { class: 'summary', id: 'summary' });
      host.append(cards, summary);

      const scorePanel = node('section', { class: 'panel' });
      scorePanel.append(node('h2', {}, '每个分数的概率构成'));
      scorePanel.append(
        node(
          'p',
          { class: 'hint' },
          '每根柱子是一个可能的最终分数，柱子越高说明越容易练到这个分数；' +
            '颜色表示这部分的概率来自「有效词条多命中了几次」。把鼠标移到柱子上看明细。',
        ),
      );
      const scoreChart = node('div', { class: 'chart-wrap', id: 'scoreChart' });
      scorePanel.append(scoreChart);
      host.append(scorePanel);

      const survPanel = node('section', { class: 'panel' });
      survPanel.append(node('h2', {}, '「至少 X 分」的概率'));
      survPanel.append(
        node(
          'p',
          { class: 'hint' },
          '生存曲线：横轴是分数线，纵轴是「得分不低于该线」的概率，' +
            '所以从左上角一路递减到右下角。纵轴是独立的 0~100%，不与上图共用比例。',
        ),
      );
      const survChart = node('div', { class: 'chart-wrap', id: 'survChart' });
      survPanel.append(survChart);
      host.append(survPanel);

      const hitPanel = node('section', { class: 'panel' });
      hitPanel.append(node('h2', {}, '命中次数分布'));
      hitPanel.append(
        node(
          'p',
          { class: 'hint' },
          '「命中 h 次」= 计分词条一共吃到的成长次数 − 计分词条数（掉落时的初始档位不算成长）。',
        ),
      );
      const hitChart = node('div', { class: 'chart-wrap', id: 'hitChart' });
      const hit = dataTable(['命中有效词条', '概率', '大致多少次出一个'], 'hitTable');
      hitPanel.append(hitChart, hit.table);
      host.append(hitPanel);

      const qPanel = node('section', { class: 'panel' });
      qPanel.append(node('h2', {}, '分位分数线'));
      qPanel.append(
        node('p', { class: 'hint' }, '「只有 α 的概率能达到该分数及以上」——想要更稳就得接受更高的分数线。'),
      );
      const quantile = dataTable(['目标概率 α', '需要的分数线', '大致要刷'], 'quantileTable');
      qPanel.append(quantile.table);
      host.append(qPanel);

      let table: DistributionTable | null = null;
      let data: StackedDatum[] = [];
      let hitLabels: string[] = [];

      this.update = () => {
        const { spec, ignored, scoredCount } = toSpec(state);
        let next: DistributionTable;
        try {
          next = scoreDistribution(spec);
        } catch (err) {
          summary.textContent = '';
          cards.replaceChildren(node('p', { class: 'error' }, `计算失败：${(err as Error).message}`));
          scoreChart.replaceChildren();
          survChart.replaceChildren();
          hitChart.replaceChildren();
          hit.body.replaceChildren();
          quantile.body.replaceChildren();
          return;
        }
        table = next;

        const byHit = pmfByHit(table);
        data = table.scores.map((s, i) => ({
          score: s,
          byHit: byHit.map((row) => row[i] ?? 0),
        }));
        hitLabels = Array.from({ length: table.hitBuckets }, (_, h) => `命中 ${h} 次`);

        const p = probAtLeast(table, state.targetScore);
        const attempts = expectedAttempts(table, state.targetScore);
        const hitProbs = hitProbabilities(table);
        const best = table.scores[table.scores.length - 1] ?? 0;
        const fixedRolls = state.slots.filter((s) => s.weight > 0 && s.initialRoll !== 'random').length;

        summary.textContent =
          `当前配置：${scoredCount} 个计分词条 · ${state.initialVisible} 词条胚子 · ` +
          `目标 ${fmtScore(state.targetScore)} 分` +
          (fixedRolls > 0 ? ` · ${fixedRolls} 条固定初始档位` : '') +
          '。' +
          (ignored.length > 0 ? `（权重非法、已忽略：${ignored.join('、')}）` : '');

        cards.replaceChildren(
          card('目标分数', `${fmtScore(state.targetScore)} 分`, '在左栏修改'),
          card('达到概率', pct(p), `得分 ≥ ${fmtScore(state.targetScore)}`),
          card('大致要刷', attempts ? oneIn(attempts) : '不可能', '按 1/p 估算，单位「个胚子」'),
          card('最高可能分', fmtScore(best), `计分槽位 ${scoredCount}/4`),
        );

        scoreChart.replaceChildren(
          renderScoreBars({
            data,
            hitLabels,
            title: `${state.mainAttr}主词条 · ${state.initialVisible} 词条胚子`,
            marker: { score: state.targetScore, label: `目标 ${fmtScore(state.targetScore)}` },
            tooltip,
          }),
        );

        survChart.replaceChildren(
          renderSurvival({
            scores: table.scores,
            survival: survival(table),
            title: 'P(得分 ≥ 分数线)',
            // `exactOptionalPropertyTypes` 下不能用 `marker: undefined`，只能用展开
            ...(p > 0
              ? {
                  marker: {
                    score: state.targetScore,
                    label: `目标 ${fmtScore(state.targetScore)} 分 · ${pct(p)}`,
                  },
                }
              : {}),
            tooltip,
          }),
        );

        hitChart.replaceChildren(
          renderHistogram({
            items: hitProbs.map((h) => ({
              label: `命中 ${h.hits} 次`,
              value: h.p,
              color: hitColor(h.hits),
              note: `平均 ${oneIn(1 / h.p)}`,
            })),
            title: '各命中档的出现概率',
            tooltip,
          }),
        );

        hit.body.replaceChildren(
          ...hitProbs.map((h) => {
            const tr = node('tr');
            tr.append(node('td', {}, `命中 ${h.hits} 次`));
            tr.append(node('td', {}, pct(h.p)));
            tr.append(node('td', {}, oneIn(1 / h.p)));
            return tr;
          }),
        );

        quantile.body.replaceChildren(
          ...[0.5, 0.1, 0.01].map((alpha) => {
            const q = scoreAtAlpha(table!, alpha);
            const tr = node('tr');
            tr.append(node('td', {}, `前 ${alpha * 100}%`));
            if (q === undefined) {
              tr.append(node('td', {}, '—'), node('td', {}, '超出可能范围'));
            } else {
              tr.append(node('td', {}, `${fmtScore(q)} 分`));
              tr.append(node('td', {}, oneIn(1 / probAtLeast(table!, q))));
            }
            return tr;
          }),
        );
      };
    },
  };

  // -------------------------------------------------------------------------
  // Tab 2：胚子质量（未强化）
  // -------------------------------------------------------------------------

  const qualityTab: Tab = {
    id: 'quality',
    label: '胚子质量',
    blurb: '刚掉落、一次没强化的胚子本身有多好（不含成长）',

    controls(host) {
      const panel = node('form', { class: 'panel sticky', id: 'form' });
      panel.addEventListener('submit', (ev) => ev.preventDefault());
      panel.append(node('h2', {}, '配置'));
      panel.append(
        node('p', { class: 'hint' }, '这个任务只看掉落那一刻，所以不需要「初始词条数」和「目标分数」。'),
      );
      panel.append(mainAttrField('mainAttr'));

      const slots = slotsField('', false);
      panel.append(slots.box);
      panel.append(globalActions);

      host.append(panel);
      this.syncControls = () => {
        slots.refresh();
        const note = panel.querySelector<HTMLElement>('#ignoredNote');
        const { ignored } = toSpec(state);
        if (note) {
          note.textContent = ignored.length > 0 ? `已忽略权重非法的词条：${ignored.join('、')}` : '';
        }
      };
    },

    mount(host, tabCtx) {
      const tooltip = tabCtx.tooltip;
      const cards = node('section', { class: 'cards' });
      const note = node('p', { class: 'hint' });
      host.append(cards, note);

      const qPanel = node('section', { class: 'panel' });
      qPanel.append(node('h2', {}, '掉落时的得分分布'));
      const qHint = node('p', { class: 'hint' });
      qHint.append(
        document.createTextNode('这里只统计'),
        node('b', {}, '掉落那一刻'),
        document.createTextNode(
          '的 4 个副词条，得分 = 有效词条的权重之和，没有强化成长。' +
            '和「得分分布」页的差别，就是「运气」与「运气 + 强化」的差别。',
        ),
      );
      qPanel.append(qHint);
      const qChart = node('div', { class: 'chart-wrap' });
      qPanel.append(qChart);
      host.append(qPanel);

      const pPanel = node('section', { class: 'panel' });
      pPanel.append(node('h2', {}, '组合概率'));
      pPanel.append(
        node('p', { class: 'hint' }, '掉落的 4 个副词条落在各有效词条组合上的概率；概率过小的长尾合并为「其他」。'),
      );
      const pieWrap = node('div', { class: 'pie-wrap' });
      const pieSvg = node('div', { class: 'pie-box' });
      const pieLegend = node('div', { class: 'pie-legend-html' });
      pieWrap.append(pieSvg, pieLegend);
      pPanel.append(pieWrap);
      host.append(pPanel);

      const aPanel = node('section', { class: 'panel' });
      aPanel.append(node('h2', {}, '每条有效词条出现的概率'));
      aPanel.append(
        node('p', { class: 'hint' }, '「这件胚子里含有该词条」的概率。因为词条不能重复，它并不等于权重占比。'),
      );
      const attrTable = dataTable(['词条', '出现概率', '权重', '平均多少个胚子带它']);
      aPanel.append(attrTable.table);
      host.append(aPanel);

      this.update = () => {
        let d: QualityDistribution;
        try {
          d = qualityDistribution({ mainAttr: state.mainAttr, weights: weightMap(state) });
        } catch (err) {
          note.textContent = `计算失败：${(err as Error).message}`;
          cards.replaceChildren();
          qChart.replaceChildren();
          pieSvg.replaceChildren();
          pieLegend.replaceChildren();
          attrTable.body.replaceChildren();
          return;
        }

        note.textContent =
          `主词条 ${state.mainAttr}` +
          (d.droppedAttr ? ` · 「${d.droppedAttr}」不会再出现在副词条里` : '') +
          (d.attrs.length === 0 ? ' · 还没有填写任何计分词条' : '');

        cards.replaceChildren(
          card('有效词条', `${d.attrs.length} 条`, d.attrs.join(' / ') || '—'),
          card('期望得分', fmtScore(d.mean), '掉落时，不是练满后'),
          card('最高可能分', fmtScore(d.best), '有效词条全部命中'),
          card(
            '最常见的组合',
            d.mode ? pct(d.mode.p) : '—',
            d.mode ? comboLabel(d.mode.combo) : '—',
          ),
        );

        const buckets = d.buckets.filter((b) => b.score > 0);
        qChart.replaceChildren(
          renderHistogram({
            items: (buckets.length > 0 ? buckets : d.buckets).map((b) => ({
              label: fmtScore(b.score),
              value: b.p,
              note: b.combos.length > 1 ? `${b.combos.length} 种组合同分` : undefined,
            })),
            title: '掉落时得分',
            tooltip,
          }),
        );

        const slices = pieSlices(d.combos, { maxSlices: 8, minShare: 0.005 });
        pieSvg.replaceChildren(renderPie({ items: slices, title: '组合概率', tooltip }));
        pieLegend.replaceChildren(
          ...slices.map((s, i) => {
            const row = node('div', { class: 'legend-row' });
            const dot = node('span', { class: 'legend-dot' });
            dot.style.background = hitColor(i);
            row.append(dot, node('span', { class: 'legend-name' }, s.label));
            row.append(node('span', { class: 'legend-val' }, pct(s.p)));
            return row;
          }),
        );

        const weights = weightMap(state);
        attrTable.body.replaceChildren(
          ...d.attrProbs
            .slice()
            .sort((a, b) => b.p - a.p)
            .map((a) => {
              const tr = node('tr');
              tr.append(node('td', {}, a.attr));
              tr.append(node('td', {}, pct(a.p)));
              tr.append(node('td', {}, String(weights[a.attr] ?? 0)));
              tr.append(node('td', {}, a.p > 0 ? oneIn(1 / a.p) : '—'));
              return tr;
            }),
        );
      };
    },
  };

  // -------------------------------------------------------------------------
  // Tab 3：占位
  // -------------------------------------------------------------------------

  const moreTab: Tab = {
    id: 'more',
    label: '更多',
    blurb: '',
    controls(host) {
      const panel = node('div', { class: 'panel sticky' });
      panel.append(node('h2', {}, '配置'));
      panel.append(node('p', { class: 'hint' }, '这个 tab 还没有内容。'));
      panel.append(globalActions);
      host.append(panel);
    },
    mount(host) {
      const panel = node('section', { class: 'panel' });
      panel.append(node('h2', {}, '还没做的'));
      const list = node('ul', { class: 'todo' });
      for (const t of [
        '胚子质量里的「主词条 → 副词条」热力图（归档 plot_substat_heatmap，数据已备好）',
        '3 词条 / 4 词条混合掉落（按副本、合成台分别设比例）',
        '图表导出 PNG / SVG',
      ]) {
        list.append(node('li', {}, t));
      }
      panel.append(list);
      host.append(panel);
    },
  };

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

  /**
   * 只刷新「当前可见」的 tab：把隐藏的图也一起重算纯属浪费
   * （得分分布一次计算 5~20ms，每敲一个字符都算三遍没有意义）。
   * 但**非当前 tab 必须被标记为过期**，否则切回去看到的是旧输入的图。
   */
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

    // 配置栏整体换掉：**每个任务的配置本来就不一样**
    configHost.replaceChildren();
    tab.controls(configHost, ctx);

    // 结果面板只挂载一次，之后靠 `hidden` 切换。
    // 不能「切走就 removeChild」：各 tab 的 update 闭包捕获的是自己那批节点，
    // 节点被摘掉之后再切回来，update 会往已经脱离文档的节点里写，界面就是空的。
    for (const panel of panelHost.children) {
      (panel as HTMLElement).hidden = panel.getAttribute('data-tab') !== tab.id;
    }
    if (!mountedTabs.has(tab.id)) {
      const panel = node('section', {
        class: 'tab-panel',
        id: `panel-${tab.id}`,
        role: 'tabpanel',
        'aria-labelledby': `tab-${tab.id}`,
        'data-tab': tab.id,
      });
      if (tab.blurb) panel.append(node('p', { class: 'tab-blurb' }, tab.blurb));
      panelHost.append(panel);
      tab.mount(panel, ctx);
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

  /** 只刷新当前 tab，并把其余已挂载的 tab 记为过期 */
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
  // 事件
  // -------------------------------------------------------------------------

  function applyTheme(theme: 'light' | 'dark'): void {
    document.documentElement.dataset['theme'] = theme;
    themeBtn.textContent = theme === 'dark' ? '切到浅色' : '切到深色';
  }

  function setState(next: Partial<AppState>): void {
    state = { ...state, ...next };
    render();
  }

  resetBtn.addEventListener('click', () => {
    setState({ ...defaultShared(), ...defaultGrowth() });
  });

  shareBtn.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?${toQuery(state)}#${activeTab}`;
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = '已复制 ✓';
      setTimeout(() => {
        shareBtn.textContent = '复制链接';
      }, 1500);
    } catch {
      // 剪贴板不可用（file:// 等）时退化为可手动复制
      window.prompt('复制下面的链接：', url);
    }
  });

  themeBtn.addEventListener('click', () => {
    setState({ theme: state.theme === 'dark' ? 'light' : 'dark' });
  });

  window.addEventListener('hashchange', () => {
    const id = readTabFromHash();
    if (id !== activeTab) selectTab(id, false);
  });

  // -------------------------------------------------------------------------

  function render(): void {
    applyTheme(state.theme);
    // 只同步「配置栏」的既有节点，**不重建**：目标分数输入框正在被输入时，
    // 重建会夺走焦点，表现为「打字打一半光标飞了」。
    TAB_IMPL[activeTab]?.syncControls?.();
    refreshActiveTab();
  }

  selectTab(activeTab, false);
  render();
}
