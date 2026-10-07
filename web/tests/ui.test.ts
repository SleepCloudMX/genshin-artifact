/**
 * 界面冒烟测试：在 jsdom 里真实挂载一次，验证 tab、子 tab、表单、图表与表格都能渲染，
 * 并且交互（切 tab、切子 tab、改权重、改档位）不会抛错。
 *
 * 这类测试的价值在于挡住「改 core 的签名后忘了改 UI」这类断裂，
 * 以及「切过去是空白」这类在单页应用里最容易发生的事故。
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { mount } from '../src/ui/app';
import * as C from '../src/ui/copy';
import { GROWTH_ORDER } from '../src/core/stats';
import {
  CANONICAL_WEIGHT,
  defaultState,
  fromQuery,
  toQuery,
  toSpec,
  selectableAttrs,
  isExcludedByMain,
  nextWeightUp,
  nextWeightDown,
  weightMap,
} from '../src/ui/state';

function freshRoot(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById('app')!;
}

/**
 * jsdom 里整个文件共用一个 `location`，而且**不能直接给 `location.search` 赋值**
 * （那会触发一次 jsdom 未实现的导航，赋值静默失效，测试之间互相污染）。
 * 必须走 `history.replaceState`。
 */
function resetUrl(search = '', hash = ''): void {
  history.replaceState(null, '', `${location.pathname}${search}${hash}`);
}

/**
 * 派发一个**会冒泡**的事件。
 *
 * `new Event('change')` 默认 `bubbles: false`，而界面用的是事件委托
 * （监听挂在 `#slotRows` 上），不冒泡就等于什么都没发生。
 */
function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function setSelect(el: HTMLSelectElement, value: string): void {
  el.value = value;
  fire(el, 'change');
}

function setInput(el: HTMLInputElement, value: string): void {
  el.value = value;
  fire(el, 'input');
}

/**
 * 权重框：**`change`（回车 / 失焦）才提交**。
 *
 * 派发 `input` 只等于「正在打字」，界面刻意不提交 —— 提交会重建整行、夺走焦点，
 * 那样连「清空重打」都做不到（见 `app.ts` 的委托注释）。
 */
function setWeight(el: HTMLInputElement, value: string): void {
  el.value = value;
  fire(el, 'change');
}

// ---- 查询助手（注意：配置栏每次状态变化会重建节点，不要缓存引用） ----

function weightInputs(root: HTMLElement): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>('#slotRows input[data-key="weight"]')];
}

function attrSelects(root: HTMLElement): HTMLSelectElement[] {
  return [...root.querySelectorAll<HTMLSelectElement>('#slotRows select[data-key="attr"]')];
}

function rollSelects(root: HTMLElement): HTMLSelectElement[] {
  return [...root.querySelectorAll<HTMLSelectElement>('#slotRows select[data-key="roll"]')];
}

/** 第 i 行的 − / + 两个按钮 */
function stepper(root: HTMLElement, i: number): { minus: HTMLButtonElement; plus: HTMLButtonElement } {
  const btns = [...root.querySelectorAll<HTMLButtonElement>('#slotRows button[data-key="step"]')].filter(
    (b) => b.dataset['slot'] === String(i),
  );
  return { minus: btns[0]!, plus: btns[1]! };
}

function clickTab(root: HTMLElement, id: string): void {
  root.querySelector<HTMLButtonElement>(`#tab-${id}`)!.click();
}

/**
 * 切到某个部位，再选一个该部位**合法**的主词条。
 *
 * 主词条下拉现在按部位限定，所以「直接设 mainAttr」常常是非法值
 * （暴击只有头能出）。测试必须走这两步，和生产路径一致。
 */
function pickSlotAndMain(root: HTMLElement, slot: string, main: string): void {
  setSelect(root.querySelector<HTMLSelectElement>('#slot')!, slot);
  setSelect(root.querySelector<HTMLSelectElement>('#mainAttr')!, main);
}

/** 点当前主 tab 里标签为 `label` 的子 tab */
function clickSub(root: HTMLElement, label: string): void {
  const panel = root.querySelector<HTMLElement>('.tab-panel:not([hidden])')!;
  const btn = [...panel.querySelectorAll<HTMLButtonElement>('.subtab')].find(
    (b) => b.textContent === label,
  )!;
  btn.click();
}

function subLabels(root: HTMLElement): string[] {
  const panel = root.querySelector<HTMLElement>('.tab-panel:not([hidden])')!;
  return [...panel.querySelectorAll('.subtab')].map((b) => b.textContent ?? '');
}

/**
 * 当前可见的**子**面板。
 *
 * 必须限定在「当前可见的主 tab」里：所有主 tab 的面板都留在 DOM 中（靠 `hidden` 切换），
 * 因此 `'.subtab-panel:not([hidden])'` 会先命中**别的**主 tab 里那个可见的子面板。
 */
function visibleSubPanel(root: HTMLElement): HTMLElement {
  const main = root.querySelector<HTMLElement>('.tab-panel:not([hidden])')!;
  return main.querySelector<HTMLElement>('.subtab-panel:not([hidden])')!;
}

/** 当前可见结果的指标卡数值 */
function cardValues(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.tab-panel:not([hidden]) .card-value')].map(
    (n) => n.textContent ?? '',
  );
}

// ---------------------------------------------------------------------------

