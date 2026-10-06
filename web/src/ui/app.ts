/**
 * 界面装配：表单 → 计算 → 图表与数字。
 *
 * 界面只负责收集 ArtifactSpec 并展示 DistributionTable，
 * 所有数学都在 `src/core/`，可单独测试。
 */

import { MAIN_ATTRS, SUB_ATTRS, type MainAttr, type SubAttr } from '../core/stats';
import {
  scoreDistribution,
  pmfByHit,
  hitProbabilities,
  probAtLeast,
  expectedAttempts,
  scoreAtAlpha,
  type ArtifactSpec,
  type DistributionTable,
} from '../core/growth';
import { renderStackedChart, type StackedDatum } from '../render/charts';
import {
  defaultState,
  fromQuery,
  toQuery,
  WEIGHT_PRESETS,
  type AppState,
  type SlotInput,
} from './state';
import { oneIn, pct, score as fmtScore, weight as fmtWeight } from './format';

const DEAD_FALLBACK: SubAttr = '小防御';

/** 主词条不可能是副词条：从可选列表里剔除 */
function selectableAttrs(main: MainAttr): SubAttr[] {
  return SUB_ATTRS.filter((a) => a !== main);
}

function buildSpec(state: AppState): ArtifactSpec {
  const slots = state.slots.map((s) => ({
    // 空槽位用一个合法词条占位；weight = 0 时它对得分没有影响
    attr: (s.attr === '' ? DEAD_FALLBACK : s.attr) as SubAttr,
    weight: s.weight,
  }));
  return {
    slots: slots as unknown as ArtifactSpec['slots'],
    initialVisible: state.initialVisible,
  };
}

/** 计算表格 + 全部派生指标 */
function computeDerived(table: DistributionTable, state: AppState) {
  const byHit = pmfByHit(table).map((row) => table.scores.map((_, i) => row[i] ?? 0));
  const data: StackedDatum[] = table.scores.map((s, i) => ({
    score: s,
    byHit: byHit.map((row) => row[i] ?? 0),
  }));
  const hitLabels = Array.from(
    { length: table.hitBuckets },
    (_, h) => `命中 ${h} 次`,
  );
  const p = probAtLeast(table, state.targetScore);
  return {
    data,
    hitLabels,
    target: {
      score: state.targetScore,
      p,
      attempts: expectedAttempts(table, state.targetScore),
    },
    hitProbs: hitProbabilities(table),
    // 常用的几个分位：前 50% / 10% / 1%
    quantiles: [0.5, 0.1, 0.01].map((a) => ({ alpha: a, score: scoreAtAlpha(table, a) })),
    best: table.scores[table.scores.length - 1]!,
    mean: table.scores.reduce((s, sc, i) => s + sc * (table.hits[i]!.reduce((x, y) => x + y, 0) / table.total), 0),
  };
}

