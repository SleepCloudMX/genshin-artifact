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
 * ## 数值口径：全部用整数
 *
 * 归档用浮点算分数、最后 `f'{score:.1f}'` 取整。那样**结果依赖二进制浮点误差**：
 * 例如 `4.08 + 2.0913*5 = 14.5365` 在浮点里的最后一位不可控，
 * 落在 `.x5` 边界上就会取整到不同的 0.1。同一条规则换个语言实现就会漂移。
 *
 * 因此这里把一切都换成正整数刻度，**一次浮点乘法都不做**：
 *   - 成长值两位小数 → ×1000（`7.77` → `7770`）；
 *   - 权重两位小数 → ×100（`0.25` → `25`）；
 *   - 两者相乘即得「十万分之一分」为单位的整数（`7770 × 25 = 194250` → 1.9425 分）。
 *
 * 最后一次性取整到 0.1，规则固定为**四舍五入（round-half-up）**。
 * 这样任何语言、任何顺序都得到同一张表。
 *
 * `weight` 在界面上被归整到两位小数（`ui/state.ts`），所以 ×100 不会丢位。
 */

import { GROWTHS, UPGRADE_COUNT, type SubAttr } from './stats';

/** 成长值的整数刻度：1 点 = 1000 个刻度（成长值最多两位小数） */
const GROWTH_SCALE = 1000;

/** 权重的整数刻度：1 = 100 个刻度（权重最多两位小数） */
const WEIGHT_SCALE = 100;

/** 分数的整数刻度：1 分 = 1e5 个刻度（= 成长值刻度 × 权重刻度） */
export const SCORE_SCALE = GROWTH_SCALE * WEIGHT_SCALE;

/** 成长档位数（四档）。固定初始档位时要按它补路径数，见 `slotTables` */
export const TIER_COUNT = 4;

/**
 * 掉落时的**初始档位**（那一次落下来的成长值取第几档）。
 *
 * 单独建这个类型是因为它和后续成长是两回事：掉落时的那一次是**一件胚子的既成事实**，
 * 后续 4~5 次才是随机的。允许把它固定成某一档，就能回答
 * 「初始最小 / 初始最大分别能到多少分」这类问题。
 */
export type InitialRoll = 'random' | 0 | 1 | 2 | 3;

/** 初始档位的全部可选值，界面直接遍历这个数组 */
export const INITIAL_ROLLS: readonly InitialRoll[] = ['random', 0, 1, 2, 3];

export function isInitialRoll(v: unknown): v is InitialRoll {
  return v === 'random' || v === 0 || v === 1 || v === 2 || v === 3;
}

/** 一个副词条槽位 */
export interface Slot {
  attr: SubAttr;
  /** 计分权重。0 表示该词条已知但不计分。建议用 1 / 0.5 / 0.1 之类的小数 */
  weight: number;
  /** 掉落时那一次成长取第几档；`'random'` 表示四档等概率 */
  initialRoll: InitialRoll;
}

/** 掉落时可见的副词条数量 */
export type InitialVisible = 3 | 4;