describe('默认配置', () => {
  beforeEach(() => resetUrl());

  it('主词条默认火伤 —— 它不在副词条池里，副词条可选集才是完整的', () => {
    const s = defaultState();
    expect(s.mainAttr).toBe('火伤');
    // 元素伤害类主词条不会占用任何副词条
    expect(selectableAttrs(s.mainAttr)).toHaveLength(10);
  });

  it('默认口径：暴击 2、暴伤 1、其余 0', () => {
    const s = defaultState();
    expect(s.slots[0]).toEqual({ attr: '暴击', weight: 2, initialRoll: 'random' });
    expect(s.slots[1]).toEqual({ attr: '暴伤', weight: 1, initialRoll: 'random' });
    for (const attr of ['大攻击', '充能', '精通', '小生命'] as const) {
      expect(CANONICAL_WEIGHT[attr], `${attr} 的默认权重`).toBe(0);
    }
    expect(CANONICAL_WEIGHT['暴击']).toBe(2);
    expect(CANONICAL_WEIGHT['暴伤']).toBe(1);
  });

  it('默认后两行留空不计分', () => {
    const s = defaultState();
    expect(s.slots[2]!.attr).toBe('');
    expect(s.slots[3]!.attr).toBe('');
    expect(s.slots[2]!.weight).toBe(0);
    expect(s.slots[3]!.weight).toBe(0);
  });

  it('默认是浅色', () => {
    expect(defaultState().theme).toBe('light');
  });

  it('挂载后界面上的默认值与 defaultState 一致', () => {
    const root = freshRoot();
    mount(root);
    expect(root.querySelector<HTMLSelectElement>('#mainAttr')!.value).toBe('火伤');
    expect(weightInputs(root).map((i) => i.value).slice(0, 2)).toEqual(['2', '1']);
    expect(attrSelects(root)[0]!.value).toBe('暴击');
    expect(attrSelects(root)[1]!.value).toBe('暴伤');
  });

  it('副词条下拉里不会出现当前主词条（哪怕权重是 0）', () => {
    const root = freshRoot();
    mount(root);
    // 部位与主词条必须搭配合法：暴击/爆伤只在头，大攻击三处都有
    for (const attr of ['大攻击', '暴击', '爆伤']) {
      pickSlotAndMain(root, '头', attr);
      const expected = attr === '爆伤' ? '暴伤' : attr;
      for (const sel of attrSelects(root)) {
        const values = [...sel.options].map((o) => o.value);
        expect(values, `主词条 ${attr} 时下拉里出现了自己`).not.toContain(expected);
      }
      expect(attrSelects(root).map((s) => s.value)).not.toContain(expected);
    }
  });

  it('选中词条后权重自动取该词条的默认值', () => {
    const root = freshRoot();
    mount(root);
    // 第 3 行本来是空的
    setSelect(attrSelects(root)[2]!, '暴击');
    // 暴击已被第 1 行占着 → 两条互换；第 1 行拿到空词条、权重 0
    expect(weightInputs(root)[0]!.value).toBe('0');
    expect(weightInputs(root)[2]!.value).toBe('2');

    setSelect(attrSelects(root)[3]!, '暴伤');
    expect(weightInputs(root)[3]!.value).toBe('1');
  });

  it('选「不计分」会把权重清零', () => {
    const root = freshRoot();
    mount(root);
    setSelect(attrSelects(root)[0]!, '');
    expect(weightInputs(root)[0]!.value).toBe('0');
  });
});

