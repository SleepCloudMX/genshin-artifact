/**
 * 界面装配。
 *
 * 结构：顶部是「输入」（主词条 / 词条数 / 词条与权重 / 目标分数），
 * 下面按 tab 分页展示不同的**独立问题**：
 *   - 「得分分布」：胚子练满 +20 之后的得分分布（`core/growth.ts`）；
 *   - 「胚子质量」：刚掉落、一次没强化的胚子本身有多好（`core/quality.ts`）；
 *   - 更多 tab 直接往 `TABS` 里加即可。
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
  type DistributionTable,
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
  defaultState,
  fromQuery,
  toQuery,
  isExcludedByMain,
  selectableAttrs,
  toSpec,
  weightMap,
  type AppState,
} from './state';
import { oneIn, pct, score as fmtScore } from './format';

// ---------------------------------------------------------------------------
// 小工具
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

function card(label: string, value: string, note?: string): HTMLElement {
  const box = node('div', { class: 'card' });
  box.append(node('div', { class: 'card-label' }, label));
  box.append(node('div', { class: 'card-value' }, value));
  if (note) box.append(node('div', { class: 'card-note' }, note));
  return box;
}

/** 一个 tab 的定义 */
interface Tab {
  id: string;
  label: string;
  /** 一句话说明这个 tab 回答什么问题 */
  blurb: string;
  /** 挂载（首次进入时调用一次） */
  mount(host: HTMLElement): void;
  /** 输入变化时调用；不需要响应式就省略 */
  update?(): void;
}

// ---------------------------------------------------------------------------

