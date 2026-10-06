/**
 * 界面冒烟测试：在 jsdom 里真实挂载一次，验证能渲染出表单、图表与表格，
 * 并且交互（换主词条、改权重）不会抛错。
 *
 * 这类测试的价值在于挡住「改 core 的签名后忘了改 UI」这类断裂。
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { mount } from '../src/ui/app';
import { defaultState, fromQuery, toQuery } from '../src/ui/state';

function freshRoot(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById('app')!;
}

describe('界面冒烟', () => {
  beforeEach(() => {
    location.search = '';
  });

  it('挂载后渲染出主要区域', () => {
    const root = freshRoot();
    mount(root);

    expect(root.querySelector('h1')?.textContent).toContain('圣遗物');
    expect(root.querySelectorAll('#slotRows .slot-row')).toHaveLength(4);
    expect(root.querySelectorAll('#cards .card').length).toBeGreaterThanOrEqual(3);
    expect(root.querySelector('#chart svg')).not.toBeNull();
    expect(root.querySelectorAll('#hitTable tbody tr').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('#quantileTable tbody tr').length).toBe(3);
  });

  it('主词条下拉包含全部主词条，且不含被选中的那个作为副词条', () => {
    const root = freshRoot();
    mount(root);
    const mainSel = root.querySelector<HTMLSelectElement>('#mainAttr')!;
    expect(mainSel.options.length).toBeGreaterThan(10);
    expect(mainSel.value).toBe('暴击');

    // 副词条下拉里不应出现当前主词条
    const attrSel = root.querySelector<HTMLSelectElement>('#slotRows select[data-key="attr"]')!;
    const values = [...attrSel.options].map((o) => o.value);
    expect(values).not.toContain('暴击');
    expect(values).toContain('暴伤');
  });

  it('切换主词条会把冲突的副词条槽位清空', () => {
    const root = freshRoot();
    mount(root);
    const mainSel = root.querySelector<HTMLSelectElement>('#mainAttr')!;
    mainSel.value = '暴伤';
    mainSel.dispatchEvent(new Event('change'));

    const first = root.querySelector<HTMLSelectElement>('#slotRows select[data-key="attr"]')!;
    expect(first.value).toBe('');
  });

  it('切换词条数会改变命中档位数（4 词条 6 档 / 3 词条 5 档）', () => {
    const root = freshRoot();
    mount(root);
    const iv = root.querySelector<HTMLSelectElement>('#initialVisible')!;

    expect(root.querySelectorAll('#hitTable tbody tr').length).toBe(6);
    iv.value = '3';
    iv.dispatchEvent(new Event('change'));
    expect(root.querySelectorAll('#hitTable tbody tr').length).toBe(5);
  });

  it('目标分数越大，达到概率越小', () => {
    const root = freshRoot();
    mount(root);
    const target = root.querySelector<HTMLInputElement>('#targetScore')!;

    const readP = () => root.querySelectorAll('#cards .card-value')[1]!.textContent!;
    target.value = '5';
    target.dispatchEvent(new Event('input'));
    const low = readP();

    target.value = '45';
    target.dispatchEvent(new Event('input'));
    const high = readP();

    expect(low).not.toBe(high);
    expect(high).toMatch(/0%|e-/);
  });

  it('无计分槽位时不崩，且概率集中在 0 分', () => {
    const root = freshRoot();
    mount(root);
    // 把所有权重设为 0
    for (const sel of root.querySelectorAll<HTMLSelectElement>('#slotRows select[data-key="weight"]')) {
      sel.value = '0';
      sel.dispatchEvent(new Event('change'));
    }
    expect(root.querySelector('#chart svg')).not.toBeNull();
    expect(root.querySelector('.error')).toBeNull();
  });
});

describe('配置序列化', () => {
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

  it('非法 query 回退到默认值', () => {
    const s = defaultState();
    expect(fromQuery('?main=不存在').mainAttr).toBe(s.mainAttr);
    expect(fromQuery('').mainAttr).toBe(s.mainAttr);
    expect(fromQuery('?slots=a:1').mainAttr).toBe(s.mainAttr);
  });
});