describe('权重：− / + 与数字框', () => {
  beforeEach(() => resetUrl());

  it('每个词条只有一个数字权重框，没有权重下拉', () => {
    const root = freshRoot();
    mount(root);
    expect(root.querySelectorAll('#slotRows select[data-key="weight"]')).toHaveLength(0);
    expect(weightInputs(root)).toHaveLength(4);
  });

  it('每行一个 − 和一个 + 夹着数字框', () => {
    const root = freshRoot();
    mount(root);
    for (let i = 0; i < 4; i++) {
      const { minus, plus } = stepper(root, i);
      expect(minus.textContent).toBe('−');
      expect(plus.textContent).toBe('+');
      expect(minus.parentElement).toBe(plus.parentElement);
      expect(minus.parentElement!.querySelector('input[data-key="weight"]')).not.toBeNull();
    }
  });

  it('+ 从 0 直接落到该词条的默认权重（一次点击，不用点二十下）', () => {
    const root = freshRoot();
    mount(root);
    // 第 4 行空着、权重 0
    expect(weightInputs(root)[3]!.value).toBe('0');

    // 先给它一个暴伤 → 权重自动 1
    setSelect(attrSelects(root)[3]!, '暴伤');
    expect(weightInputs(root)[3]!.value).toBe('1');

    // 归零后再点 + → 回到默认 1
    stepper(root, 3).minus.click();
    expect(weightInputs(root)[3]!.value).toBe('0');
    stepper(root, 3).plus.click();
    expect(weightInputs(root)[3]!.value).toBe('1');
  });

  it('− 从默认权重直接归零', () => {
    const root = freshRoot();
    mount(root);
    expect(weightInputs(root)[0]!.value).toBe('2');
    stepper(root, 0).minus.click();
    expect(weightInputs(root)[0]!.value).toBe('0');
  });

  it('非默认权重按 0.1 步进', () => {
    const root = freshRoot();
    mount(root);
    setWeight(weightInputs(root)[0]!, '1.5');
    stepper(root, 0).plus.click();
    expect(weightInputs(root)[0]!.value).toBe('1.6');
    stepper(root, 0).minus.click();
    stepper(root, 0).minus.click();
    expect(weightInputs(root)[0]!.value).toBe('1.4');
  });

  it('反复加减不会攒出浮点误差（不会变成 0.30000000000000004）', () => {
    const root = freshRoot();
    mount(root);
    const read = () => weightInputs(root)[0]!.value;
    // 从 0 起步的第一次会跳到该词条的默认权重（暴击 → 2），
    // 所以累积检查要从一个非默认起点开始
    setWeight(weightInputs(root)[0]!, '0.1');
    stepper(root, 0).plus.click();
    expect(read()).toBe('0.2');
    stepper(root, 0).plus.click();
    expect(read()).toBe('0.3');
    stepper(root, 0).minus.click();
    stepper(root, 0).minus.click();
    expect(read()).toBe('0.1');
  });

  it('权重为 0 时 − 不可用，+ 可用', () => {
    const root = freshRoot();
    mount(root);
    expect(stepper(root, 2).minus.disabled).toBe(true);
    expect(stepper(root, 2).plus.disabled).toBe(false);
    stepper(root, 2).plus.click();
    expect(stepper(root, 2).minus.disabled).toBe(false);
  });

  it('− 不会把权重压到负数', () => {
    const root = freshRoot();
    mount(root);
    setWeight(weightInputs(root)[0]!, '0.05');
    stepper(root, 0).minus.click();
    expect(weightInputs(root)[0]!.value).toBe('0');
  });

  it('nextWeightUp / nextWeightDown 的落点', () => {
    expect(nextWeightUp('暴击', 0)).toBe(2); // 默认权重
    expect(nextWeightUp('暴伤', 0)).toBe(1);
    expect(nextWeightUp('充能', 0)).toBe(1); // 默认 0 → 落到 1（不是 0.1）
    expect(nextWeightUp('暴击', 2)).toBe(2.1);
    expect(nextWeightDown('暴击', 2)).toBe(0); // 正好在默认值 → 归零
    expect(nextWeightDown('暴击', 1.9)).toBe(1.8);
    expect(nextWeightDown('充能', 1)).toBe(0.9); // 默认 0 → 没有「归零落点」，按步长
    expect(nextWeightDown('', 0)).toBe(0);
  });

  it('权重框要按回车 / 失焦才提交，打字过程中不动结果', () => {
    const root = freshRoot();
    mount(root);
    const before = cardValues(root)[3]!; // 最高可能分跟着权重走
    const input = weightInputs(root)[1]!; // 第 2 行：暴伤，权重 1

    input.value = '0.25';
    fire(input, 'input');
    expect(cardValues(root)[3]).toBe(before); // 只是打字，还没提交

    fire(input, 'change'); // 回车 / 失焦
    expect(cardValues(root)[3]).not.toBe(before);
    expect(weightInputs(root)[1]!.value).toBe('0.25');
    expect(root.querySelector('.error')).toBeNull();
  });

  it('提交后不重建整行 —— 否则焦点和刚敲的字都会被丢掉', () => {
    const root = freshRoot();
    mount(root);
    const input = weightInputs(root)[1]!;
    input.value = '0.25';
    fire(input, 'change');
    // 还是同一个节点、还是刚敲的值：说明配置栏只做同步，没有 replaceChildren
    expect(weightInputs(root)[1]).toBe(input);
    expect(input.value).toBe('0.25');
  });

  it('权重留空按 0 处理，不抛错', () => {
    const root = freshRoot();
    mount(root);
    setWeight(weightInputs(root)[0]!, '');
    expect(root.querySelector('.error')).toBeNull();
    expect(visibleSubPanel(root).querySelector('svg')).not.toBeNull();
  });
});

describe('初始档位（第三列）', () => {
  beforeEach(() => resetUrl());

  it('每行一个档位下拉，选项是「随机 + 四档」', () => {
    const root = freshRoot();
    mount(root);
    const rolls = rollSelects(root);
    expect(rolls).toHaveLength(4);
    for (const sel of rolls) {
      expect([...sel.options].map((o) => o.value)).toEqual(['random', '0', '1', '2', '3']);
      expect(sel.value).toBe('random');
    }
  });

  it('档位选项带数值（按词条的实际成长值 × 权重）', () => {
    const root = freshRoot();
    mount(root);
    // 第 1 行是暴击，权重 2 → 四档 2.72/3.11/3.50/3.89 × 2
    const labels = [...rollSelects(root)[0]!.options].map((o) => o.textContent);
    expect(labels[0]).toBe(C.ROLL_RANDOM);
    expect(labels[1]).toBe('5.44');
    expect(labels[4]).toBe('7.78');
  });

  it('改词条后档位标签跟着换', () => {
    const root = freshRoot();
    mount(root);
    setSelect(attrSelects(root)[0]!, '充能');
    const labels = [...rollSelects(root)[0]!.options].map((o) => o.textContent);
    // 充能没有默认口径 → 选中时权重 1，档位标签就是原始成长值
    expect(labels).toContain('4.53');
    expect(labels).toContain('6.48');
  });

  it('固定初始档位会真的改变分布', () => {
    const root = freshRoot();
    mount(root);
    // 注意：**最高可能分不会变**。最高分来自「每次都取顶档」，随机分布本来就含这条路径。
    // 真正会变的是达到高分线的概率。
    setInput(root.querySelector<HTMLInputElement>('#targetScore')!, '45');
    const probOf = () => cardValues(root)[1]!;

    const randomP = probOf();
    setSelect(rollSelects(root)[0]!, '0');
    const lowP = probOf();
    setSelect(rollSelects(root)[0]!, '3');
    const highP = probOf();

    expect(lowP).not.toBe(randomP);
    expect(highP).not.toBe(randomP);
    const num = (s: string) => Number(s.replace('%', ''));
    expect(num(lowP)).toBeLessThan(num(randomP));
    expect(num(randomP)).toBeLessThan(num(highP));
  });

  it('固定档位会写进分享链接并能读回来', () => {
    const s = defaultState();
    s.slots[0]!.initialRoll = 2;
    expect(fromQuery('?' + toQuery(s)).slots[0]!.initialRoll).toBe(2);
    // 老链接（只有 词条:权重 两段）回落到 random
    const old = fromQuery('?main=火伤&slots=' + encodeURIComponent('暴击:2,暴伤:1,:0,:0'));
    expect(old.slots[0]!.initialRoll).toBe('random');
    expect(old.slots[0]!.weight).toBe(2);
  });
});

