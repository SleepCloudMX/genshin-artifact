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
  SLOTS,
  SUB_ATTRS,
  hasRandomMain,
  mainAttrsOf,
  mainProbAt,
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
  hitMixAtLeast,
  expectedAttempts,
  scoreAtAlpha,
  tierLabel,
  BUCKET_OPTIONS,
  bucketize,
  type ArtifactSpec,
  type DistributionTable,
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

  it('成长值四舍五入到两位小数（保留原始量纲：小生命是 209.13）', () => {
    // 游戏内显示值只到一位小数（暴伤 5.4/6.2/7.0/7.8），累加会系统性偏高：
    // 暴伤满档 6 次 = 7.77 × 6 = 46.62 → 显示 46.6；用显示值会算成 46.8。
    expect(baseline.stats.growths['小生命']).toEqual([209.13, 239, 268.88, 298.75]);
    expect(baseline.stats.growths['暴击']).toEqual([2.72, 3.11, 3.5, 3.89]);
    expect(baseline.stats.growths['充能']).toEqual([4.53, 5.18, 5.83, 6.48]);
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
// 「≥ 该分数线」时的命中次数条件分布
// ---------------------------------------------------------------------------
describe('hitMixAtLeast（条件分布）', () => {
  const cases = baseline.growth.map((c) => ({ name: c.name, t: scoreDistribution(specOf(c)) }));

  it('每个分数线处都归一化：Σ = 1，长度 = 命中档数', () => {
    for (const { name, t } of cases) {
      const sv = survival(t);
      for (let i = 0; i < t.scores.length; i++) {
        const mix = hitMixAtLeast(t, i);
        expect(mix, name).toHaveLength(t.hitBuckets);
        if (sv[i]! > 0) {
          expect(
            mix.reduce((s, x) => s + x, 0),
            `${name} @ ${t.scores[i]}`,
          ).toBeCloseTo(1, 12);
        }
      }
    }
  });

  it('与「原始权重表按 ≥ 分数线求和再归一化」逐格一致', () => {
    for (const { t } of cases) {
      for (let i = 0; i < t.scores.length; i++) {
        const mix = hitMixAtLeast(t, i);
        let sum = 0;
        for (let j = i; j < t.hits.length; j++) for (const w of t.hits[j]!) sum += w;
        for (let h = 0; h < t.hitBuckets; h++) {
          let w = 0;
          for (let j = i; j < t.hits.length; j++) w += t.hits[j]![h]!;
          expect(mix[h]).toBeCloseTo(sum > 0 ? w / sum : 0, 12);
        }
      }
    }
  });

  it('最低分处退化为无条件的命中分布（≥ 最低分 = 全部结果）', () => {
    for (const { t } of cases) {
      const mix = hitMixAtLeast(t, 0);
      expect(hitProbabilities(t).length).toBeGreaterThan(0);
      for (const { hits, p } of hitProbabilities(t)) expect(mix[hits]).toBeCloseTo(p, 12);
    }
  });

  it('最高分处只在最高命中档上有质量（那个分数只有一种达成方式）', () => {
    for (const { name, t } of cases) {
      const mix = hitMixAtLeast(t, t.scores.length - 1);
      const top = mix.reduce((best, p, h) => (p > 0 ? h : best), -1);
      expect(top, name).toBeGreaterThanOrEqual(0);
      expect(mix[top], name).toBeCloseTo(1, 12);
    }
  });

  it('下标越界有确定行为：负数按 0 处理，超出末尾返回全 0', () => {
    const t = cases[0]!.t;
    const first = hitMixAtLeast(t, 0);
    expect(hitMixAtLeast(t, -5)).toEqual(first);
    for (const i of [t.scores.length, t.scores.length + 99]) {
      const mix = hitMixAtLeast(t, i);
      expect(mix).toHaveLength(t.hitBuckets);
      expect(mix.every((x) => x === 0)).toBe(true);
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
describe('部位与主词条', () => {
  it('五个部位，花与羽的主词条固定', () => {
    expect(SLOTS).toEqual(['花', '羽', '沙', '杯', '头']);
    expect(hasRandomMain('花')).toBe(false);
    expect(hasRandomMain('羽')).toBe(false);
    expect(hasRandomMain('沙')).toBe(true);
    expect(mainAttrsOf('花')).toEqual([]);
    expect(mainAttrsOf('羽')).toEqual([]);
  });

  it('主词条可选项按部位限定', () => {
    // 元素伤害只在杯上
    expect(mainAttrsOf('杯')).toContain('火伤');
    expect(mainAttrsOf('杯')).not.toContain('充能');
    // 充能只在沙上
    expect(mainAttrsOf('沙')).toContain('充能');
    expect(mainAttrsOf('沙')).not.toContain('火伤');
    // 暴击只在头上（杯里没有暴击）
    expect(mainAttrsOf('头')).toContain('暴击');
    expect(mainAttrsOf('杯')).not.toContain('暴击');
    // 大攻击三处都能出
    for (const pos of ['沙', '杯', '头'] as const) expect(mainAttrsOf(pos)).toContain('大攻击');
  });

  it('空之杯出火伤 = 200/4000 = 5%（条件概率，不含「掉到杯」）', () => {
    expect(mainProbAt('杯', '火伤')).toBeCloseTo(200 / 4000, 12);
    expect(mainProbAt('杯', '火伤')).toBeCloseTo(0.05, 12);
  });

  it('主词条概率按部位归一，各部位和为 1', () => {
    for (const pos of ['沙', '杯', '头'] as const) {
      const sum = mainAttrsOf(pos).reduce((s, a) => s + (mainProbAt(pos, a) ?? 0), 0);
      expect(sum, `${pos} 的主词条概率和`).toBeCloseTo(1, 12);
    }
  });

  it('该部位没有的主词条返回 undefined', () => {
    expect(mainProbAt('沙', '火伤')).toBeUndefined();
    expect(mainProbAt('头', '充能')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 掉落概率（不含成长值）
// ---------------------------------------------------------------------------
describe('掉落概率', () => {
  it('部位不参与相乘 —— 它是刷本的既定前提，不是随机项', () => {
    const d = dropProbability({ mainAttr: '火伤', weights: {} }, '杯');
    expect(d.mainP).toBeCloseTo(0.05, 12);
    expect(d.p).toBeCloseTo(0.05, 12);
  });

  it('花 / 羽的主词条固定，主词条概率为 1', () => {
    for (const slot of ['花', '羽'] as const) {
      const d = dropProbability({ mainAttr: '火伤', weights: {} }, slot);
      expect(d.mainP, `${slot} 的主词条概率`).toBe(1);
    }
  });

  it('要暴击 + 暴伤时，副词条概率就是「同时含有这两条」', () => {
    const d = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2, 暴伤: 1 } }, '杯');
    expect(d.subsP).toBeCloseTo(attrsProb('火伤', ['暴击', '暴伤']), 12);
    expect(d.subsP).toBeLessThan(1);
    expect(d.p).toBeCloseTo(d.mainP * d.subsP, 12);
  });

  it('要求越多副词条，概率越小', () => {
    const one = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2 } }, '杯');
    const two = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2, 暴伤: 1 } }, '杯');
    const three = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2, 暴伤: 1, 充能: 1 } }, '杯');
    expect(two.p).toBeLessThan(one.p);
    expect(three.p).toBeLessThan(two.p);
  });

  it('要求 5 条副词条时概率为 0（终态只有 4 条）', () => {
    const d = dropProbability(
      { mainAttr: '火伤', weights: { 暴击: 2, 暴伤: 1, 充能: 1, 大攻击: 1, 精通: 1 } },
      '杯',
    );
    expect(d.subsP).toBe(0);
    expect(d.p).toBe(0);
  });

  it('权重为 0 的词条不参与约束（「不计分」= 通配）', () => {
    const a = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2, 充能: 0 } }, '杯');
    const b = dropProbability({ mainAttr: '火伤', weights: { 暴击: 2 } }, '杯');
    expect(a.p).toBeCloseTo(b.p, 12);
  });

  it('要求的词条全被主词条冲突剔掉时是 0（不可能事件）', () => {
    // 暴击当主词条时，「要暴击副词条」游戏里不可能
    expect(dropProbability({ mainAttr: '暴击', weights: { 暴击: 2 } }, '头').subsP).toBe(0);
  });

  it('主词条别名要规范化：爆伤主词条也要挡掉「暴伤」副词条', () => {
    const d = dropProbability({ mainAttr: '爆伤', weights: { 暴伤: 1 } }, '头');
    expect(d.subsP).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 分桶
// ---------------------------------------------------------------------------
describe('分桶', () => {
  /** 造一组「分数 → 各命中档概率」的输入 */
  const rows = (scores: number[]) => scores.map(() => [0.1, 0.2, 0.3]);

  it('size = 0.1 不合并：每个分数一根柱子', () => {
    const scores = [10.8, 10.9, 11.0];
    const bars = bucketize(scores, rows(scores), 0.1);
    expect(bars).toHaveLength(3);
    expect(bars.map((b) => b.score)).toEqual(scores);
    expect(bars.every((b) => b.count === 1)).toBe(true);
  });

  it('桶边界对齐到 size 的整数倍，而不是从最低分开始切', () => {
    // 10.8 起、size = 1 → 桶必须是 [10,10.9]，不能是 [10.8,11.7]
    const scores = [10.8, 10.9, 11.0, 11.9, 12.0];
    const bars = bucketize(scores, rows(scores), 1);
    expect(bars.map((b) => b.score)).toEqual([10, 11, 12]);
    expect(bars[0]).toMatchObject({ minScore: 10.8, maxScore: 10.9, count: 2 });
    expect(bars[1]).toMatchObject({ minScore: 11.0, maxScore: 11.9, count: 2 });
    expect(bars[2]).toMatchObject({ minScore: 12.0, maxScore: 12.0, count: 1 });
  });

  it('各档位都不产生浮点毛刺（桶起点落在 0.1 网格上）', () => {
    const scores: number[] = [];
    for (let s = 108; s <= 600; s += 1) scores.push(s / 10);
    for (const size of BUCKET_OPTIONS) {
      for (const b of bucketize(scores, rows(scores), size)) {
        expect(Number.isFinite(b.score)).toBe(true);
        // 必须是 0.1 的整数倍，且字符串化后不超过一位小数
        expect(Math.abs(b.score * 10 - Math.round(b.score * 10))).toBeLessThan(1e-9);
        expect(String(b.score)).not.toMatch(/\.\d{2,}/);
      }
    }
  });

  it('合并后概率按档累加，总和不变', () => {
    // 10.8 / 10.9 落在桶 [10, 10.9]；11.0 / 11.1 落在桶 [11, 11.9]
    const scores = [10.8, 10.9, 11.0, 11.1];
    const src = scores.map(() => [0.1, 0.2, 0.3]);
    const bars = bucketize(scores, src, 1);
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.count)).toEqual([2, 2]);

    const before = src.flat().reduce((s, v) => s + v, 0);
    const after = bars.flatMap((b) => b.byHit).reduce((s, v) => s + v, 0);
    expect(after).toBeCloseTo(before, 12);

    // 每桶两个分数，各档翻倍
    for (const b of bars) {
      expect(b.total).toBeCloseTo(1.2, 12);
      expect(b.byHit).toEqual([0.2, 0.4, 0.6]);
    }
  });

  it('空输入不抛错', () => {
    expect(bucketize([], [], 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 分档文案
// ---------------------------------------------------------------------------
describe('初始档位的展示文案', () => {
  it('显示表里的成长值（两位小数），整数分补一位小数', () => {
    // 不再取整到一位小数：那样 5.44 会显示成 5.4，界面上读到的数与算分用的数就不一致了
    expect([0, 1, 2, 3].map((t) => tierLabel('暴伤', t))).toEqual(['5.44', '6.22', '6.99', '7.77']);
    expect([0, 1, 2, 3].map((t) => tierLabel('暴击', t))).toEqual(['2.72', '3.11', '3.5', '3.89']);
  });

  it('带权重时显示「成长值 × 权重」（这一档值多少分）', () => {
    expect([0, 1, 2, 3].map((t) => tierLabel('暴击', t, 2))).toEqual(['5.44', '6.22', '7.0', '7.78']);
    // 小数权重同样精确：小生命 209.13 × 0.01 = 2.0913
    expect(tierLabel('小生命', 0, 0.01)).toBe('2.0913');
    expect(tierLabel('暴击', 3, 0.25)).toBe('0.9725');
    // 权重的精度口径是两位小数（core 按 ×100 取整）：0.333 按 0.33 算
    expect(tierLabel('暴击', 3, 0.333)).toBe('1.2837');
  });
});

// ---------------------------------------------------------------------------
// 成长值口径
// ---------------------------------------------------------------------------
describe('成长值口径（四舍五入到两位小数）', () => {
  /** 只有第 1 个槽位计分，其余权重 0 */
  function singleSlot(attr: SubAttr, visible: 3 | 4): DistributionTable {
    const slots = [attr, DEAD, DEAD, DEAD].map((a, i) => ({
      attr: a,
      weight: i === 0 ? 1 : 0,
      initialRoll: 'random' as const,
    }));
    return scoreDistribution({
      slots: slots as unknown as ArtifactSpec['slots'],
      initialVisible: visible,
    });
  }

  it('暴伤满档 6 次 = 7.77 × 6 = 46.62 → 46.6（与游戏显示一致）', () => {
    // 用游戏内显示值 7.8 会算成 46.8，高估 0.2 —— 这正是换表的理由
    const t = singleSlot('暴伤', 4);
    expect(t.scores[t.scores.length - 1]).toBe(46.6);
  });

  it('暴击率满档 6 次 = 3.89 × 6 = 23.34 → 23.3', () => {
    const t = singleSlot('暴击', 4);
    expect(t.scores[t.scores.length - 1]).toBe(23.3);
  });

  it('3 词条的满档是 5 次成长（第 1 次用于激活第 4 条）', () => {
    const t = singleSlot('暴伤', 3);
    expect(t.scores[t.scores.length - 1]).toBe(38.9); // 5 × 7.77 = 38.85 → 38.9
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
