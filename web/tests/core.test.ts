/**
 * 核心对拍测试。
 *
 * 固件有两类，用途不同：
 *   `__fixtures__/baseline.json` —— 由权威实现（`web/src/core`）自己导出，
 *      是**回归基线**：改动 core 后 diff 即回归差异。用 `pnpm gen:baseline` 重生成。
 *   `__fixtures__/*.json`（stats / combo / growth / quality）—— 由**归档 Python 实现**
 *      导出，用于与旧实现交叉验证。两者的数值口径差异见 `archive.test.ts`。
 */

import { describe, expect, it } from 'vitest';

import {
  SUB_ATTRS,
  POSITION_PROBABILITY,
  mainAttrProbability,
  positionsOf,
  type MainAttr,
  type SubAttr,
} from '../src/core/stats';
import { dropProbability } from '../src/core/quality';
import { exact4ComboProb, attrsProb, allPossibleAttrsProb, combinations } from '../src/core/combo';
import {
  scoreDistribution,
  probAtLeast,
  pmf,
  cdf,
  survival,
  itemDist,
  hitProbabilities,
  expectedAttempts,
  scoreAtAlpha,
  tierLabel,
  type ArtifactSpec,
  type Slot,
} from '../src/core/growth';

import baseline from '../src/core/__fixtures__/baseline.json';
import statsFixture from '../src/core/__fixtures__/stats.json';

const DEAD: SubAttr = '小防御';

/** 归档固件里没有「初始档位」这个概念（它总是随机的），所以统一按 random 补齐 */
function toSlots(slots: { name: string; weight: number }[]): Slot[] {
  return slots.map((s) => ({
    attr: (s.name === '' ? DEAD : s.name) as SubAttr,
    weight: s.weight,
    initialRoll: 'random' as const,
  }));
}

function specOf(c: { slots: { name: string; weight: number }[]; initItems: number }): ArtifactSpec {
  return {
    slots: toSlots(c.slots) as unknown as ArtifactSpec['slots'],
    initialVisible: c.initItems as 3 | 4,
  };
}

// ---------------------------------------------------------------------------
// 权重表
// ---------------------------------------------------------------------------
describe('stats 权重表', () => {
  it('副词条权重与归档一致，且和为 1100', () => {
    for (const attr of SUB_ATTRS) expect(statsFixture.subWeights[attr]).toBeDefined();
    expect(statsFixture.subWeightSum).toBe(1100);
  });

  it('成长值表与归档一致（原始量纲，小生命是 209 而非 2.09）', () => {
    expect(baseline.stats.growths['小生命']).toEqual([209, 239, 269, 299]);
    expect(baseline.stats.growths['暴击']).toEqual([2.7, 3.1, 3.5, 3.9]);
  });
});

// ---------------------------------------------------------------------------
// 组合概率
// ---------------------------------------------------------------------------
describe('combo 组合概率', () => {
  it('exact4ComboProb 与归档一致（336 个 4 子集）', () => {
    expect(baseline.exact4.length).toBe(336);
    for (const row of baseline.exact4) {
      const got = exact4ComboProb(row.mainAttr as MainAttr, row.combo as SubAttr[]);
      expect(got, `${row.mainAttr} ${row.combo.join('+')}`).toBeCloseTo(row.p, 12);
    }
  });

  it('attrsProb 与归档一致（2182 个组合）', () => {
    expect(baseline.attrsProb.length).toBeGreaterThan(2000);
    for (const row of baseline.attrsProb) {
      const got = attrsProb(
        row.mainAttr as MainAttr,
        row.attrs as SubAttr[],
        (row as { excluded?: SubAttr[] }).excluded ?? [],
      );
      expect(got, `${row.mainAttr} [${row.attrs.join(',')}]`).toBeCloseTo(row.p, 12);
    }
  });

  it('allPossibleAttrsProb 与归档一致，且概率之和为 1', () => {
    for (const entry of baseline.allPossible) {
      const got = allPossibleAttrsProb(entry.mainAttr as MainAttr, entry.attrs as SubAttr[]);
      const key = (c: readonly string[]) => [...c].sort().join('+');
      const gotMap = new Map(got.map((g) => [key(g.combo), g.p]));
      const refMap = new Map(entry.entries.map((e) => [key(e.combo), e.p] as const));
      expect([...gotMap.keys()].sort()).toEqual([...refMap.keys()].sort());
      let sum = 0;
      for (const [k, p] of refMap) {
        expect(gotMap.get(k), `${entry.mainAttr} ${k}`).toBeCloseTo(p, 12);
        sum += p;
      }
      expect(sum, `${entry.mainAttr} 概率之和`).toBeCloseTo(1, 12);
    }
  });

  it('全池概率之和为 1（attrs 取全部副词条时）', () => {
    for (const main of ['大攻击', '火伤'] as MainAttr[]) {
      const all = allPossibleAttrsProb(main, SUB_ATTRS.filter((a) => a !== main));
      const sum = all.reduce((s, x) => s + x.p, 0);
      expect(sum, main).toBeCloseTo(1, 12);
    }
  });

  it('含主词条的组合概率为 0（主词条不与副词条重复）', () => {
    for (const main of ['大攻击', '暴伤'] as SubAttr[]) {
      const others = SUB_ATTRS.filter((a) => a !== main).slice(0, 3);
      expect(attrsProb(main, [main, ...others])).toBe(0);
      expect(attrsProb(main, [main])).toBe(0);
      expect(exact4ComboProb(main, [main, ...others])).toBe(0);
    }
  });

  it('combinations 枚举不重复、不漏项', () => {
    const items = ['a', 'b', 'c', 'd'];
    const choose = [1, 4, 6, 4, 1];
    for (let k = 0; k <= 4; k++) {
      const got = [...combinations(items, k)].map((c) => c.join(''));
      expect(new Set(got).size).toBe(got.length);
      expect(got.length).toBe(choose[k]);
    }
  });
});