describe('主 tab 与子 tab', () => {
  beforeEach(() => resetUrl());

  it('三个主 tab，默认停在「得分分布」', () => {
    const root = freshRoot();
    mount(root);
    expect(root.querySelectorAll('.tabs .tab')).toHaveLength(3);
    expect(root.querySelector('#tab-growth')!.classList.contains('on')).toBe(true);
    expect(root.querySelector('[data-tab="quality"]')).toBeNull();
  });

  it('得分分布页有五个子 tab，且默认只显示第一个', () => {
    const root = freshRoot();
    mount(root);
    expect(subLabels(root)).toEqual([
      C.SUB_DIST,
      C.SUB_SURVIVAL,
      C.SUB_HITS,
      C.SUB_QUANTILE,
      C.SUB_GROWTHS,
    ]);
    expect(root.querySelectorAll('.subtab-panel:not([hidden])')).toHaveLength(1);
    expect(visibleSubPanel(root).querySelector('#scoreChart svg')).not.toBeNull();
  });

  it('「成长值」子 tab 列出全部 10 条词条的四档成长值', () => {
    const root = freshRoot();
    mount(root);
    clickSub(root, C.SUB_GROWTHS);
    const rows = [...visibleSubPanel(root).querySelectorAll('#growthsTable tbody tr')];
    expect(rows).toHaveLength(GROWTH_ORDER.length);
    expect(GROWTH_ORDER).toHaveLength(10);
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual([...GROWTH_ORDER]);
    // 表头 + 数值都取表里的两位小数，不是游戏内显示的一位小数
    const head = [...visibleSubPanel(root).querySelectorAll('#growthsTable th')].map(
      (n) => n.textContent,
    );
    expect(head).toEqual([C.TH_GROWTH_ATTR, ...C.TH_GROWTH_TIERS]);
    const crit = rows.find((r) => r.textContent!.startsWith('暴击'))!;
    expect([...crit.querySelectorAll('td')].map((n) => n.textContent)).toEqual([
      '暴击',
      '2.72',
      '3.11',
      '3.5',
      '3.89',
    ]);
    // 一条不计分的词条也照样列出来
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toContain('小防御');

    // 口径措辞有讲究：**不能说成「游戏内部值」** —— 那两个小数本身就是四舍五入的结果，
    // 游戏内的精确值我们不知道（作者纠过一次，别再写回去）
    const hint = visibleSubPanel(root).querySelector('.hint')!.textContent!;
    expect(hint).toContain('不是游戏内的精确值');
    expect(hint).not.toContain('内部值');
  });

  it('每张图在自己的子 tab 里，切过去才渲染', () => {
    const root = freshRoot();
    mount(root);
    // 未进入的子 tab 是空的（省掉隐藏图表的计算）
    expect(visibleSubPanel(root).querySelector('#survChart')).toBeNull();

    clickSub(root, C.SUB_SURVIVAL);
    expect(visibleSubPanel(root).querySelector('#survChart svg')).not.toBeNull();
    expect(visibleSubPanel(root).querySelector('#scoreChart')).toBeNull();

    clickSub(root, C.SUB_HITS);
    expect(visibleSubPanel(root).querySelector('#hitChart svg')).not.toBeNull();
    expect(visibleSubPanel(root).querySelectorAll('#hitTable tbody tr').length).toBeGreaterThan(0);

    clickSub(root, C.SUB_QUANTILE);
    expect(visibleSubPanel(root).querySelectorAll('#quantileTable tbody tr')).toHaveLength(3);
  });

  it('切子 tab 后返回，图按当前输入重算', () => {
    const root = freshRoot();
    mount(root);
    const before = cardValues(root)[3]!;

    clickSub(root, C.SUB_SURVIVAL);
    // 在别的子 tab 上改输入
    stepper(root, 1).plus.click();
    clickSub(root, C.SUB_DIST);

    expect(visibleSubPanel(root).querySelector('#scoreChart svg')).not.toBeNull();
    expect(cardValues(root)[3]).not.toBe(before);
  });

  /**
   * 「达到概率」的浮框里要带一组横条：**≥ 该分数时命中次数的条件分布**。
   *
   * 这里验的是**接线**（core 的 `hitMixAtLeast` 真的接到了图上），
   * 数学本身在 `core.test.ts` 里逐格对过。
   */
  it('达到概率的浮框里有命中次数条件分布，且各条合计 100%', () => {
    const root = freshRoot();
    mount(root);
    clickSub(root, C.SUB_SURVIVAL);

    const panel = visibleSubPanel(root);
    const cols = panel.querySelectorAll('#survChart rect.hot-rect');
    expect(cols.length).toBeGreaterThan(0);
    // 挑一个分数线偏低的列：那里各命中档都还有质量，条数最多
    cols[2]!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    const tt = root.querySelector('.tooltip')!;
    expect(tt).not.toBeNull();
    expect((tt as HTMLElement).hidden).toBe(false);
    expect(tt.querySelector('.tt-chart-cap')!.textContent).toBe(C.HIT_MIX_CAPTION);

    const bars = [...tt.querySelectorAll('.tt-bar')];
    expect(bars.length).toBeGreaterThan(1);
    // 合计 100%（每条显示到 0.1%，所以允许 0.1% × 条数 的舍入）
    const sum = bars.reduce(
      (s, b) => s + Number(b.querySelector('.tt-bar-value')!.textContent!.replace('%', '')),
      0,
    );
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.1 * bars.length);
    // 条长 = 概率本身，不是随手画的
    for (const b of bars) {
      const shown = Number(b.querySelector('.tt-bar-value')!.textContent!.replace('%', ''));
      const width = Number(
        (b.querySelector('.tt-bar-fill') as HTMLElement).style.width.replace('%', ''),
      );
      expect(width).toBeCloseTo(shown, 0);
    }
  });

  it('切主 tab 会把左栏配置整体换掉', () => {
    const root = freshRoot();
    mount(root);
    expect(root.querySelector('#initialVisible')).not.toBeNull();
    expect(root.querySelector('#targetScore')).not.toBeNull();

    clickTab(root, 'quality');
    expect(root.querySelector('#initialVisible')).toBeNull();
    expect(root.querySelector('#targetScore')).toBeNull();
    // 初始档位是强化才有的事 → 「胚子质量」不显示这一列
    expect(root.querySelector('#slotRows select[data-key="roll"]')).toBeNull();

    clickTab(root, 'more');
    expect(root.querySelector('#slotRows')).toBeNull();

    clickTab(root, 'growth');
    expect(root.querySelector('#initialVisible')).not.toBeNull();
    expect(root.querySelector('#slotRows select[data-key="roll"]')).not.toBeNull();
  });

  it('切主 tab 回来时面板还在（不会因为被卸载而变空）', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');
    clickTab(root, 'growth');
    expect(root.querySelector<HTMLElement>('[data-tab="growth"]')!.hidden).toBe(false);
    expect(visibleSubPanel(root).querySelector('#scoreChart svg')).not.toBeNull();
  });

  it('#hash 能直接打开指定主 tab', () => {
    resetUrl('', '#quality');
    const root = freshRoot();
    mount(root);
    expect(root.querySelector('[data-tab="quality"]')).not.toBeNull();
  });

  it('「更多」tab 有内容', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'more');
    expect(root.querySelectorAll('[data-tab="more"] ul.todo li').length).toBeGreaterThan(0);
  });

  it('胚子质量页有三个子 tab，且都有内容', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');
    expect(subLabels(root)).toEqual([C.SUB_QUALITY_DIST, C.SUB_COMBOS, C.SUB_ATTRS]);
    expect(visibleSubPanel(root).querySelector('svg')).not.toBeNull();

    clickSub(root, C.SUB_COMBOS);
    expect(visibleSubPanel(root).querySelectorAll('svg.pie path.pie-slice').length).toBeGreaterThan(0);
    expect(visibleSubPanel(root).querySelectorAll('.legend-row').length).toBeGreaterThan(0);

    clickSub(root, C.SUB_ATTRS);
    expect(visibleSubPanel(root).querySelectorAll('table.data tbody tr').length).toBeGreaterThan(0);
  });

  it('在质量页改权重，切回得分分布时结果也是新的', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');
    stepper(root, 1).plus.click(); // 暴伤 1 → 1.1
    clickTab(root, 'growth');
    expect(cardValues(root)[3]).not.toBe('50.7');
  });

  it('两个 tab 共用同一份评分标准（含部位）', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');
    pickSlotAndMain(root, '头', '暴击');
    clickTab(root, 'growth');
    expect(root.querySelector<HTMLSelectElement>('#slot')!.value).toBe('头');
    expect(root.querySelector<HTMLSelectElement>('#mainAttr')!.value).toBe('暴击');
    expect(attrSelects(root).map((s) => s.value)).not.toContain('暴击');
  });
});

