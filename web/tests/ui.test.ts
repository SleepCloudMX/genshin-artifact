/**
 * 界面冒烟测试：在 jsdom 里真实挂载一次，验证 tab、表单、图表与表格都能渲染，
 * 并且交互（切 tab、换主词条、改权重）不会抛错。
 *
 * 这类测试的价值在于挡住「改 core 的签名后忘了改 UI」这类断裂，
 * 以及「tab 切过去是空白」这类在单页应用里最容易发生的事故。
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { mount } from '../src/ui/app';
import {
  defaultState,
  fromQuery,
  toQuery,
  toSpec,
  selectableAttrs,
  isExcludedByMain,
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

function slotWeightInputs(root: HTMLElement): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>('#slotRows input[data-key="weight"]')];
}

function slotAttrSelects(root: HTMLElement): HTMLSelectElement[] {
  return [...root.querySelectorAll<HTMLSelectElement>('#slotRows select[data-key="attr"]')];
}

function slotRollSelects(root: HTMLElement): HTMLSelectElement[] {
  return [...root.querySelectorAll<HTMLSelectElement>('#slotRows select[data-key="roll"]')];
}

function stepButtons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('#slotRows button[data-key="step"]')];
}

/** 第 i 行的 − / + 两个按钮 */
function stepperOf(root: HTMLElement, i: number): { minus: HTMLButtonElement; plus: HTMLButtonElement } {
  const btns = stepButtons(root).filter((b) => b.dataset['slot'] === String(i));
  return { minus: btns[0]!, plus: btns[1]! };
}

function clickTab(root: HTMLElement, id: string): void {
  root.querySelector<HTMLButtonElement>(`#tab-${id}`)!.click();
}

