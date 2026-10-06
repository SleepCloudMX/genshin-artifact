/**
 * 从前端权威实现导出基线固件（回归用）。
 *
 * 运行（在 web/ 目录）：
 *   pnpm exec vitest run tools/gen-baseline.test.ts --reporter=basic
 * 或直接用 node 运行本文件（见 web/package.json 的 gen:baseline 脚本）。
 *
 * 产物：src/core/__fixtures__/baseline.json
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it } from 'vitest';

import { scoreDistribution, itemDist, type ArtifactSpec, type Slot } from '../src/core/growth';
import { GROWTHS, SUB_WEIGHTS, SUB_WEIGHT_SUM } from '../src/core/stats';
import { allPossibleAttrsProb, exact4ComboProb, attrsProb } from '../src/core/combo';
import type { MainAttr, SubAttr } from '../src/core/stats';

/** 用例表：与归档的 7 个场景一致 */
const CASES: { name: string; slots: { name: string; weight: number }[]; initItems: 3 | 4 }[] = [
  { name: '4r-crit-dmg', slots: [{ name: '暴击', weight: 2 }, { name: '暴伤', weight: 1 }, { name: '', weight: 0 }, { name: '', weight: 0 }], initItems: 4 },
  { name: '3r-crit-dmg', slots: [{ name: '暴击', weight: 2 }, { name: '暴伤', weight: 1 }, { name: '', weight: 0 }, { name: '', weight: 0 }], initItems: 3 },
  { name: '4r-crit-only', slots: [{ name: '暴击', weight: 2 }, { name: '', weight: 0 }, { name: '', weight: 0 }, { name: '', weight: 0 }], initItems: 4 },
  { name: '4r-atk-small', slots: [{ name: '大攻击', weight: 1 }, { name: '小攻击', weight: 0.1 }, { name: '', weight: 0 }, { name: '', weight: 0 }], initItems: 4 },
  { name: '4r-all-four', slots: [{ name: '暴击', weight: 1 }, { name: '暴伤', weight: 1 }, { name: '大攻击', weight: 1 }, { name: '充能', weight: 1 }], initItems: 4 },
  { name: '3r-all-four', slots: [{ name: '暴击', weight: 1 }, { name: '暴伤', weight: 1 }, { name: '大攻击', weight: 1 }, { name: '充能', weight: 1 }], initItems: 3 },
  { name: '4r-hp-flat', slots: [{ name: '大生命', weight: 1 }, { name: '小生命', weight: 0.01 }, { name: '', weight: 0 }, { name: '', weight: 0 }], initItems: 4 },
];

const DEAD: SubAttr = '小防御';

function specOf(c: (typeof CASES)[number]): ArtifactSpec {
  const slots = c.slots.map((s) => ({
    attr: (s.name === '' ? DEAD : s.name) as SubAttr,
    weight: s.weight,
  })) as unknown as Slot[];
  return { slots: slots as unknown as ArtifactSpec['slots'], initialVisible: c.initItems };
}

const MAIN_PROBED: MainAttr[] = ['大攻击', '暴伤', '小生命', '火伤', '小防御', '治疗', '爆伤'];

describe('gen baseline', () => {
  it('写入 baseline.json', () => {
    const growth = CASES.map((c) => {
      const t = scoreDistribution(specOf(c));
      return {
        name: c.name,
        slots: c.slots,
        initItems: c.initItems,
        total: t.total,
        hitBuckets: t.hitBuckets,
        // 稠密表：[得分, [命中 i 次的权重]]
        dense: t.scores.map((s, i) => [s, t.hits[i]!] as [number, number[]]),
      };
    });

    const exact4: unknown[] = [];
    for (const main of ['大攻击', '火伤'] as MainAttr[]) {
      const pool = (Object.keys(SUB_WEIGHTS) as SubAttr[]).filter((a) => a !== main);
      for (let i = 0; i < pool.length; i++)
        for (let j = i + 1; j < pool.length; j++)
          for (let k = j + 1; k < pool.length; k++)
            for (let l = k + 1; l < pool.length; l++) {
              const combo = [pool[i]!, pool[j]!, pool[k]!, pool[l]!];
              exact4.push({ mainAttr: main, combo, p: exact4ComboProb(main, combo) });
            }
    }

    const attrsProbRows: {
      mainAttr: MainAttr;
      attrs: SubAttr[];
      excluded: SubAttr[];
      p: number;
    }[] = [];
    for (const main of MAIN_PROBED) {
      const pool = (Object.keys(SUB_WEIGHTS) as SubAttr[]).filter((a) => a !== main);
      for (let n = 0; n <= 4; n++) {
        const rec = (start: number, acc: SubAttr[]): void => {
          if (acc.length === n) {
            // 语义：终态 4 条里「包含且仅包含」acc —— 即包含 acc、排除池里其余。
            const excluded = pool.filter((a) => !acc.includes(a));
            attrsProbRows.push({
              mainAttr: main,
              attrs: [...acc],
              excluded,
              p: attrsProb(main, acc, excluded),
            });
            return;
          }
          for (let i = start; i < pool.length; i++) rec(i + 1, [...acc, pool[i]!]);
        };
        rec(0, []);
      }
    }

    const allPossible = (
      [
        ['大攻击', ['暴击', '暴伤', '充能']],
        ['大攻击', ['暴击', '暴伤', '精通', '大攻击', '充能']],
        ['小生命', ['暴击', '暴伤', '充能', '大攻击']],
        ['火伤', ['暴击', '暴伤', '精通', '大攻击', '充能']],
        ['暴伤', ['暴击', '充能', '精通']],
      ] as [MainAttr, SubAttr[]][]
    ).map(([main, attrs]) => ({
      mainAttr: main,
      attrs,
      entries: allPossibleAttrsProb(main, attrs).map(({ combo, p }) => ({ combo, p })),
    }));

    const payload = {
      generatedFrom: 'web/src/core（权威实现）',
      note: '这是回归基线：改动 core 后重跑本脚本，diff 即回归差异。',
      stats: { subWeights: SUB_WEIGHTS, subWeightSum: SUB_WEIGHT_SUM, growths: GROWTHS },
      itemDist: {
        3: [...itemDist(3).entries()].map(([k, v]) => [k, v]),
        4: [...itemDist(4).entries()].map(([k, v]) => [k, v]),
      },
      growth,
      exact4,
      attrsProb: attrsProbRows,
      allPossible,
    };

    const out = fileURLToPath(new URL('../src/core/__fixtures__/baseline.json', import.meta.url));
    writeFileSync(out, JSON.stringify(payload, null, 1), 'utf8');
    console.log(
      `baseline.json 写入完成：${growth.length} growth 用例、${exact4.length} exact4、` +
        `${attrsProbRows.length} attrsProb、${allPossible.length} allPossible`,
    );
  });
});

function attrsProbOf(main: MainAttr, attrs: SubAttr[]): number {
  const pool = (Object.keys(SUB_WEIGHTS) as SubAttr[]).filter((a) => a !== main);
  const excluded = pool.filter((a) => !attrs.includes(a));
  return attrsProb(main, attrs, excluded);
}
void attrsProbOf;