describe('分桶（柱数太多时合并相邻分数）', () => {
  beforeEach(() => resetUrl());

  /** 「概率分布」子 tab 里的分桶下拉 */
  function bucketSelect(root: HTMLElement): HTMLSelectElement {
    return visibleSubPanel(root).querySelector<HTMLSelectElement>('#bucketSize')!;
  }


  it('分桶下拉的档位是 0.1/0.2/0.5/1/2/5，默认 0.2', () => {
    const root = freshRoot();
    mount(root);
    expect([...bucketSelect(root).options].map((o) => o.value)).toEqual([
      '0.1',
      '0.2',
      '0.5',
      '1',
      '2',
      '5',
    ]);
    // 默认档写死在 state.defaultGrowth 里，**不按柱数自动挑**：
    // 自动挑的档会随输入悄悄变，看起来还是同一个视图，比例尺却换了
    expect(bucketSelect(root).value).toBe('0.2');
    expect(defaultState().bucketSize).toBe(0.2);
  });

  /** 图上柱子根数（按热区数算） */
  function barCount(root: HTMLElement): number {
    return visibleSubPanel(root).querySelectorAll('#scoreChart rect.hot-rect').length;
  }

  it('默认 0.2 分桶：把相邻的分数并成一根柱子', () => {
    const root = freshRoot();
    mount(root);
    // 默认配置（暴击 2 / 暴伤 1、4 词条）有 75 个可能分数，0.2 分桶后 66 根
    expect(barCount(root)).toBe(66);
  });

  it('0.1 = 不分桶：一个可能分数一根柱子', () => {
    const root = freshRoot();
    mount(root);
    setSelect(bucketSelect(root), '0.1');
    expect(barCount(root)).toBe(75);
  });

  it('档位越粗，柱子越少', () => {
    const root = freshRoot();
    mount(root);
    setSelect(bucketSelect(root), '1');
    expect(barCount(root)).toBe(45);
    setSelect(bucketSelect(root), '2');
    expect(barCount(root)).toBe(23);
  });

  it('选的档位会生效，并写进分享链接', () => {
    const root = freshRoot();
    mount(root);
    setSelect(bucketSelect(root), '2');
    expect(bucketSelect(root).value).toBe('2');

    // 往返：bucket 参数能读回来
    const s = { ...defaultState(), bucketSize: 2 };
    expect(fromQuery('?' + toQuery(s)).bucketSize).toBe(2);
    // 分桶没有「没选过」这个状态，一律写进链接（默认值也是）
    expect(toQuery(defaultState())).toContain('bucket=0.2');
    // 老链接（没有 bucket）回落到默认档，而不是 0 / 自动挑
    expect(fromQuery('?main=%E7%81%AB%E4%BC%A4&slots=a:1:random,b:1:random,c:1:random,d:1:random')
      .bucketSize).toBe(0.2);
  });

  it('分桶后轴标号仍是 0.1 网格（不带浮点毛刺）', () => {
    const root = freshRoot();
    mount(root);
    setSelect(bucketSelect(root), '2');
    const labels = [...visibleSubPanel(root).querySelectorAll('text.axis-label')].map(
      (n) => n.textContent ?? '',
    );
    for (const l of labels) expect(l).not.toMatch(/\.\d{2,}/);
  });
});