export function mount(root: HTMLElement): void {
  let state = fromQuery(location.search);

  // ---- DOM 骨架 ----
  root.innerHTML = `
    <header class="hero">
      <h1>圣遗物词条概率分布</h1>
      <p>
        给定主词条、初始词条数与各副词条的计分权重，算出「胚子练满后得分」的
        <strong>完整概率分布</strong>——不是给单件打分，而是回答「我有多大几率练出这样的」。
      </p>
    </header>

    <div class="layout">
      <form class="panel" id="form">
        <h2>配置</h2>

        <label class="field">
          <span>主词条</span>
          <select id="mainAttr"></select>
        </label>

        <label class="field">
          <span>掉落时可见的词条数</span>
          <select id="initialVisible">
            <option value="4">4 词条</option>
            <option value="3">3 词条</option>
          </select>
        </label>

        <fieldset class="slots">
          <legend>副词条与权重</legend>
          <p class="hint">
            权重决定「这个词条值多少分」。建议把主词条之外的<b>全部</b>有用词条都填上——
            没填的按 0 分算。3 词条胚子的第 4 个位置通常是「已知但无用」，权重填 0。
          </p>
          <div id="slotRows"></div>
        </fieldset>

        <label class="field">
          <span>目标分数</span>
          <input id="targetScore" type="number" step="0.1" min="0" />
        </label>

        <div class="actions">
          <button type="button" id="shareBtn" class="ghost">复制分享链接</button>
          <button type="button" id="resetBtn" class="ghost">重置</button>
        </div>
      </form>

      <main class="results">
        <section class="cards" id="cards"></section>

        <section class="panel">
          <h2>得分分布</h2>
          <div class="chart-wrap" id="chart"></div>
          <p class="hint" id="chartHint"></p>
        </section>

        <section class="panel">
          <h2>命中次数分布</h2>
          <table class="data" id="hitTable"></table>
        </section>

        <section class="panel">
          <h2>分位分数</h2>
          <p class="hint">「只有 α 的概率能达到该分数及以上」——分数越高，概率越小。</p>
          <table class="data" id="quantileTable"></table>
        </section>
      </main>
    </div>
  `;

  const $ = <T extends HTMLElement>(id: string): T => {
    const node = root.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`找不到 #${id}`);
    return node;
  };

  const mainSel = $<HTMLSelectElement>('mainAttr');
  const ivSel = $<HTMLSelectElement>('initialVisible');
  const targetInput = $<HTMLInputElement>('targetScore');
  const slotRows = $<HTMLDivElement>('slotRows');
  const chartHost = $<HTMLDivElement>('chart');
  const chartHint = $<HTMLParagraphElement>('chartHint');
  const cards = $<HTMLElement>('cards');
  const hitTable = $<HTMLTableElement>('hitTable');
  const quantileTable = $<HTMLTableElement>('quantileTable');

  function option(value: string, label: string, selected: boolean): string {
    return `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`;
  }

  function renderMainOptions(): void {
    mainSel.innerHTML = MAIN_ATTRS.map((a) => option(a, a, a === state.mainAttr)).join('');
  }

  function renderSlotRows(): void {
    const opts = selectableAttrs(state.mainAttr);
    slotRows.innerHTML = state.slots
      .map((slot, i) => {
        const attrOptions = [
          option('', '（不用）', slot.attr === ''),
          ...opts.map((a) => option(a, a, a === slot.attr)),
        ].join('');
        const weightOptions = WEIGHT_PRESETS.map((p) =>
          option(String(p.value), p.label, p.value === slot.weight),
        ).join('');
        // 允许预设之外的权重
        const custom =
          WEIGHT_PRESETS.some((p) => p.value === slot.weight)
            ? ''
            : option(String(slot.weight), fmtWeight(slot.weight), true);
        return `
          <div class="slot-row">
            <span class="slot-index">${i + 1}</span>
            <select data-slot="${i}" data-key="attr">${attrOptions}</select>
            <select data-slot="${i}" data-key="weight">${weightOptions}${custom}</select>
            <input type="number" step="0.1" min="0" data-slot="${i}" data-key="weightInput"
                   value="${slot.weight}" aria-label="自定义权重" />
          </div>`;
      })
      .join('');
  }

  function setState(next: Partial<AppState>): void {
    state = { ...state, ...next };
    render();
  }

  // ---- 事件 ----
  mainSel.addEventListener('change', () => {
    const mainAttr = mainSel.value as MainAttr;
    // 主词条不能同时当副词条：把冲突的槽位清掉
    const slots = state.slots.map((s) =>
      s.attr === mainAttr ? { attr: '' as const, weight: 0 } : s,
    ) as AppState['slots'];
    setState({ mainAttr, slots });
  });

  ivSel.addEventListener('change', () => {
    setState({ initialVisible: Number(ivSel.value) === 3 ? 3 : 4 });
  });

  targetInput.addEventListener('input', () => {
    const v = Number(targetInput.value);
    if (Number.isFinite(v)) setState({ targetScore: v });
  });

  slotRows.addEventListener('change', (ev) => {
    const t = ev.target as HTMLSelectElement | HTMLInputElement;
    const idxRaw = t.dataset['slot'];
    if (idxRaw === undefined) return;
    const idx = Number(idxRaw);
    const slots = [...state.slots] as AppState['slots'];
    const cur: SlotInput = { ...slots[idx]! };

    if (t.dataset['key'] === 'attr') {
      cur.attr = (t as HTMLSelectElement).value as SubAttr | '';
    } else {
      const w = Number(t.value);
      cur.weight = Number.isFinite(w) && w >= 0 ? w : 0;
    }
    slots[idx] = cur;
    setState({ slots });
  });

  $<HTMLButtonElement>('resetBtn').addEventListener('click', () => {
    setState(defaultState());
  });

  $<HTMLButtonElement>('shareBtn').addEventListener('click', async (ev) => {
    const url = `${location.origin}${location.pathname}?${toQuery(state)}`;
    try {
      await navigator.clipboard.writeText(url);
      (ev.target as HTMLButtonElement).textContent = '已复制 ✓';
      setTimeout(() => {
        (ev.target as HTMLButtonElement).textContent = '复制分享链接';
      }, 1500);
    } catch {
      // 剪贴板不可用时退化为选中地址栏提示
      prompt('复制下面的链接：', url);
    }
  });

  // ---- 渲染 ----
  function render(): void {
    renderMainOptions();
    ivSel.value = String(state.initialVisible);
    targetInput.value = String(state.targetScore);
    renderSlotRows();

    const spec = buildSpec(state);
    let table: DistributionTable;
    try {
      table = scoreDistribution(spec);
    } catch (err) {
      chartHost.innerHTML = `<p class="error">计算失败：${(err as Error).message}</p>`;
      cards.innerHTML = '';
      hitTable.innerHTML = '';
      quantileTable.innerHTML = '';
      return;
    }

    const d = computeDerived(table, state);
    const scored = state.slots.filter((s) => s.weight > 0 && s.attr !== '').length;

    // 顶部指标卡
    cards.innerHTML = [
      card('目标分数', fmtScore(d.target.score) + ' 分', ''),
      card('达到概率', pct(d.target.p), `≥ 目标分数（含）`),
      card(
        '大约需要',
        d.target.attempts ? oneIn(d.target.attempts) : '不可能',
        '按 1/p 估算，单位是「个胚子」',
      ),
      card('最高可能分', fmtScore(d.best) + ' 分', `计分槽位 ${scored}/4`),
    ].join('');

    // 图表
    chartHost.replaceChildren(
      renderStackedChart({
        data: d.data,
        hitLabels: d.hitLabels,
        showLabels: state.showLabels && d.data.length <= 60,
        title: `${state.mainAttr} · ${state.initialVisible} 词条 · 得分分布`,
      }),
    );
    chartHint.textContent =
      d.data.length > 60
        ? `共 ${d.data.length} 个可能分数，已省略柱上标注；把鼠标移到柱子上可看该分数的明细。`
        : `悬停柱状图可看该分数下各命中档的概率；红线是「≥ 该分数」的累积概率。`;

    // 命中次数分布
    hitTable.innerHTML = `
      <thead><tr><th>命中有效词条</th><th>概率</th><th>平均多少次出一个</th></tr></thead>
      <tbody>
        ${d.hitProbs
          .map(
            (h) =>
              `<tr><td>${h.hits} 次</td><td>${pct(h.p)}</td><td>${oneIn(1 / h.p)}</td></tr>`,
          )
          .join('')}
      </tbody>`;

    // 分位分数
    quantileTable.innerHTML = `
      <thead><tr><th>目标概率 α</th><th>需要的分数线</th><th>相当于</th></tr></thead>
      <tbody>
        ${d.quantiles
          .map((q) =>
            q.score === undefined
              ? `<tr><td>前 ${q.alpha * 100}%</td><td>—</td><td>该分数超出可能范围</td></tr>`
              : `<tr><td>前 ${q.alpha * 100}%</td><td>${fmtScore(q.score)} 分</td><td>约 ${oneIn(
                  1 / probAtLeast(table, q.score),
                )}出一个</td></tr>`,
          )
          .join('')}
      </tbody>`;
  }

  function card(label: string, value: string, note: string): string {
    return `<div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value">${value}</div>
      ${note ? `<div class="card-note">${note}</div>` : ''}
    </div>`;
  }

  render();
}