/**
 * 派发一个**会冒泡**的事件。
 *
 * `new Event('change')` 默认 `bubbles: false`，而界面用的是事件委托
 * （监听挂在 `#slotRows` 上），不冒泡就等于什么都没发生——
 * 这类「测试写错了却看起来像代码有 bug」的坑值得在这里写清楚。
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

describe('默认配置', () => {
  beforeEach(() => resetUrl());

  it('默认主词条是大攻击，副词条是暴击 / 暴伤，权重都是 1，档位随机', () => {
    const s = defaultState();
    expect(s.mainAttr).toBe('大攻击');
    expect(s.slots[0]).toEqual({ attr: '暴击', weight: 1, initialRoll: 'random' });
    expect(s.slots[1]).toEqual({ attr: '暴伤', weight: 1, initialRoll: 'random' });
    expect(s.initialVisible).toBe(4);
  });

  it('默认只有两条计分词条，后两行留空不计分', () => {
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
    expect(root.querySelector<HTMLSelectElement>('#mainAttr')!.value).toBe('大攻击');
    const w = slotWeightInputs(root).map((i) => i.value);
    expect(w[0]).toBe('1');
    expect(w[1]).toBe('1');
    expect(slotAttrSelects(root)[0]!.value).toBe('暴击');
    expect(slotAttrSelects(root)[1]!.value).toBe('暴伤');
  });

  it('副词条下拉里不会出现当前主词条（哪怕权重是 0）', () => {
    const root = freshRoot();
    mount(root);
    for (const attr of ['大攻击', '暴击', '暴伤', '爆伤']) {
      setSelect(root.querySelector<HTMLSelectElement>('#mainAttr')!, attr);
      const selects = slotAttrSelects(root);
      for (const sel of selects) {
        const values = [...sel.options].map((o) => o.value);
        // 主词条不能是副词条；爆伤/暴伤是同一条，两种写法都要挡住
        expect(values, `主词条 ${attr} 时下拉里出现了自己`).not.toContain(
          attr === '爆伤' ? '暴伤' : attr,
        );
      }
      // 具体选中的那一行也不能落在冲突词条上
      const chosen = selects.map((s) => s.value);
      expect(chosen).not.toContain(attr === '爆伤' ? '暴伤' : attr);
    }
  });

  it('默认配置下主词条大攻击不计分，最高分只由暴击暴伤决定', () => {
    const root = freshRoot();
    mount(root);
    // 暴击 1 + 暴伤 1，满命中 5 次 → 最高分固定
    expect(root.querySelectorAll('#cards .card-value')[3]!.textContent).toBe('50.7');
    expect(root.querySelector('#summary')!.textContent).toContain('2 个计分词条');
  });
});

describe('权重：− / + 与数字框', () => {
  beforeEach(() => resetUrl());

  it('每个词条只有一个数字权重框，没有权重下拉，也没有原生上下箭头', () => {
    const root = freshRoot();
    mount(root);
    expect(root.querySelectorAll('#slotRows select[data-key="weight"]')).toHaveLength(0);
    expect(slotWeightInputs(root)).toHaveLength(4);
    for (const input of slotWeightInputs(root)) {
      expect(input.tagName).toBe('INPUT');
      expect(input.type).toBe('number');
    }
  });

  it('每行有一个 − 和一个 + 按钮，夹着数字框', () => {
    const root = freshRoot();
    mount(root);
    expect(stepButtons(root)).toHaveLength(8);
    for (let i = 0; i < 4; i++) {
      const { minus, plus } = stepperOf(root, i);
      expect(minus.textContent).toBe('−');
      expect(plus.textContent).toBe('+');
      // 同一个 stepper 容器内，顺序是 − 输入 数字 +
      const stepper = minus.parentElement!;
      expect(stepper).toBe(plus.parentElement);
      expect(stepper.querySelector('input[data-key="weight"]')).not.toBeNull();
    }
  });

  it('+ 每次加 0.1，− 每次减 0.1', () => {
    const root = freshRoot();
    mount(root);
    // 注意：配置栏在每次状态变化后会重建节点，**不能缓存旧引用**，
    // 否则读到的是已经被替换掉的那个 input（表现为「点了没反应」）
    const read = () => slotWeightInputs(root)[0]!.value;
    expect(read()).toBe('1');

    stepperOf(root, 0).plus.click();
    expect(read()).toBe('1.1');
    stepperOf(root, 0).plus.click();
    expect(read()).toBe('1.2');
    stepperOf(root, 0).minus.click();
    expect(read()).toBe('1.1');
    stepperOf(root, 0).minus.click();
    stepperOf(root, 0).minus.click();
    expect(read()).toBe('0.9');
  });

  it('反复加减不会攒出浮点误差（不会变成 0.30000000000000004）', () => {
    const root = freshRoot();
    mount(root);
    setInput(slotWeightInputs(root)[0]!, '0');
    for (let i = 0; i < 3; i++) stepperOf(root, 0).plus.click();
    expect(slotWeightInputs(root)[0]!.value).toBe('0.3');
  });

  it('权重为 0 时 − 不可用，+ 可把权重加回来', () => {
    const root = freshRoot();
    mount(root);
    // 默认第 3、4 行是空的、权重 0
    expect(stepperOf(root, 2).minus.disabled).toBe(true);
    expect(stepperOf(root, 2).plus.disabled).toBe(false);

    stepperOf(root, 2).plus.click();
    expect(slotWeightInputs(root)[2]!.value).toBe('0.1');
    expect(stepperOf(root, 2).minus.disabled).toBe(false);
  });

  it('− 不会把权重压到负数', () => {
    const root = freshRoot();
    mount(root);
    setInput(slotWeightInputs(root)[0]!, '0.05');
    // 0.05 − 0.1 应当夹到 0，而不是 −0.05
    stepperOf(root, 0).minus.click();
    expect(slotWeightInputs(root)[0]!.value).toBe('0');
  });

  it('点 +/− 之后结果立刻更新', () => {
    const root = freshRoot();
    mount(root);
    const readBest = () => root.querySelectorAll('#cards .card-value')[3]!.textContent!;
    const before = readBest();
    stepperOf(root, 1).plus.click();
    expect(readBest()).not.toBe(before);
  });

  it('权重框仍可直接输入任意值', () => {
    const root = freshRoot();
    mount(root);
    setInput(slotWeightInputs(root)[1]!, '0.25');
    expect(slotWeightInputs(root)[1]!.value).toBe('0.25');
    expect(root.querySelector('.error')).toBeNull();
  });

  it('权重留空按 0 处理，不抛错', () => {
    const root = freshRoot();
    mount(root);
    setInput(slotWeightInputs(root)[0]!, '');
    expect(root.querySelector('.error')).toBeNull();
    expect(root.querySelector('#scoreChart svg')).not.toBeNull();
  });
});

describe('初始档位（第三列）', () => {
  beforeEach(() => resetUrl());

  /** 得分分布面板里的「最高可能分」卡片 */
  function bestOf(root: HTMLElement): number {
    const panel = root.querySelector('[data-tab="growth"]')!;
    return Number(panel.querySelectorAll('.card-value')[3]!.textContent);
  }

  it('每行一个档位下拉，选项是「随机 + 四档」', () => {
    const root = freshRoot();
    mount(root);
    const rolls = slotRollSelects(root);
    expect(rolls).toHaveLength(4);
    for (const sel of rolls) {
      expect([...sel.options].map((o) => o.value)).toEqual(['random', '0', '1', '2', '3']);
      expect(sel.value).toBe('random');
    }
  });

  it('档位选项带数值，否则用户没法判断选哪档', () => {
    const root = freshRoot();
    mount(root);
    // 第 1 行默认是暴击（成长四档 2.7 / 3.1 / 3.5 / 3.9）
    const labels = [...slotRollSelects(root)[0]!.options].map((o) => o.textContent);
    expect(labels[0]).toBe('随机');
    expect(labels[1]).toBe('2.7');
    expect(labels[4]).toBe('3.9');
  });

  it('改词条后档位标签跟着换（不同词条档位值不同）', () => {
    const root = freshRoot();
    mount(root);
    setSelect(slotAttrSelects(root)[0]!, '充能');
    const labels = [...slotRollSelects(root)[0]!.options].map((o) => o.textContent);
    // 充能成长四档 4.5 / 5.2 / 5.8 / 6.5
    expect(labels).toContain('4.5');
    expect(labels).toContain('6.5');
  });

  it('固定初始档位会真的改变分布', () => {
    const root = freshRoot();
    mount(root);

    // 注意：**最高可能分不会变**。最高分来自「每次都取顶档」，
    // 随机分布本来就包含这条路径，固定到顶档只是把它挑出来而已。
    // 真正会变的是达到高分线的概率。
    setInput(root.querySelector<HTMLInputElement>('#targetScore')!, '45');
    const probOf = () => {
      const panel = root.querySelector('[data-tab="growth"]')!;
      return panel.querySelectorAll('.card-value')[1]!.textContent!;
    };

    const randomP = probOf();
    setSelect(slotRollSelects(root)[0]!, '0');
    const lowP = probOf();
    setSelect(slotRollSelects(root)[0]!, '3');
    const highP = probOf();

    // 三者的字符串应当互不相同，且低档的概率最小
    expect(lowP).not.toBe(randomP);
    expect(highP).not.toBe(randomP);
    expect(lowP).not.toBe(highP);
    // 低档更难上 45 分
    const num = (s: string) => Number(s.replace('%', ''));
    expect(num(lowP)).toBeLessThan(num(randomP));
    expect(num(randomP)).toBeLessThan(num(highP));
  });

  it('初始档位的选择会写进状态（并影响 toSpec）', () => {
    const s = defaultState();
    s.slots[0]!.initialRoll = 2;
    const { spec } = toSpec(s);
    expect(spec.slots[0]!.initialRoll).toBe(2);
    // 没改的槽位保持随机
    expect(spec.slots[1]!.initialRoll).toBe('random');
  });

  it('固定档位会写进分享链接并能读回来', () => {
    const s = defaultState();
    s.slots[0]!.initialRoll = 2;
    const back = fromQuery('?' + toQuery(s));
    expect(back.slots[0]!.initialRoll).toBe(2);
    // 老链接（只有 词条:权重 两段）回落到 random
    const old = fromQuery(
      '?main=大攻击&slots=' + encodeURIComponent('暴击:1,暴伤:1,:0,:0'),
    );
    expect(old.slots[0]!.initialRoll).toBe('random');
  });
});

