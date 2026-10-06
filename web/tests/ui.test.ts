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
    for (const attr of ['大攻击', '暴击', '暴伤', '爆伤']) {
      setSelect(root.querySelector<HTMLSelectElement>('#mainAttr')!, attr);
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
    setInput(weightInputs(root)[0]!, '1.5');
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
    setInput(weightInputs(root)[0]!, '0.1');
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
    setInput(weightInputs(root)[0]!, '0.05');
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

  it('权重框仍可直接输入任意值', () => {
    const root = freshRoot();
    mount(root);
    setInput(weightInputs(root)[1]!, '0.25');
    expect(weightInputs(root)[1]!.value).toBe('0.25');
    expect(root.querySelector('.error')).toBeNull();
  });

  it('权重留空按 0 处理，不抛错', () => {
    const root = freshRoot();
    mount(root);
    setInput(weightInputs(root)[0]!, '');
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
    // 第 1 行是暴击，权重 2 → 四档 2.7/3.1/3.5/3.9 × 2
    const labels = [...rollSelects(root)[0]!.options].map((o) => o.textContent);
    expect(labels[0]).toBe(C.ROLL_RANDOM);
    expect(labels[1]).toBe('5.4');
    expect(labels[4]).toBe('7.8');
  });

  it('改词条后档位标签跟着换', () => {
    const root = freshRoot();
    mount(root);
    setSelect(attrSelects(root)[0]!, '充能');
    const labels = [...rollSelects(root)[0]!.options].map((o) => o.textContent);
    // 充能没有默认口径 → 选中时权重 1，档位标签就是原始成长值
    expect(labels).toContain('4.5');
    expect(labels).toContain('6.5');
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

  it('得分分布页有四个子 tab，且默认只显示第一个', () => {
    const root = freshRoot();
    mount(root);
    expect(subLabels(root)).toEqual([
      C.SUB_DIST,
      C.SUB_SURVIVAL,
      C.SUB_HITS,
      C.SUB_QUANTILE,
    ]);
    expect(root.querySelectorAll('.subtab-panel:not([hidden])')).toHaveLength(1);
    expect(visibleSubPanel(root).querySelector('#scoreChart svg')).not.toBeNull();
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

  it('两个 tab 共用同一份评分标准', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');
    setSelect(root.querySelector<HTMLSelectElement>('#mainAttr')!, '暴击');
    clickTab(root, 'growth');
    expect(root.querySelector<HTMLSelectElement>('#mainAttr')!.value).toBe('暴击');
    expect(attrSelects(root).map((s) => s.value)).not.toContain('暴击');
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

  it('四张指标卡', () => {
    const root = freshRoot();
    mount(root);
    expect(cardValues(root)).toHaveLength(4);
  });

  it('主词条火伤、暴击2暴伤1 时最高分是 55.4', () => {
    const root = freshRoot();
    mount(root);
    // 暴击 2（四档 2.7~3.9）+ 暴伤 1（5.4~7.8），满命中 5 次
    expect(Number(cardValues(root)[3])).toBeGreaterThan(0);
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
    for (const input of weightInputs(root)) setInput(input, '0');
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
    expect(fromQuery('?main=暴击&slots=暴击:2,xx:1,yy:1,zz:1').slots[1]!.attr).toBe('');
  });

  it('query 里主词条与副词条冲突时，界面上会清掉冲突项', () => {
    resetUrl(
      `?main=${encodeURIComponent('暴击')}&slots=${encodeURIComponent('暴击:2,暴伤:1,大攻击:1,充能:1')}`,
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