// ---------------------------------------------------------------------------
// 分配权重
// ---------------------------------------------------------------------------
describe('itemDist 分配权重', () => {
  it('与基线一致', () => {
    for (const n of [3, 4] as const) {
      const mine = itemDist(n);
      const ref = (baseline.itemDist as unknown as Record<string, [string, number][]>)[
        String(n)
      ]!;
      expect(mine.size).toBe(ref.length);
      for (const entry of ref) {
        const [k, v] = entry;
        expect(mine.get(k), k).toBe(v);
      }
    }
  });

  it('权重之和 = 4^(n+1)，且每个键的 Σ 恒定', () => {
    const sum = (n: 3 | 4) => [...itemDist(n).values()].reduce((s, v) => s + v, 0);
    expect(sum(3)).toBe(4 ** 4);
    expect(sum(4)).toBe(4 ** 5);

    const sigmas = (n: 3 | 4) =>
      new Set([...itemDist(n).keys()].map((k) => k.split(',').reduce((s, x) => s + Number(x), 0)));
    expect(sigmas(3)).toEqual(new Set([8]));
    expect(sigmas(4)).toEqual(new Set([9]));
  });
});

// ---------------------------------------------------------------------------
// 得分分布（回归基线）
// ---------------------------------------------------------------------------
describe('growth 得分分布（回归基线）', () => {
  for (const c of baseline.growth) {
    it(`${c.name}: 稠密表与基线逐格一致`, () => {
      const t = scoreDistribution(specOf(c));
      expect(t.total).toBe(c.total);
      expect(t.hitBuckets).toBe(c.hitBuckets);
      expect(t.scores.length).toBe(c.dense.length);
      for (let i = 0; i < c.dense.length; i++) {
        const [score, weights] = c.dense[i] as [number, number[]];
        expect(t.scores[i], `第 ${i} 个得分`).toBeCloseTo(score, 9);
        expect(t.hits[i], `得分 ${score}`).toEqual(weights);
      }
    });
  }

  it('每次调用的结果稳定（无隐藏状态）', () => {
    const c = baseline.growth[0]!;
    const a = scoreDistribution(specOf(c));
    const b = scoreDistribution(specOf(c));
    expect(a.hits).toEqual(b.hits);
  });
});