describe('配置属于任务', () => {
  beforeEach(() => resetUrl());

  it('「得分分布」的配置有初始词条数与目标分数', () => {
    const root = freshRoot();
    mount(root);
    const config = root.querySelector('#config')!;
    expect(config.querySelector('#mainAttr')).not.toBeNull();
    expect(config.querySelector('#slotRows')).not.toBeNull();
    expect(config.querySelector('#initialVisible')).not.toBeNull();
    expect(config.querySelector('#targetScore')).not.toBeNull();
  });

  it('「胚子质量」的配置不含初始词条数与目标分数（它只看掉落那一刻）', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');
    const config = root.querySelector('#config')!;
    expect(config.querySelector('#mainAttr')).not.toBeNull();
    expect(config.querySelector('#slotRows')).not.toBeNull();
    expect(config.querySelector('#initialVisible')).toBeNull();
    expect(config.querySelector('#targetScore')).toBeNull();
    // 初始档位是「强化」才有的事，掉落那一刻用不上 → 这一列也不该出现
    expect(config.querySelector('#slotRows select[data-key="roll"]')).toBeNull();
  });

  it('切 tab 会把左栏配置整体换掉', () => {
    const root = freshRoot();
    mount(root);
    expect(root.querySelector('#initialVisible')).not.toBeNull();
    clickTab(root, 'more');
    expect(root.querySelector('#initialVisible')).toBeNull();
    expect(root.querySelector('#slotRows')).toBeNull();
    clickTab(root, 'growth');
    expect(root.querySelector('#initialVisible')).not.toBeNull();
  });

  it('在质量页改权重，切回得分分布时结果也是新的', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');
    stepperOf(root, 1).plus.click();
    clickTab(root, 'growth');
    // 暴伤权重 1 → 1.1，最高分必然变化
    expect(root.querySelectorAll('#cards .card-value')[3]!.textContent).not.toBe('50.7');
  });

  it('两个 tab 共用同一份评分标准（主词条 + 词条与权重）', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');
    setSelect(root.querySelector<HTMLSelectElement>('#mainAttr')!, '暴击');
    clickTab(root, 'growth');
    expect(root.querySelector<HTMLSelectElement>('#mainAttr')!.value).toBe('暴击');
    expect(slotAttrSelects(root).map((s) => s.value)).not.toContain('暴击');
  });
});