export interface ArtifactSpec {
  /**
   * 4 个副词条，**顺序有语义**（成长次数的分配不对称，不要重排）。
   * 3 词条胚子时第 4 个是「第 1 次成长才激活」的那个，通常 weight = 0；
   * 它也会被自动当成「掉落时不存在」，`initialRoll` 对它无意义。
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
 * 成长值 → 整数刻度（×1000）。
 *
 * 成长值本身就是两位小数，所以这一步是精确的（`Math.round` 只是抹掉 `7.77 × 1000`
 * 在二进制浮点里可能的 `7769.999…`）。
 */
function growthScaled(g: number): number {
  return Math.round(g * GROWTH_SCALE);
}

/** 权重 → 整数刻度（×100）。界面把权重归整到两位小数，所以这里同样精确 */
function weightScaled(w: number): number {
  return Math.round(w * WEIGHT_SCALE);
}

// ---------------------------------------------------------------------------
// 各槽位「一共被成长 d 次」的 (加权得分, 序列数) 表
//
// 两个关键点：
//   1. 先把成长值乘上槽位权重、再合并同类项（两个整数相乘，永远精确）；
//   2. 分数保持整数刻度，直到最后一步才取整到 0.1。
//
// 「一共被成长 d 次」= 掉落那一次 + 后续 (d-1) 次强化。掉落那次走**初始档位**
// （可固定也可随机），后续每次才是四档等概率。两者是先验不同的两件事，
// 分开算才对——早期版本把掉落那次也当成四档随机，那是简化。
// ---------------------------------------------------------------------------
const slotTableCache = new Map<string, number[][]>();

/** 一个槽位的四档成长值（已乘权重、整数刻度） */
function tierValues(attr: SubAttr, weight: number): number[] {
  const w = weightScaled(weight);
  return GROWTHS[attr].map((g) => growthScaled(g) * w);
}

/** 把「(和, 权重) 表」按一个档位表再卷积一次 */
function convolve(acc: Map<number, number>, addends: number[]): Map<number, number> {
  const next = new Map<number, number>();
  for (const [sum, count] of acc) {
    for (const g of addends) next.set(sum + g, (next.get(sum + g) ?? 0) + count);
  }
  return next;
}

/** 把 Map 摊平成 [和, 权重, 和, 权重, …]，减少后续的元组开销 */
function flatten(acc: Map<number, number>): number[] {
  const flat = new Array<number>(acc.size * 2);
  let i = 0;
  for (const [sum, count] of acc) {
    flat[i++] = sum;
    flat[i++] = count;
  }
  return flat;
}

/**
 * `tables[d]` = 「一共被成长 `d` 次」的 (和, 序列数) 扁平表。
 * `tables[0]` 是「一次都没有」= 得分 0、1 条路径。
 *
 * ## 不变量：`tables[d]` 恒有 `4^d` 条路径
 *
 * 两处都靠它：
 *   - `itemDist` 的键与 `totalOf` 的计数口径；
 *   - 「固定初始档位」与「随机初始档位」的结果可比 —— 固定档位只改变
 *     那一次取值的**分布**，不该改变总权重。
 *
 * 随机档位天然是 4 条路径（四档各一条）；**固定档位只有 1 条路径**，
 * 所以要乘 4 补回来。不补的话，固定几个槽位，全表权重就和 total 差 4 的幂
 * （`scoreDistribution` 的自洽性断言会直接拦住）。
 *
 * **3 词条胚子的第 4 个槽位也必须满足它**：那条副词条虽然是第 1 次成长才激活的，
 * 但激活它的那一次就是它的初始档位（游戏里第 4 条一出现就带一个档位值），
 * 所以它的第一次也是「四档随机」，不是「纯成长」。
 */
function slotTables(attr: SubAttr, weight: number, initialRoll: InitialRoll): number[][] {
  // 键用**归整后的**权重：0.5 与 0.50 是同一张表，不要各缓存一份
  const key = `${attr}|${weightScaled(weight)}|${initialRoll}`;
  const cached = slotTableCache.get(key);
  if (cached) return cached;

  const tiers = tierValues(attr, weight);

  // 掉落那一次：随机 = 四档各一条路径；固定 = 一条路径 × 4（见上）
  let acc = new Map<number, number>();
  if (initialRoll === 'random') {
    for (const g of tiers) acc.set(g, (acc.get(g) ?? 0) + 1);
  } else {
    acc.set(tiers[initialRoll]!, TIER_COUNT);
  }

  const tables: number[][] = [[0, 1], flatten(acc)];
  for (let d = 2; d <= UPGRADE_COUNT + 2; d++) {
    acc = convolve(acc, tiers);
    tables.push(flatten(acc));
  }

  slotTableCache.set(key, tables);
  return tables;
}
/**
 * 整数刻度 → 文案：最多 5 位小数、去掉末尾多余的 0，**至少保留一位小数**。
 *
 * 直接按整数拆位而不是 `(units / 1e5).toFixed(...)`：那样又绕回浮点。
 * 保留一位小数是为了让 `7` 显示成 `7.0` —— 它是两位小数的成长值算出来的一个「分」值，
 * 写成整数会让人以为是另一类数。
 */
function unitsText(units: number): string {
  const sign = units < 0 ? '-' : '';
  const u = Math.round(Math.abs(units));
  const whole = Math.floor(u / SCORE_SCALE);
  const frac = String(u % SCORE_SCALE)
    .padStart(5, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}.${frac === '' ? '0' : frac}`;
}

/**
 * 某词条「成长到第 t 档」的展示文案，如 `2.72`；带权重时显示计分值，如权重 2 → `5.44`。
 *
 * 走的是**和计算同一套整数刻度**，所以界面上读到的数与真正参与运算的数不可能不一致
 * （`2.72 × 0.25` 显示 `0.68`，运算也是 `0.68`）。
 */
export function tierLabel(attr: SubAttr, tier: number, weight = 1): string {
  const g = GROWTHS[attr][tier as 0 | 1 | 2 | 3];
  if (g === undefined) return '—';
  return unitsText(growthScaled(g) * weightScaled(weight));
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

/**
 * 归一化常数（= 稠密表全部权重之和）。
 *
 * ## 推导
 *
 * `itemDist` 的每个键是「4 个槽位各自一共被成长多少次」，Σd = σd（词条数 + 5）；
 * 它的值 `freq` 是该多重集的排列数。键 `k` 贡献的权重是
 *
 *     freq_k × Π_v |tables[d_v]| = freq_k × Π_v 4^(d_v) = freq_k × 4^σd
 *
 * 而 `Σ freq_k = 4^(词条数+1)`、所有键的 σd 相同，所以
 *
 *     total = 4^σd × Σ freq_k = 4^(σd + 词条数 + 1)
 *
 * 实测量（`tools/` 侧核对）：3 词条 4^12 = 16777216，4 词条 4^14 = 268435456。
 *
 * **易错点**：Σd 里每个可见槽位都含掉落那一次，所以 σd 比「产生成长的次数」
 * 大 `词条数`。曾经在这里多加过一次 `initialVisible + 1`，差 4 倍。
 *
 * 注意：本函数现在**只是自洽性校验用的期望值**——`scoreDistribution` 直接累加
 * 真实权重作为 `total`，不再依赖这个公式（公式算错也不该让结果算错）。
 */
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
 * 十万分之一分 → 十分之一分（一位小数对应的整数刻度）。
 *
 * 全程整数运算，规则固定为**四舍五入**，不依赖浮点误差。
 * 例：1080000（= 10.8 分）→ 108；1455000（= 14.55 分）→ 146 → 14.6 分。
 */
function tenthsOf(scaledScore: number): number {
  const tenth = SCORE_SCALE / 10;
  const q = Math.floor(scaledScore / tenth);
  const r = scaledScore - q * tenth;
  return r * 2 >= tenth ? q + 1 : q;
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
  // `itemDist` 的键是「4 个槽位各自一共被成长多少次」（Σ = 词条数 + 5），
  // 第 4 个槽位在 3 词条胚子里也照样有「初始档位」——激活它的那次成长就是它的档位。
  const perSlot = slots.map((s) => slotTables(s.attr, s.weight, s.initialRoll));

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

  // `total` 直接累加真实权重，**不要用公式算**：
  // 公式（`totalOf`）只当自洽性校验的期望值，算错也不该让结果跟着错。
  let total = 0;
  for (const row of hits) for (const w of row) total += w;
  const expected = totalOf(initialVisible);
  if (total !== expected) {
    throw new Error(`权重之和 ${total} 不等于归一化常数 ${expected}`);
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

/**
 * **条件分布**：在「得分 ≥ `scores[i]`」的条件下，命中次数的分布（Σ = 1）。
 *
 * 回答的是「够到这条线的那些结果，是靠命中次数多堆出来的，还是靠档位好」——
 * 与 `survival` 是同一批样本，只是换个维度切开。
 *
 * 口径：分母是「≥ 该分数」的**权重和**（= `survival[i] × total`），
 * 所以**它一定与 `survival[i]` 无关地归一化**：换个分数线，各档的占比会变，
 * 但合计恒为 100%。直接累加权重再除，不绕道概率，避免二次舍入。
 *
 * 下标越界时的约定（防御性，正常调用不会遇到）：
 * `i < 0` 等同于 `i = 0`（「≥ 比最低分还低」就是全部结果）；
 * `i ≥ scores.length` 返回全 0（没有任何结果满足）。
 */
export function hitMixAtLeast(table: DistributionTable, i: number): number[] {
  const out = new Array<number>(table.hitBuckets).fill(0) as number[];
  let sum = 0;
  for (let j = Math.max(0, i); j < table.hits.length; j++) {
    const row = table.hits[j]!;
    for (let h = 0; h < table.hitBuckets; h++) {
      const w = row[h]!;
      if (w === 0) continue;
      out[h] = (out[h] ?? 0) + w;
      sum += w;
    }
  }
  if (sum > 0) {
    for (let h = 0; h < out.length; h++) out[h] = (out[h] ?? 0) / sum;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 分桶：把相邻分数合并成一根柱子
// ---------------------------------------------------------------------------

/**
 * 可选的分桶宽度（单位「分」）。`0.1` = 不合并（分数本身就是 0.1 的倍数）。
 *
 * 为什么是离散档位而不是「随便填一个 d」：桶边界要对齐到 d 的整数倍，
 * 否则同一个桶在不同配置下含义会变（`[20.7, 21.6]` 这种）。对齐之后
 * `[20.0, 20.9]` 这种含义稳定的桶只有 d ∈ {0.1, 0.2, 0.5, 1, 2, 5…} 能得到，
 * 所以做成可选档位反而更清楚。
 *
 * **默认 0.2**（见 `ui/state.ts` 的 `defaultGrowth`）：0.1 在默认配置下有一百多根柱子，
 * 糊成一片；再粗就看不到分布形状了。这里不做「按柱数自动挑档」——
 * 自动挑的档会随输入悄悄变，用户以为在看同一个视图，实际比例尺已经换了。
 */
export const BUCKET_OPTIONS = [0.1, 0.2, 0.5, 1, 2, 5] as const;
export type BucketSize = (typeof BUCKET_OPTIONS)[number];

export function isBucketSize(v: unknown): v is BucketSize {
  return (BUCKET_OPTIONS as readonly number[]).includes(v as number);
}

export interface ScoreBucket {
  /** 桶的起点分数（`size` 的整数倍）—— 轴上的标号就用它 */
  score: number;
  /** 桶内实际的最小 / 最大分数；只有一个分数时二者相等 */
  minScore: number;
  maxScore: number;
  /** 桶内分数个数；1 表示这根柱子就是一个分数 */
  count: number;
  /** 桶内各命中档的概率之和，下标 = 命中次数 */
  byHit: number[];
  /** 桶内总概率 */
  total: number;
}

/**
 * 把「每个分数的命中构成」按 `size` 合并成桶。
 *
 * **桶边界对齐到 `size` 的整数倍**（`floor(score / size)`），而不是从最低分开始切：
 * `size = 1` 时永远是 `[20.0, 20.9]` 这样的桶，含义与具体配置无关。
 *
 * 桶起点按「整数下标 × size 再归整到 0.1」算，避免 `0.1 × 整数` 攒出
 * `10.799999999999999` 这类毛刺（分数网格本身就是 0.1）。
 *
 * `size <= 0.1` 时不合并，原样返回（每个分数一根柱子）。
 */
export function bucketize(
  scores: readonly number[],
  byHitRows: readonly number[][],
  size: number,
): ScoreBucket[] {
  if (!(size > 0.1 + 1e-9)) {
    return scores.map((score, i) => {
      const byHit = byHitRows[i] ?? [];
      return {
        score,
        minScore: score,
        maxScore: score,
        count: 1,
        byHit: [...byHit],
        total: byHit.reduce((s, v) => s + v, 0),
      };
    });
  }

  const buckets = new Map<number, ScoreBucket>();
  scores.forEach((score, i) => {
    const index = Math.floor(score / size + 1e-9);
    // 先算整数下标再乘，最后归整到 0.1 —— 分数网格就是 0.1
    const start = Math.round(index * size * 10) / 10;
    let b = buckets.get(start);
    if (!b) {
      b = { score: start, minScore: score, maxScore: score, count: 0, byHit: [], total: 0 };
      buckets.set(start, b);
    }
    const row = byHitRows[i] ?? [];
    for (let h = 0; h < row.length; h++) {
      b.byHit[h] = (b.byHit[h] ?? 0) + (row[h] ?? 0);
    }
    b.count++;
    b.minScore = Math.min(b.minScore, score);
    b.maxScore = Math.max(b.maxScore, score);
    b.total += row.reduce((s, v) => s + v, 0);
  });

  // 每个桶的 byHit 补齐长度，避免图上读到 undefined
  const width = buckets.size === 0 ? 0 : Math.max(...[...buckets.values()].map((b) => b.byHit.length));
  for (const b of buckets.values()) {
    for (let h = 0; h < width; h++) b.byHit[h] = b.byHit[h] ?? 0;
  }
  return [...buckets.values()].sort((a, b) => a.score - b.score);
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