describe('页面文案', () => {
  beforeEach(() => resetUrl());

  it('没有「复制链接」按钮（配置本来就能写进 URL，按钮多余）', () => {
    const root = freshRoot();
    mount(root);
    expect(root.querySelector('#shareBtn')).toBeNull();
    expect(root.textContent).not.toContain('复制链接');
  });

  it('「重置」在配置面板标题行里，和「配置」同行', () => {
    const root = freshRoot();
    mount(root);
    const head = root.querySelector('#config .panel-head')!;
    expect(head.querySelector('h2')!.textContent).toBe(C.CONFIG);
    expect(head.querySelector('#resetBtn')).not.toBeNull();
  });

  it('主题按钮是图标，文字只在 title / aria-label 里', () => {
    const root = freshRoot();
    mount(root);
    const btn = root.querySelector<HTMLButtonElement>('#themeBtn')!;
    expect(btn.textContent).toBe('');
    expect(btn.querySelector('svg')).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe(C.THEME_TO_DARK);

    btn.click();
    expect(btn.getAttribute('aria-label')).toBe(C.THEME_TO_LIGHT);
    expect(btn.querySelector('svg')).not.toBeNull();
  });

  it('标题行右侧有源码仓库链接，与主题按钮并排', () => {
    const root = freshRoot();
    mount(root);
    const link = root.querySelector<HTMLAnchorElement>('#repoLink')!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe(C.REPO_URL);
    expect(link.getAttribute('aria-label')).toBe(C.REPO_LINK);
    // 新窗口打开，且不要 referrer / opener
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.querySelector('svg')).not.toBeNull();
    expect(link.textContent).toBe('');

    // 两个图标同属一个靠右的容器 —— 否则 `margin-left: auto` 只会推第一个
    const actions = root.querySelector('.title-actions')!;
    expect(actions.querySelectorAll('#repoLink, #themeBtn')).toHaveLength(2);
  });

  it('切主题不影响结果', () => {
    const root = freshRoot();
    mount(root);
    const before = cardValues(root);
    root.querySelector<HTMLButtonElement>('#themeBtn')!.click();
    expect(cardValues(root)).toEqual(before);
  });

  it('配置栏不出现「初始档位」的长篇解释', () => {
    const root = freshRoot();
    mount(root);
    const hint = root.querySelector('#config .hint')!.textContent ?? '';
    expect(hint.length).toBeLessThan(60);
  });

  it('页面里不残留 Markdown 记号', () => {
    const root = freshRoot();
    mount(root);
    for (const id of ['growth', 'quality', 'more']) {
      clickTab(root, id);
      const panel = root.querySelector(`[data-tab="${id}"]`)!;
      const text = (panel.textContent ?? '') + (root.querySelector('#config')!.textContent ?? '');
      expect(text, `${id} 里有 Markdown 残留`).not.toMatch(/\*\*|^\s*[-*]\s/m);
    }
  });

  it('没有「约 约」这种重复前缀', () => {
    const root = freshRoot();
    mount(root);
    clickSub(root, C.SUB_HITS);
    for (const td of visibleSubPanel(root).querySelectorAll('td')) {
      expect(td.textContent ?? '').not.toMatch(/约\s*约/);
    }
  });
});