describe('tab 分页', () => {
  beforeEach(() => resetUrl());

  it('默认停在「得分分布」，三个 tab 都在', () => {
    const root = freshRoot();
    mount(root);
    expect(root.querySelectorAll('.tabs .tab')).toHaveLength(3);
    expect(root.querySelector('#tab-growth')!.classList.contains('on')).toBe(true);
    expect(root.querySelector('[data-tab="growth"]')).not.toBeNull();
    // 没进过的 tab 还没有面板
    expect(root.querySelector('[data-tab="quality"]')).toBeNull();
  });

  it('切到「胚子质量」会渲染出它自己的内容，且不再是得分分布', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');

    const panel = root.querySelector<HTMLElement>('[data-tab="quality"]')!;
    expect(panel).not.toBeNull();
    expect(panel.hidden).toBe(false);
    expect(panel.querySelectorAll('.card').length).toBe(4);
    expect(panel.querySelector('#scoreChart')).toBeNull();
    // 掉落分布图 + 环形图
    expect(panel.querySelectorAll('svg.chart').length).toBeGreaterThanOrEqual(1);
    expect(panel.querySelectorAll('svg.pie path.pie-slice').length).toBeGreaterThan(0);
    expect(panel.querySelectorAll('table.data tbody tr').length).toBeGreaterThan(0);
    // 另一个面板要藏起来
    expect(root.querySelector<HTMLElement>('[data-tab="growth"]')!.hidden).toBe(true);
  });

  it('切回来时原来的图还在（不会因为面板被卸载而变空）', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');
    clickTab(root, 'growth');
    expect(root.querySelector<HTMLElement>('[data-tab="growth"]')!.hidden).toBe(false);
    expect(root.querySelector('#scoreChart svg')).not.toBeNull();
    expect(root.querySelectorAll('#hitTable tbody tr').length).toBeGreaterThan(0);
  });

  it('切走再切回来，图会按新输入重算（不是旧图）', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');

    // 在「胚子质量」页改权重，再切回「得分分布」
    setInput(slotWeightInputs(root)[1]!, '3');
    clickTab(root, 'growth');
    const after = root.querySelectorAll('#cards .card-value')[3]!.textContent!;

    setInput(slotWeightInputs(root)[1]!, '1');
    expect(root.querySelectorAll('#cards .card-value')[3]!.textContent!).not.toBe(after);
  });

  it('#hash 能直接打开指定 tab', () => {
    resetUrl('', '#quality');
    const root = freshRoot();
    mount(root);
    expect(root.querySelector('[data-tab="quality"]')).not.toBeNull();
  });

  it('「更多」tab 也有内容', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'more');
    expect(root.querySelectorAll('[data-tab="more"] ul.todo li').length).toBeGreaterThan(0);
  });
});

