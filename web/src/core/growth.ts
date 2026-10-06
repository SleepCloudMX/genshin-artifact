/**
 * 强化后得分分布 —— 精确整数模型。
 *
 * 这是重构后的**权威实现**（归档 `src/artifact_growth/artifact_growth.py` 只作参考，
 * 两者的数值口径差异见 `docs/ai-output/1-refactor/01-code-review.md`）。
 *
 * ## 游戏模型
 *
 * 一件五星圣遗物满级 +20，**最终一定有 4 个副词条**，共 5 次成长：
 *   - 掉落时 4 个副词条已可见（「4 词条胚子」）：
 *     5 次成长分给 4 个副词条，每个至少吃到 1 次（掉落时那一次）。
 *   - 掉落时只可见 3 个（「3 词条胚子」）：
 *     第 1 次成长用于**激活第 4 个副词条**（不产生成长分），剩 4 次再分配。
 *   - 每次成长有 4 种档位；某槽位成长 d 次就有 4^d 条等权序列。
 *   - 命中的定义：`hits = Σ(计分槽位的次数) − 计分槽位数`，
 *     减掉的那部分就是掉落时的初始档位，不是「成长」。
 *
 * ## 数值口径：全部用整数（×1000）
 *
 * 归档用浮点算分数、最后 `f'{score:.1f}'` 取整。那样**结果依赖二进制浮点误差**：
 * 例如 `4.1 + 2.09*5 = 14.55` 在浮点里是 `14.550000000000002` → 14.6，
 * 而精确十进制 14.55 按 round-half-even 应得 14.6、按 round-half-up 得 14.6/14.5 之争。
 * 同一条规则换个语言实现就会漂移。
 *
 * 因此这里把一切都放大 1000 倍成整数：
 *   分数以「千分之一分」为单位；权重以「千分之一」为单位。
 * 成长值 `209 × 权重 0.01` → `209000 × 10 = 2090000`（精确），
 * 最后一次性取整到 0.1，规则固定为**四舍五入（round-half-up）**。
 * 这样任何语言、任何顺序都得到同一张表。
 */

import { GROWTHS, UPGRADE_COUNT, type SubAttr } from './stats';

/** 内部固定的放大倍数：分数与权重都 ×1000 */
export const SCALE = 1000;

/** 一个副词条槽位 */
export interface Slot {
  attr: SubAttr;
  /** 计分权重。0 表示该词条已知但不计分。建议用 1 / 0.5 / 0.1 之类的小数 */
  weight: number;
}

/** 掉落时可见的副词条数量 */
export type InitialVisible = 3 | 4;

export interface ArtifactSpec {
  /**
   * 4 个副词条，**顺序有语义**（成长次数的分配不对称，不要重排）。
   * 3 词条胚子时第 4 个是「第 1 次成长才激活」的那个，通常 weight = 0。
   */
  slots: readonly [Slot, Slot, Slot, Slot];
  /** 掉落时可见几个副词条 */
  initialVisible: InitialVisible;
}

/** 结果：稠密二维权重表 */
export interface DistributionTable {
  /** 归一化常数（全部权重之和）；概率 = 权重 / total */
  total: number;
  /** 得分升序，单位「分」（一位小数） */
  scores: number[];
  /** hits[命中次数][得分下标] = 权重 */
  hits: number[][];
  /** 计分槽位（weight > 0）的数量 */
  scoredSlots: number;
  /** 命中次数的档数（= hits 的列数） */
  hitBuckets: number;
}

/**
 * 把成长值转成整数刻度（×1000）。
 *
 * 注意这里**只放大成长值，不放大权重**：权重（0.1 / 0.5 / 1 / 2 …）与 ×1000 后的
 * 成长值相乘仍是精确整数，所以「先乘权重再合并同类项」全程无浮点误差。
 */
function growthScaled(g: number): number {
  return Math.round(g * SCALE);
}

// ---------------------------------------------------------------------------
// 各槽位「被成长 d 次」的 (加权得分, 序列数) 表
//
// 两个关键点：
//   1. 先把成长值乘上槽位权重、再合并同类项（`g × w` 在整数刻度上是精确的）；
//   2. 分数保持整数刻度，直到最后一步才取整到 0.1。
// ---------------------------------------------------------------------------
const slotTableCache = new Map<string, number[][]>();

function slotTables(attr: SubAttr, weight: number): number[][] {
  const key = `${attr}|${weight}`;
  const cached = slotTableCache.get(key);
  if (cached) return cached;

  const scale = SCALE;
  // 成长值先 ×1000 成整数，再乘原始权重（0.1/0.5/1/2… 与 1000 的倍数相乘仍精确）
  const tiers = GROWTHS[attr].map((g) => growthScaled(g) * weight);

  const tables: number[][] = [[0, 1]];
  let acc = new Map<number, number>([[0, 1]]);

  for (let d = 1; d <= UPGRADE_COUNT + 2; d++) {
    const next = new Map<number, number>();
    for (const [sum, count] of acc) {
      for (const g of tiers) next.set(sum + g, (next.get(sum + g) ?? 0) + count);
    }
    acc = next;
    const flat = new Array<number>(next.size * 2);
    let i = 0;
    for (const [sum, count] of next) {
      flat[i++] = sum;
      flat[i++] = count;
    }
    tables.push(flat);
  }

  slotTableCache.set(key, tables);
  return tables;
}