describe('得分分布页', () => {
  beforeEach(() => resetUrl());

  it('四张指标卡：掉落概率 / 达到概率 / 大致要刷 / 最高可能分', () => {
    const root = freshRoot();
    mount(root);
    const labels = [...root.querySelectorAll('.tab-panel:not([hidden]) .card-label')].map(
      (n) => n.textContent,
    );
    expect(labels).toEqual([C.CARD_DROP, C.CARD_REACH, C.CARD_ATTEMPTS, C.CARD_BEST]);
    expect(cardValues(root)).toHaveLength(4);
  });

  it('卡片里不再放「目标分数」——它是输入，摆在结果里像算出来的', () => {
    const root = freshRoot();
    mount(root);
    const labels = [...root.querySelectorAll('.tab-panel:not([hidden]) .card-label')].map(
      (n) => n.textContent,
    );
    expect(labels).not.toContain('目标分数');
  });

  it('掉落概率卡片给出概率与「部位 × 主词条 × 副词条」的拆解', () => {
    const root = freshRoot();
    mount(root);
    const card = root.querySelector('.tab-panel:not([hidden]) .card')!;
    expect(card.querySelector('.card-label')!.textContent).toBe(C.CARD_DROP);
    // 火伤主词条 + 要暴击暴伤
    expect(Number((card.querySelector('.card-value')!.textContent ?? '').replace('%', ''))).toBeGreaterThan(0);
    expect(card.querySelector('.card-note')!.textContent).toContain('主词条');
  });

  it('掉落概率随要求的副词条增多而下降', () => {
    const root = freshRoot();
    mount(root);
    const dropOf = () =>
      Number((root.querySelector('.tab-panel:not([hidden]) .card-value')!.textContent ?? '').replace('%', ''));

    const two = dropOf();
    // 把第 3 行也变成计分词条
    setSelect(attrSelects(root)[2]!, '充能');
    const three = dropOf();
    expect(three).toBeLessThan(two);
  });

  it('掉落概率 = 主词条概率 × 副词条概率', () => {
    const root = freshRoot();
    mount(root);
    // 空之杯主词条火伤 = 200/4000 = 5%
    const card = root.querySelector('.tab-panel:not([hidden]) .card')!;
    expect(card.querySelector('.card-note')!.textContent).toContain('主词条 5.00%');
  });

  it('切到花 / 羽时主词条固定，且主词条概率为 1', () => {
    const root = freshRoot();
    mount(root);
    setSelect(root.querySelector<HTMLSelectElement>('#slot')!, '花');
    const sel = root.querySelector<HTMLSelectElement>('#mainAttr')!;
    expect(sel.disabled).toBe(true);
    // 主词条固定 → 只剩下副词条的约束，概率不再是 0
    expect(cardValues(root)[0]).not.toBe('0%');
    expect(root.querySelector('.tab-panel:not([hidden]) .card-note')!.textContent).toContain(
      '主词条 100.00%',
    );
  });

  it('主词条火伤、暴击2暴伤1、4 词条时最高分是 54.5', () => {
    const root = freshRoot();
    mount(root);
    // 暴击 2（四档 2.72~3.89）+ 暴伤 1（5.44~7.77），5 次成长全给暴击：
    // 6 × 3.89 × 2 + 1 × 7.77 = 54.45 → 四舍五入 54.5
    // （用游戏内显示值会算成 6 × 3.9 × 2 + 7.8 = 54.6，偏高 0.1）
    expect(cardValues(root)[3]).toBe('54.5');
    expect(root.querySelector('.summary')).toBeNull(); // 概览句已删
  });

  it('切换词条数会改变可达到的命中档位', () => {
    const root = freshRoot();
    mount(root);
    clickSub(root, C.SUB_HITS);
    const has = (s: string) => visibleSubPanel(root).textContent!.includes(s);
    expect(has('命中 5 次')).toBe(true);

    setSelect(root.querySelector<HTMLSelectElement>('#initialVisible')!, '3');
    expect(has('命中 5 次')).toBe(false);
  });

  it('目标分数越大，达到概率越小', () => {
    const root = freshRoot();
    mount(root);
    const target = root.querySelector<HTMLInputElement>('#targetScore')!;
    setInput(target, '10');
    const low = cardValues(root)[1]!;
    setInput(target, '50');
    expect(cardValues(root)[1]).not.toBe(low);
  });

  it('无计分槽位时不崩', () => {
    const root = freshRoot();
    mount(root);
    for (const input of weightInputs(root)) setWeight(input, '0');
    expect(visibleSubPanel(root).querySelector('svg')).not.toBeNull();
    expect(root.querySelector('.error')).toBeNull();
  });
});