describe('得分分布页', () => {
  beforeEach(() => resetUrl());

  it('渲染出指标卡、两张独立图表与两张表', () => {
    const root = freshRoot();
    mount(root);
    expect(root.querySelectorAll('#cards .card')).toHaveLength(4);
    // 得分分布柱状图与生存曲线是两张图，各自一个 svg
    expect(root.querySelector('#scoreChart svg')).not.toBeNull();
    expect(root.querySelector('#survChart svg')).not.toBeNull();
    // 柱状图里没有累积曲线
    expect(root.querySelector('#scoreChart path.series-line')).toBeNull();
    expect(root.querySelectorAll('#hitTable tbody tr').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('#quantileTable tbody tr')).toHaveLength(3);
  });

  it('没有「约 约」这种重复前缀', () => {
    const root = freshRoot();
    mount(root);
    for (const td of root.querySelectorAll('#hitTable td, #quantileTable td')) {
      expect(td.textContent ?? '').not.toMatch(/约\s*约/);
    }
  });

  it('界面里不残留 Markdown 记号（`**` 之类）', () => {
    const root = freshRoot();
    mount(root);
    for (const id of ['growth', 'quality', 'more']) {
      clickTab(root, id);
      const text = root.querySelector(`[data-tab="${id}"]`)!.textContent ?? '';
      expect(text, `${id} 面板里有 Markdown 残留`).not.toMatch(/\*\*|^\s*[-*]\s/m);
    }
  });

  it('主词条不能同时是副词条', () => {
    const root = freshRoot();
    mount(root);
    const mainSel = root.querySelector<HTMLSelectElement>('#mainAttr')!;
    setSelect(mainSel, '暴击');

    const values = [...slotAttrSelects(root)[0]!.options].map((o) => o.value);
    expect(values).not.toContain('暴击');
    // 原本选了暴击的槽位被清空
    expect(slotAttrSelects(root)[0]!.value).toBe('');
  });

  it('切换词条数会改变可达到的命中档位', () => {
    const root = freshRoot();
    mount(root);
    const iv = root.querySelector<HTMLSelectElement>('#initialVisible')!;

    const hasHighHit = () => root.querySelector('#hitChart')!.textContent!.includes('命中 5 次');
    expect(hasHighHit()).toBe(true);

    setSelect(iv, '3');
    expect(hasHighHit()).toBe(false);
  });

  it('目标分数越大，达到概率越小', () => {
    const root = freshRoot();
    mount(root);
    const target = root.querySelector<HTMLInputElement>('#targetScore')!;
    const readP = () => root.querySelectorAll('#cards .card-value')[1]!.textContent!;

    setInput(target, '5');
    const low = readP();

    setInput(target, '50');
    expect(readP()).not.toBe(low);
  });

  it('无计分槽位时不崩', () => {
    const root = freshRoot();
    mount(root);
    for (const input of slotWeightInputs(root)) {
      setInput(input, '0');
    }
    expect(root.querySelector('#scoreChart svg')).not.toBeNull();
    expect(root.querySelector('.error')).toBeNull();
  });
});