// ---------------------------------------------------------------------------
// 成长次数的分配权重
//
// 键 = 「每个副词条一共被成长多少次」的 4 元组（掉落那一次已算在内）。
// 权重 = 该多重集里「可区分的分配方式数」，取自归档的 dist_freq 表。
//   visible=4：键的 Σ = 9（5 次成长 + 4 次初始档位）
//   visible=3：键的 Σ = 8（4 次成长 + 4 次初始档位；少的那次用于激活第 4 条）
// ---------------------------------------------------------------------------
const ALLOC_VISIBLE_3: ReadonlyArray<readonly [number, number, number, number, number]> = [
  // [a, b, c, d, 权重]
  [4, 0, 0, 0, 1],
  [3, 1, 0, 0, 4],
  [2, 2, 0, 0, 6],
  [2, 1, 1, 0, 12],
  [1, 1, 1, 1, 24],
];

const ALLOC_VISIBLE_4: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [5, 0, 0, 0, 1],
  [4, 1, 0, 0, 5],
  [3, 2, 0, 0, 10],
  [3, 1, 1, 0, 20],
  [2, 2, 1, 0, 30],
  [2, 1, 1, 1, 60],
];

/** 分配表：键 = 4 元组（已 +1）的字符串，值 = 权重 */
export function itemDist(initialVisible: InitialVisible): Map<string, number> {
  const alloc = initialVisible === 3 ? ALLOC_VISIBLE_3 : ALLOC_VISIBLE_4;
  const out = new Map<string, number>();
  for (const [a, b, c, d, freq] of alloc) {
    for (const perm of distinctPermutations([a, b, c, d])) {
      out.set(perm.map((k) => k + 1).join(','), freq);
    }
  }
  return out;
}

/** 4 个整数的全部相异排列 */
function distinctPermutations(values: number[]): number[][] {
  const out: number[][] = [];
  const acc: number[] = [];
  const used = new Array<boolean>(4).fill(false);
  const walk = (): void => {
    if (acc.length === 4) {
      out.push([...acc]);
      return;
    }
    for (let i = 0; i < 4; i++) {
      if (used[i]) continue;
      // 同一取值只从第一个未使用的位置展开一次，避免重复排列
      if (i > 0 && !used[i - 1] && values[i] === values[i - 1]) continue;
      used[i] = true;
      acc.push(values[i]!);
      walk();
      acc.pop();
      used[i] = false;
    }
  };
  walk();
  return out;
}