describe('主题', () => {
  beforeEach(() => resetUrl());

  it('可以切到深色再切回来', () => {
    const root = freshRoot();
    mount(root);
    const btn = root.querySelector<HTMLButtonElement>('#themeBtn')!;
    expect(document.documentElement.dataset['theme']).toBe('light');
    btn.click();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    btn.click();
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});

describe('配置序列化', () => {
  beforeEach(() => resetUrl());

  it('toQuery / fromQuery 往返一致', () => {
    const s = defaultState();
    const back = fromQuery('?' + toQuery(s));
    expect(back.mainAttr).toBe(s.mainAttr);
    expect(back.initialVisible).toBe(s.initialVisible);
    expect(back.targetScore).toBe(s.targetScore);
    for (let i = 0; i < 4; i++) {
      expect(back.slots[i]!.attr).toBe(s.slots[i]!.attr);
      expect(back.slots[i]!.weight).toBe(s.slots[i]!.weight);
      expect(back.slots[i]!.initialRoll).toBe(s.slots[i]!.initialRoll);
    }
  });

  it('深色主题也能往返', () => {
    const s = { ...defaultState(), theme: 'dark' as const };
    expect(fromQuery('?' + toQuery(s)).theme).toBe('dark');
  });

  it('非法 query 回退到默认值', () => {
    const s = defaultState();
    expect(fromQuery('?main=不存在').mainAttr).toBe(s.mainAttr);
    expect(fromQuery('').mainAttr).toBe(s.mainAttr);
    expect(fromQuery('?slots=a:1').mainAttr).toBe(s.mainAttr);
    expect(fromQuery('?slot=头&main=暴击&slots=暴击:2,xx:1,yy:1,zz:1').slots[1]!.attr).toBe('');
    // 主词条与部位不搭时回落到该部位的合法主词条
    expect(fromQuery('?slot=沙&main=火伤&slots=暴击:2,暴伤:1,:0,:0').mainAttr).not.toBe('火伤');
  });

  it('query 里主词条与副词条冲突时，界面上会清掉冲突项', () => {
    resetUrl(
      `?slot=${encodeURIComponent('头')}&main=${encodeURIComponent('暴击')}&slots=${encodeURIComponent('暴击:2,暴伤:1,大攻击:1,充能:1')}`,
    );
    const el = freshRoot();
    mount(el);
    expect(toSpec(fromQuery(location.search)).ignored).toContain('暴击');
    expect(el.querySelector<HTMLSelectElement>('#mainAttr')!.value).toBe('暴击');
    const attrs = attrSelects(el).map((s) => s.value);
    expect(attrs).not.toContain('暴击');
    expect(attrs).toContain('暴伤');
  });
});

describe('状态 → 计算输入', () => {
  beforeEach(() => resetUrl());

  it('权重 > 0 的词条按固定顺序占槽位', () => {
    const { spec, scoredCount } = toSpec(defaultState());
    expect(scoredCount).toBe(2);
    expect(spec.slots[0]).toEqual({ attr: '暴击', weight: 2, initialRoll: 'random' });
    expect(spec.slots[1]).toEqual({ attr: '暴伤', weight: 1, initialRoll: 'random' });
    expect(spec.slots[2]!.weight).toBe(0);
    expect(spec.slots[3]!.weight).toBe(0);
  });

  it('权重非法时忽略该词条，而不是抛错', () => {
    const s = defaultState();
    s.slots[0]!.weight = Number.NaN;
    const { spec, ignored, scoredCount } = toSpec(s);
    expect(ignored).toContain('暴击');
    expect(scoredCount).toBe(1);
    expect(spec.slots[0]!.weight).toBe(1); // 暴伤顶上来
  });

  it('主词条冲突的词条被剔除', () => {
    const s = defaultState();
    s.mainAttr = '暴击';
    expect(toSpec(s).ignored).toContain('暴击');
  });

  it('weightMap 只保留权重 > 0 的条目', () => {
    expect(weightMap(defaultState())).toEqual({ 暴击: 2, 暴伤: 1 });
  });

  it('权重允许小数，但精度口径是两位小数', () => {
    const s = defaultState();
    s.slots[1]!.weight = 0.25; // 暴伤
    expect(toSpec(s).spec.slots[1]!.weight).toBe(0.25);

    // core 按 ×100 把权重变整数，第三位及以后会被丢掉 —— 在入口就归整，
    // 「界面上显示的值」与「真正参与运算的值」才是同一个
    s.slots[1]!.weight = 0.333;
    expect(toSpec(s).spec.slots[1]!.weight).toBe(0.33);

    // 归整后为 0 的等同不计分
    s.slots[1]!.weight = 0.001;
    expect(toSpec(s).scoredCount).toBe(1);
    expect(weightMap(s)).toEqual({ 暴击: 2 });
  });

  it('selectableAttrs 剔掉与主词条同名的副词条', () => {
    expect(selectableAttrs('暴击')).not.toContain('暴击');
    expect(selectableAttrs('暴伤')).not.toContain('暴伤');
    expect(selectableAttrs('火伤')).toHaveLength(10);
  });

  it('isExcludedByMain 认别名：爆伤主词条也算暴伤', () => {
    expect(isExcludedByMain('暴伤', '暴伤')).toBe(true);
    expect(isExcludedByMain('爆伤', '暴伤')).toBe(true);
    expect(isExcludedByMain('大攻击', '暴伤')).toBe(false);
    expect(isExcludedByMain('大攻击', '')).toBe(false);
  });
});