// ---------------------------------------------------------------------------
// 不变量（不依赖基线，防止基线本身写错）
// ---------------------------------------------------------------------------
describe('growth 不变量', () => {
  it('权重之和恒等于归一化常数，且概率之和为 1', () => {
    for (const c of baseline.growth) {
      const t = scoreDistribution(specOf(c));
      expect(t.hits.flat().reduce((s, w) => s + w, 0), c.name).toBe(t.total);
      expect(pmf(t).reduce((s, v) => s + v, 0), c.name).toBeCloseTo(1, 12);
    }
  });

  it('命中档数 = 成长次数 + 1（4 词条 6 档、3 词条 5 档）', () => {
    for (const c of baseline.growth) {
      const t = scoreDistribution(specOf(c));
      expect(t.hitBuckets, c.name).toBe(c.initItems + 2);
    }
  });

  it('CDF 单调不减、终值为 1；生存函数单调不增、首值为 1', () => {
    for (const c of baseline.growth) {
      const t = scoreDistribution(specOf(c));
      const cv = cdf(t);
      for (let i = 1; i < cv.length; i++) expect(cv[i]!).toBeGreaterThanOrEqual(cv[i - 1]!);
      expect(cv[cv.length - 1]!).toBeCloseTo(1, 12);

      const sv = survival(t);
      for (let i = 1; i < sv.length; i++) expect(sv[i]!).toBeLessThanOrEqual(sv[i - 1]!);
      expect(sv[0]!).toBeCloseTo(1, 12);
    }
  });

  it('probAtLeast 单调不增；最低分处为 1', () => {
    for (const c of baseline.growth) {
      const t = scoreDistribution(specOf(c));
      const probs = t.scores.map((s) => probAtLeast(t, s));
      for (let i = 1; i < probs.length; i++) {
        expect(probs[i]!).toBeLessThanOrEqual(probs[i - 1]! + 1e-12);
      }
      expect(probs[0]!).toBeCloseTo(1, 12);
      expect(probAtLeast(t, t.scores[t.scores.length - 1]!)).toBeGreaterThan(0);
    }
  });

  it('命中次数越少，分数上界越低', () => {
    const c = baseline.growth[0]!;
    const t = scoreDistribution(specOf(c));
    // 每个命中档的**最大**得分下标应随命中数单调不减
    const maxIdx: number[] = [];
    for (let h = 0; h < t.hitBuckets; h++) {
      let last = -1;
      for (let i = 0; i < t.hits.length; i++) if (t.hits[i]![h]! > 0) last = i;
      if (last >= 0) maxIdx.push(last);
    }
    expect(maxIdx.length).toBeGreaterThan(1);
    for (let i = 1; i < maxIdx.length; i++) {
      expect(maxIdx[i]).toBeGreaterThanOrEqual(maxIdx[i - 1]!);
    }
  });

  it('槽位数必须是 4（3 词条用 weight=0 占位）', () => {
    const three = toSlots([{ name: '暴击', weight: 1 }, { name: '', weight: 0 }, { name: '', weight: 0 }]);
    expect(() =>
      scoreDistribution({ slots: three as never, initialVisible: 3 }),
    ).toThrow(/slots/);
  });

  it('hitProbabilities 的概率之和为 1，且命中档位连续', () => {
    for (const c of baseline.growth) {
      const t = scoreDistribution(specOf(c));
      const hp = hitProbabilities(t);
      expect(hp.reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 12);
      for (let i = 1; i < hp.length; i++) expect(hp[i]!.hits).toBe(hp[i - 1]!.hits + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// 派生指标的语义
// ---------------------------------------------------------------------------
describe('派生指标', () => {
  const c = baseline.growth.find((x) => x.name === '4r-crit-dmg')!;
  const t = scoreDistribution(specOf(c));

  it('expectedAttempts = 1 / probAtLeast', () => {
    for (const s of [t.scores[0]!, t.scores[Math.floor(t.scores.length / 2)]!]) {
      const p = probAtLeast(t, s);
      expect(expectedAttempts(t, s)).toBeCloseTo(1 / p, 9);
    }
  });

  it('expectedAttempts 在高分处返回 undefined（概率为 0）', () => {
    expect(expectedAttempts(t, 9999)).toBeUndefined();
  });

  it('scoreAtAlpha 返回满足该分位的最小分数', () => {
    for (const alpha of [0.1, 0.5, 0.9]) {
      const x = scoreAtAlpha(t, alpha);
      expect(x, `alpha=${alpha}`).toBeDefined();
      // x 是第一个「≥x 的概率 ≤ alpha」的分数
      expect(probAtLeast(t, x!)).toBeLessThanOrEqual(alpha + 1e-12);
      // 再往前一格就应超过 alpha
      const idx = t.scores.indexOf(x!);
      if (idx > 0) expect(probAtLeast(t, t.scores[idx - 1]!)).toBeGreaterThan(alpha);
    }
  });

  it('3 词条的最高分低于同等 4 词条', () => {
    const four = baseline.growth.find((x) => x.name === '4r-crit-dmg')!;
    const three = baseline.growth.find((x) => x.name === '3r-crit-dmg')!;
    const maxOf = (x: typeof four) => Math.max(...x.dense.map((d) => (d as [number, number[]])[0]));
    expect(maxOf(three)).toBeLessThan(maxOf(four));
  });
});

// ---------------------------------------------------------------------------
// 掉落概率（不含成长值）
// ---------------------------------------------------------------------------
describe('掉落概率', () => {
  it('部位概率是 1/5，主词条概率按部位取（火伤只在杯上）', () => {
    // 一套五星圣遗物有 5 个部位，掉到指定部位（如杯）是 1/5；
    // 别和 POSITIONS.length（3 种有主词条的类型）混了
    expect(POSITION_PROBABILITY).toBeCloseTo(0.2, 12);
    expect(positionsOf('火伤')).toEqual(['杯']);
    expect(mainAttrProbability('火伤')).toBeCloseTo(0.2 * (200 / 4000), 12);
  });

  it('暴击可以是头的主词条，概率按部位取平均', () => {
    expect(positionsOf('暴击')).toContain('头');
    // 头：5/50；暴击不是杯的主词条 → 平均只有头那一项 / 5
    expect(mainAttrProbability('暴击')).toBeCloseTo(0.2 * (5 / 50), 12);
  });

  it('不要副词条时只剩「部位 × 主词条」', () => {
    const d = dropProbability({ mainAttr: '火伤', weights: {} });
    expect(d.subsP).toBe(1);
    expect(d.p).toBeCloseTo(d.mainP, 12);
    expect(d.p).toBeCloseTo(0.2 * (200 / 4000), 12);
  });

  it('要暴击 + 暴伤时，副词条概率就是「同时含有这两条」', () => {
    const d = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2, 暴伤: 1 } });
    expect(d.subsP).toBeCloseTo(attrsProb('火伤', ['暴击', '暴伤']), 12);
    expect(d.subsP).toBeLessThan(1);
    expect(d.p).toBeCloseTo(d.mainP * d.subsP, 12);
  });

  it('要求越多副词条，概率越小', () => {
    const one = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2 } });
    const two = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2, 暴伤: 1 } });
    const three = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2, 暴伤: 1, 充能: 1 } });
    expect(two.p).toBeLessThan(one.p);
    expect(three.p).toBeLessThan(two.p);
  });

  it('要求 5 条副词条时概率为 0（终态只有 4 条）', () => {
    const d = dropProbability({
      mainAttr: '火伤',
      weights: { 暴击: 2, 暴伤: 1, 充能: 1, 大攻击: 1, 精通: 1 },
    });
    expect(d.subsP).toBe(0);
    expect(d.p).toBe(0);
  });

  it('权重为 0 的词条不参与约束（「不计分」= 通配）', () => {
    const a = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2, 充能: 0 } });
    const b = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2 } });
    expect(a.p).toBeCloseTo(b.p, 12);
  });

  it('主词条会从副词条池里排除，所以不能把它自己算成约束', () => {
    // 暴击当主词条时，「要暴击副词条」的概率是 0（游戏里不可能）
    expect(dropProbability({ mainAttr: '暴击', weights: { 暴击: 2 } }).subsP).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 分档文案
// ---------------------------------------------------------------------------
describe('初始档位的展示文案', () => {
  it('固定一位小数 —— 7 和 7.0 语义不同，不要抹掉尾随的 0', () => {
    expect([0, 1, 2, 3].map((t) => tierLabel('暴伤', t))).toEqual(['5.4', '6.2', '7.0', '7.8']);
    expect([0, 1, 2, 3].map((t) => tierLabel('暴击', t))).toEqual(['2.7', '3.1', '3.5', '3.9']);
  });

  it('带权重时显示「成长值 × 权重」（这一档值多少分）', () => {
    expect([0, 1, 2, 3].map((t) => tierLabel('暴击', t, 2))).toEqual(['5.4', '6.2', '7.0', '7.8']);
    // 小生命是原始量纲（209 等），权重 0.01 → 2.09 附近
    expect(tierLabel('小生命', 0, 0.01)).toBe('2.1');
  });
});

// ---------------------------------------------------------------------------
// 归档交叉验证
// ---------------------------------------------------------------------------
describe('与归档 Python 实现的交叉验证', () => {
  it('得分分布在无 0.01 权重的用例上与归档逐格一致', () => {
    // 归档用浮点累加、最后 `:.1f` 取整；本实现用精确整数（×1000）。
    // 两者只在「权重 × 成长值恰好落在 .x5 边界」时可能有 0.1 的取整差，
    // 这类边界只出现在 小生命/小防御 的小数权重上，所以这里排除 hp-flat 类用例。
    // 量化差异见 docs/ai-output/1-refactor/01-code-review.md。
    const cases = baseline.growth.filter((c) => !c.slots.some((s) => s.weight === 0.01));
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const t = scoreDistribution(specOf(c));
      const mine = new Map<number, number[]>();
      t.scores.forEach((s, i) => mine.set(Math.round(s * 10), t.hits[i]!));
      const ref = new Map<number, number[]>();
      for (const [score, dist] of c.dense as [number, number[]][]) {
        ref.set(Math.round(score * 10), dist);
      }
      expect([...mine.keys()].sort((a, b) => a - b)).toEqual(
        [...ref.keys()].sort((a, b) => a - b),
      );
      for (const [k, refRow] of ref) {
        expect(mine.get(k), `${c.name} 得分 ${k / 10}`).toEqual(refRow);
      }
    }
  });
});