export function mount(root: HTMLElement): void {
  let state = fromQuery(location.search);
  // 注意：`activeTab` 要等 tab 表建好之后再解析（见下面 `selectTab` 之前）
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

  // ---- 左栏：输入 ----
  const form = node('form', { class: 'panel sticky', id: 'form' });
  form.addEventListener('submit', (ev) => ev.preventDefault());
  form.append(node('h2', {}, '配置'));

  const mainField = node('label', { class: 'field' });
  mainField.append(node('span', {}, '主词条'));
  const mainSel = node('select', { id: 'mainAttr' });
  mainField.append(mainSel);
  form.append(mainField);

  const ivField = node('label', { class: 'field' });
  ivField.append(node('span', {}, '掉落时可见的词条数'));
  const ivSel = node('select', { id: 'initialVisible' });
  ivSel.append(node('option', { value: '4' }, '4 词条'));
  ivSel.append(node('option', { value: '3' }, '3 词条'));
  ivField.append(ivSel);
  form.append(ivField);

  form.append(node('h3', { class: 'sub' }, '副词条与权重'));
  const hint = node('p', { class: 'hint' });
  hint.append(
    document.createTextNode('权重 = 这个词条值多少分；'),
    node('b', {}, '只统计权重大于 0 的词条'),
    document.createTextNode('。默认口径是暴击 1、暴伤 1。'),
  );
  form.append(hint);

  const slotHead = node('div', { class: 'slot-head' });
  slotHead.append(node('span', {}, '词条'), node('span', {}, '权重'));
  form.append(slotHead);

  const slotRows = node('div', { class: 'slot-rows', id: 'slotRows' });
  form.append(slotRows);

  const ignoredNote = node('p', { class: 'hint warn', id: 'ignoredNote' });
  form.append(ignoredNote);

  const targetField = node('label', { class: 'field' });
  targetField.append(node('span', {}, '目标分数'));
  const targetInput = node('input', { id: 'targetScore', type: 'number', step: '0.5', min: '0' });
  targetField.append(targetInput);
  form.append(targetField);

  const actions = node('div', { class: 'actions' });
  const shareBtn = node('button', { type: 'button', class: 'ghost', id: 'shareBtn' }, '复制链接');
  const resetBtn = node('button', { type: 'button', class: 'ghost', id: 'resetBtn' }, '重置');
  actions.append(shareBtn, resetBtn);
  form.append(actions);

  // ---- 右栏：tab ----
  const results = node('main', { class: 'results' });
  const tabBar = node('div', { class: 'tabs', role: 'tablist' });
  const tabButtons = new Map<string, HTMLButtonElement>();
  const panelHost = node('div', { class: 'tab-panels', id: 'tabPanels' });
  results.append(tabBar, panelHost);

  const tooltipHost = node('div', { class: 'tooltip-host' });

  layout.append(form, results);
  root.append(layout, tooltipHost);

  const tooltip = new Tooltip(tooltipHost);

  // -------------------------------------------------------------------------
  // 左栏渲染
  // -------------------------------------------------------------------------

  function renderMainOptions(): void {
    mainSel.replaceChildren();
    for (const a of MAIN_ATTRS) {
      mainSel.append(node('option', { value: a }, a));
    }
    mainSel.value = state.mainAttr;
  }

  function renderSlotRows(): void {
    const allowed = selectableAttrs(state.mainAttr);
    slotRows.replaceChildren();
    state.slots.forEach((slot, i) => {
      const row = node('div', { class: 'slot-row' });

      const sel = node('select', { 'data-slot': String(i), 'data-key': 'attr' });
      sel.append(node('option', { value: '' }, '（不计分）'));
      for (const a of allowed) sel.append(node('option', { value: a }, a));
      // 词条可能已不可选（比如主词条被改成同名词条），此时退回「不计分」，
      // 与 `toSpec` 对冲突词条的处理保持一致，避免下拉显示成空白
      sel.value = allowed.includes(slot.attr as SubAttr) ? slot.attr : '';

      const input = node('input', {
        type: 'number',
        min: '0',
        step: '0.05',
        inputmode: 'decimal',
        'data-slot': String(i),
        'data-key': 'weight',
        'aria-label': `${slot.attr || '第 ' + (i + 1) + ' 条'}的权重`,
      });
      input.value = String(slot.weight);

      row.append(sel, input);
      slotRows.append(row);
    });
  }

  // -------------------------------------------------------------------------
  // Tab 1：得分分布
  // -------------------------------------------------------------------------

  const growthTab: Tab = {
    id: 'growth',
    label: '得分分布',
    blurb: '胚子练满 +20 之后的得分分布（含 5 次成长）',
    mount(host) {
      const cards = node('section', { class: 'cards', id: 'cards' });
      host.append(cards);

      const summary = node('p', { class: 'summary', id: 'summary' });
      host.append(summary);

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
      const hitTable = node('table', { class: 'data', id: 'hitTable' });
      hitPanel.append(hitChart, hitTable);
      host.append(hitPanel);

      const qPanel = node('section', { class: 'panel' });
      qPanel.append(node('h2', {}, '分位分数线'));
      qPanel.append(
        node('p', { class: 'hint' }, '「只有 α 的概率能达到该分数及以上」——想要更稳就得接受更高的分数线。'),
      );
      const quantileTable = node('table', { class: 'data', id: 'quantileTable' });
      qPanel.append(quantileTable);
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
          hitTable.replaceChildren();
          quantileTable.replaceChildren();
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

        summary.textContent =
          `当前配置：${scoredCount} 个计分词条 · ${state.initialVisible} 词条胚子 · ` +
          `目标 ${fmtScore(state.targetScore)} 分。` +
          (ignored.length > 0 ? `（权重非法、已忽略：${ignored.join('、')}）` : '');

        cards.replaceChildren(
          card('目标分数', `${fmtScore(state.targetScore)} 分`, '滑动或直接输入'),
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
              ? { marker: { score: state.targetScore, label: `目标 ${fmtScore(state.targetScore)} 分 · ${pct(p)}` } }
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

        const thead = node('thead');
        const hr = node('tr');
        for (const t of ['命中有效词条', '概率', '大致多少次出一个']) hr.append(node('th', {}, t));
        thead.append(hr);
        const tbody = node('tbody');
        for (const h of hitProbs) {
          const tr = node('tr', { class: 'hoverable' });
          tr.append(node('td', {}, `命中 ${h.hits} 次`));
          tr.append(node('td', {}, pct(h.p)));
          tr.append(node('td', {}, oneIn(1 / h.p)));
          tbody.append(tr);
        }
        hitTable.replaceChildren(thead, tbody);

        const qHead = node('thead');
        const qr = node('tr');
        for (const t of ['目标概率 α', '需要的分数线', '大致要刷']) qr.append(node('th', {}, t));
        qHead.append(qr);
        const qBody = node('tbody');
        for (const alpha of [0.5, 0.1, 0.01]) {
          const q = scoreAtAlpha(table, alpha);
          const tr = node('tr');
          tr.append(node('td', {}, `前 ${alpha * 100}%`));
          if (q === undefined) {
            tr.append(node('td', {}, '—'), node('td', {}, '超出可能范围'));
          } else {
            const pq = probAtLeast(table, q);
            tr.append(node('td', {}, `${fmtScore(q)} 分`));
            tr.append(node('td', {}, oneIn(1 / pq)));
          }
          qBody.append(tr);
        }
        quantileTable.replaceChildren(qHead, qBody);
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
    mount(host) {
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
      const attrTable = node('table', { class: 'data' });
      aPanel.append(attrTable);
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
          attrTable.replaceChildren();
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

        const thead = node('thead');
        const hr = node('tr');
        for (const t of ['词条', '出现概率', '权重', '平均多少个胚子带它']) hr.append(node('th', {}, t));
        thead.append(hr);
        const tbody = node('tbody');
        const weights = weightMap(state);
        d.attrProbs
          .slice()
          .sort((a, b) => b.p - a.p)
          .forEach((a) => {
            const tr = node('tr');
            tr.append(node('td', {}, a.attr));
            tr.append(node('td', {}, pct(a.p)));
            tr.append(node('td', {}, String(weights[a.attr] ?? 0)));
            tr.append(node('td', {}, a.p > 0 ? oneIn(1 / a.p) : '—'));
            tbody.append(tr);
          });
        attrTable.replaceChildren(thead, tbody);
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
    mount(host) {
      const panel = node('section', { class: 'panel' });
      panel.append(node('h2', {}, '还没做的'));
      const list = node('ul', { class: 'todo' });
      for (const t of [
        '胚子质量里的「主词条 → 副词条」热力图（归档 plot_substat_heatmap）',
        '3 词条 / 4 词条混合掉落（按副本、合成台分别设比例）',
        '成长档位对初始档位的依赖（目前假定掉落时的初始档位与后续成长同分布）',
        '图表导出 PNG / SVG',
      ]) {
        list.append(node('li', {}, t));
      }
      panel.append(list);
      host.append(panel);
    },
  };

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
   * tab 的挂载/刷新。
   *
   * 只刷新「当前可见」的那个 tab：把隐藏的图也一起重算纯属浪费
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

    // 面板**只挂载一次**，之后靠 `hidden` 切换。
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
      tab.mount(panel);
      mountedTabs.add(tab.id);
    }

    tooltip.hide();
    staleTabs.delete(tab.id);
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

  mainSel.addEventListener('change', () => {
    const mainAttr = mainSel.value as MainAttr;
    // 主词条不能同时当副词条：冲突的槽位清空
    const slots = state.slots.map((s) =>
      isExcludedByMain(mainAttr, s.attr) ? { attr: '' as const, weight: 0 } : { ...s },
    ) as AppState['slots'];
    setState({ mainAttr, slots });
  });

  ivSel.addEventListener('change', () => {
    setState({ initialVisible: Number(ivSel.value) === 3 ? 3 : 4 });
  });

  targetInput.addEventListener('input', () => {
    const v = Number(targetInput.value);
    if (Number.isFinite(v) && v >= 0) setState({ targetScore: v });
  });

  const onSlotEdit = (ev: Event): void => {
    const t = ev.target as HTMLSelectElement | HTMLInputElement;
    const idxRaw = t.dataset['slot'];
    if (idxRaw === undefined) return;
    const idx = Number(idxRaw);
    const slots = state.slots.map((s) => ({ ...s })) as AppState['slots'];
    const cur = slots[idx]!;

    if (t.dataset['key'] === 'attr') {
      const attr = (t as HTMLSelectElement).value as SubAttr | '';
      const previous = cur.attr;
      cur.attr = attr;
      if (attr === '') {
        cur.weight = 0;
      } else if (!(cur.weight > 0)) {
        cur.weight = 1;
      }

      // 同一个词条只能占一个槽位：改成一个已被占用的词条时，两条互换
      const dupIdx = slots.findIndex((s, i) => i !== idx && s.attr === attr);
      if (attr !== '' && dupIdx >= 0) {
        const other = slots[dupIdx]!;
        other.attr = previous;
        if (previous === '') other.weight = 0;
      }
    } else {
      const raw = (t as HTMLInputElement).value.trim();
      // 允许中间态（空串 / 只有负号）：交给 toSpec 去忽略，不要在这里抛错
      cur.weight = raw === '' ? 0 : Number(raw);
    }
    setState({ slots });
  };
  slotRows.addEventListener('change', onSlotEdit);
  slotRows.addEventListener('input', (ev) => {
    if ((ev.target as HTMLElement).dataset['key'] === 'weight') onSlotEdit(ev);
  });

  resetBtn.addEventListener('click', () => setState(defaultState()));

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
    renderMainOptions();
    ivSel.value = String(state.initialVisible);
    if (document.activeElement !== targetInput) targetInput.value = String(state.targetScore);
    renderSlotRows();

    const { ignored } = toSpec(state);
    ignoredNote.textContent =
      ignored.length > 0 ? `已忽略权重非法的词条：${ignored.join('、')}` : '';

    refreshActiveTab();
  }

  selectTab(activeTab, false);
  render();
}