describe('胚子质量页', () => {
  beforeEach(() => resetUrl());

  it('指标卡说的是「掉落时」而不是「练满后」', () => {
    const root = freshRoot();
    mount(root);
    clickTab(root, 'quality');
    const panel = root.querySelector('[data-tab="quality"]')!;
    expect(panel.textContent).toContain('掉落时');
  });

  it('主词条自己不会出现在有效词条里', () => {
    const root = freshRoot();
    mount(root);
    const mainSel = root.querySelector<HTMLSelectElement>('#mainAttr')!;
    setSelect(mainSel, '暴击');
    clickTab(root, 'quality');

    const rows = [...root.querySelectorAll('[data-tab="quality"] table.data tbody tr')].map(
      (tr) => tr.querySelector('td')!.textContent,
    );
    expect(rows).not.toContain('暴击');
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
    expect(back.slots).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(back.slots[i]!.attr).toBe(s.slots[i]!.attr);
      expect(back.slots[i]!.weight).toBe(s.slots[i]!.weight);
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
    // 不认识的词条名会被丢掉（而不是当成合法词条）
    expect(fromQuery('?main=暴击&slots=暴击:1,xx:1,yy:1,zz:1').slots[1]!.attr).toBe('');
  });

  it('query 里主词条与副词条冲突时，界面上会清掉冲突项', () => {
    resetUrl(`?main=${encodeURIComponent('暴击')}&slots=${encodeURIComponent('暴击:1,暴伤:1,大攻击:1,充能:1')}`);
    const el = freshRoot();
    mount(el);

    // fromQuery 只做解析，冲突由 toSpec / 界面负责剔除
    expect(toSpec(fromQuery(location.search)).ignored).toContain('暴击');
    expect(el.querySelector<HTMLSelectElement>('#mainAttr')!.value).toBe('暴击');
    const attrs = [...el.querySelectorAll<HTMLSelectElement>('#slotRows select[data-key="attr"]')].map(
      (s) => s.value,
    );
    expect(attrs).not.toContain('暴击');
    expect(attrs).toContain('暴伤');
  });
});

describe('状态 → 计算输入', () => {
  beforeEach(() => resetUrl());

  it('权重 > 0 的词条按固定顺序占槽位', () => {
    const { spec, scoredCount } = toSpec(defaultState());
    expect(scoredCount).toBe(2);
    expect(spec.slots[0]).toEqual({ attr: '暴击', weight: 1, initialRoll: 'random' });
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
    const { ignored } = toSpec(s);
    expect(ignored).toContain('暴击');
  });

  it('weightMap 只保留权重 > 0 的条目', () => {
    expect(weightMap(defaultState())).toEqual({ 暴击: 1, 暴伤: 1 });
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

describe('界面里改副词条', () => {
  beforeEach(() => resetUrl());

  it('改成已占用的词条时，两条互换而不是出现重复', () => {
    const root = freshRoot();
    mount(root);
    const sels = slotAttrSelects(root);
    // 第 1 行原本是暴击，把它切成暴伤（第 2 行占着）
    setSelect(sels[0]!, '暴伤');

    const after = slotAttrSelects(root).map((s) => s.value);
    expect(after[0]).toBe('暴伤');
    expect(after[1]).toBe('暴击');
    expect(new Set(after.filter((v) => v !== '')).size).toBe(after.filter((v) => v !== '').length);
  });

  it('选「不计分」会把权重清零', () => {
    const root = freshRoot();
    mount(root);
    const sels = slotAttrSelects(root);
    setSelect(sels[1]!, '');
    expect(slotWeightInputs(root)[1]!.value).toBe('0');
  });
});