/** 归一化常数。应与「稠密表全部权重之和」相等（`scoreDistribution` 内部会断言） */
export function totalOf(initialVisible: InitialVisible): number {
  const dist = itemDist(initialVisible);
  let sumFreq = 0;
  for (const v of dist.values()) sumFreq += v;
  const first = dist.keys().next().value as string;
  const sigmaD = first.split(',').reduce((s, x) => s + Number(x), 0);
  return sumFreq * 4 ** sigmaD;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 千分之一分 → 十分之一分（一位小数对应的整数刻度）。
 *
 * 分数刻度是 ×1000，所以一「十分之一分」= 100 个刻度。
 * 全程整数运算，规则固定为**四舍五入**，不依赖浮点误差。
 * 例：10800（= 10.8 分）→ 108；14550（= 14.55 分）→ 146 → 14.6 分。
 */
function tenthsOf(scaledScore: number): number {
  const q = Math.floor(scaledScore / 100);
  const r = scaledScore - q * 100;
  return r >= 50 ? q + 1 : q;
}

/** 计算强化后得分分布 */
export function scoreDistribution(spec: ArtifactSpec): DistributionTable {
  const { slots, initialVisible } = spec;
  if (slots.length !== 4) {
    throw new Error('slots 必须恰好 4 个：3 词条胚子的第 4 个位置传 weight = 0');
  }

  const scoredSlots = slots.filter((s) => s.weight > 0).length;
  // 产生成长的次数：4 词条胚子 5 次；3 词条胚子第 1 次用于激活第 4 条，剩 4 次
  const upgradeCount = initialVisible + 1;
  const hitBuckets = upgradeCount + 1;
  const perSlot = slots.map((s) => slotTables(s.attr, s.weight));

  /** 得分（十分之一分）→ (命中数 → 权重) */
  const byScore = new Map<number, Map<number, number>>();

  for (const [key, freq] of itemDist(initialVisible)) {
    const counts = key.split(',').map(Number);

    // 命中数 = 计分槽位吃到的总次数 − 计分槽位数（后者是掉落时的初始档位）
    let total = 0;
    for (let v = 0; v < 4; v++) {
      if (slots[v]!.weight > 0) total += counts[v]!;
    }
    const hitIdx = total - scoredSlots;
    if (hitIdx < 0 || hitIdx >= hitBuckets) continue;

    // 4 个槽位的成长序列笛卡尔积（整数刻度）
    let scores = [0];
    let ways = [1];

    for (let v = 0; v < 4; v++) {
      const table = perSlot[v]![counts[v]!]!;
      const pairs = table.length / 2;
      const nScores = new Array<number>(scores.length * pairs);
      const nWays = new Array<number>(scores.length * pairs);
      let k = 0;
      for (let i = 0; i < scores.length; i++) {
        const s0 = scores[i]!;
        const w0 = ways[i]!;
        for (let j = 0; j < pairs; j++) {
          nScores[k] = s0 + table[j * 2]!;
          nWays[k] = w0 * table[j * 2 + 1]!;
          k++;
        }
      }
      scores = nScores;
      ways = nWays;
    }

    for (let i = 0; i < scores.length; i++) {
      const tenths = tenthsOf(scores[i]!);
      let row = byScore.get(tenths);
      if (!row) {
        row = new Map();
        byScore.set(tenths, row);
      }
      row.set(hitIdx, (row.get(hitIdx) ?? 0) + ways[i]! * freq);
    }
  }

  const sortedTenths = [...byScore.keys()].sort((a, b) => a - b);
  const hits = sortedTenths.map((t) => {
    const row = byScore.get(t)!;
    const out = new Array<number>(hitBuckets).fill(0);
    for (const [h, w] of row) out[h] = w;
    return out;
  });

  const total = totalOf(initialVisible);
  let sum = 0;
  for (const row of hits) for (const w of row) sum += w;
  if (sum !== total) {
    throw new Error(`权重之和 ${sum} 不等于归一化常数 ${total}`);
  }

  return {
    total,
    scores: sortedTenths.map((t) => t / 10),
    hits,
    scoredSlots,
    hitBuckets,
  };
}

// ---------------------------------------------------------------------------
// 派生视图
// ---------------------------------------------------------------------------

/** 每个得分的总概率 */
export function pmf(table: DistributionTable): number[] {
  return table.hits.map((row) => row.reduce((s, w) => s + w, 0) / table.total);
}

/** CDF：≤ 该得分的概率 */
export function cdf(table: DistributionTable): number[] {
  let acc = 0;
  return pmf(table).map((v) => (acc += v));
}

/** 生存函数：≥ 该得分的概率（即「X 分及以上」） */
export function survival(table: DistributionTable): number[] {
  const p = pmf(table);
  const out = new Array<number>(p.length);
  let acc = 0;
  for (let i = p.length - 1; i >= 0; i--) {
    acc += p[i]!;
    out[i] = acc;
  }
  return out;
}

/** 按命中次数切分的 PMF（用于堆叠柱状图）：`[命中次数][得分下标]` */
export function pmfByHit(table: DistributionTable): number[][] {
  return Array.from({ length: table.hitBuckets }, (_, h) =>
    table.hits.map((row) => row[h]! / table.total),
  );
}

/** 每个命中次数档的总概率（只有概率 > 0 的档） */
export function hitProbabilities(table: DistributionTable): { hits: number; p: number }[] {
  const out: { hits: number; p: number }[] = [];
  for (let h = 0; h < table.hitBuckets; h++) {
    let w = 0;
    for (const row of table.hits) w += row[h]!;
    if (w > 0) out.push({ hits: h, p: w / table.total });
  }
  return out;
}

/** 「达到 targetScore 分」的概率。`inclusive = false` 时是严格大于 */
export function probAtLeast(
  table: DistributionTable,
  targetScore: number,
  inclusive = true,
): number {
  const p = pmf(table);
  let acc = 0;
  for (let i = 0; i < table.scores.length; i++) {
    const s = table.scores[i]!;
    if (inclusive ? s >= targetScore : s > targetScore) acc += p[i]!;
  }
  return acc;
}

/** 达到目标概率所需的最小分数（分位数）。`alpha = 0.1` 表示「前 10%」 */
export function scoreAtAlpha(table: DistributionTable, alpha: number): number | undefined {
  const s = survival(table);
  for (let i = 0; i < s.length; i++) if (s[i]! <= alpha) return table.scores[i];
  return undefined;
}

/** 「大约需要多少个胚子才能出一个 ≥ targetScore 的」 */
export function expectedAttempts(
  table: DistributionTable,
  targetScore: number,
): number | undefined {
  const p = probAtLeast(table, targetScore);
  return p > 0 ? 1 / p : undefined;
}
