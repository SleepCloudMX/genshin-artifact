/**
 * 胚子质量分布 —— 归档 `init_stats.all_possible_attrs_prob` /
 * `plot_quality_distribution` / `plot_quality_distribution_stacked` 的 Web 版。
 *
 * ## 与 `growth.ts` 的分工
 *
 * 这是**另一个问题**：
 *   - `growth.ts`  回答「胚子练满 +20 之后，得分分布是什么」——含 5 次成长；
 *   - `quality.ts` 回答「刚刷到的胚子（一次没强化）本身有多好」——得分就是
 *     掉落的 4 个副词条里「有效词条」的权重之和，没有任何随机成长。
 *
 * 两者的输入都是「主词条 + 各有效词条的评分权重」，所以评分标准可以直接复用；
 * 区别在于 `growth` 需要 4 个有序槽位，而这里只关心**集合**。
 *
 * ## 口径
 *
 * - 终态一定是 4 个互不重复、且不含主词条的副词条，掉落即确定。
 * - 「有效词条」= 权重 `> 0` 的词条（与 `growth.ts` 的隐式约定一致，
 *   这样就不存在归档那种「标注了有效词条却没给权重」的不自洽输入）。
 * - 得分 = Σ(有效词条权重)，按**千分之一**整数累加后再除以 1000，
 *   避免 `0.1 + 0.2` 这类浮点误差把同一个分数劈成两个桶。
 *
 * ## 与归档的一处口径差异
 *
 * 归档允许把主词条自己写进「有效词条」列表（`gen_fixtures.py` 的样例就是这样），
 * 那些组合的概率恒为 0、会被过滤掉。这里直接在入口把与主词条冲突的词条剔除，
 * 结果相同但不会产生无意义的 0 概率组合。见 `stats.excludedSubstat`。
 */

import {
  SUB_ATTRS,
  canonicalMainAttr,
  excludedSubstat,
  hasRandomMain,
  mainProbAt,
  type MainAttr,
  type Slot,
  type SubAttr,
} from './stats';
import { allPossibleAttrsProb, attrsProb } from './combo';

/** 权重的整数刻度：这里只累加权重、不乘成长值，所以单独放大 1000 倍就够精确了 */
export const WEIGHT_SCALE = 1000;

export interface QualitySpec {
  mainAttr: MainAttr;
  /** 各有效词条的评分权重。**只有 `> 0` 的条目算有效词条** */
  weights: Partial<Record<SubAttr, number>>;
}

export interface QualityCombo {
  /** 该组合包含的有效词条，按 `SUB_ATTRS` 顺序（顺序只影响展示） */
  combo: SubAttr[];
  /** 出现概率 */
  p: number;
  /** 该组合的得分（= Σ 权重） */
  score: number;
}

export interface QualityBucket {
  /** 分数（升序排列） */
  score: number;
  /** 该分数的总概率 */
  p: number;
  /** 该分数下的组合，按概率降序 */
  combos: QualityCombo[];
}

export interface AttrProbability {
  attr: SubAttr;
  /** 掉落的胚子「含有该词条」的概率 */
  p: number;
}

export interface QualityDistribution {
  /** 规范化后的主词条（`爆伤` → `暴伤`） */
  mainAttr: MainAttr;
  /** 有效词条（按 `SUB_ATTRS` 顺序，已剔除与主词条冲突的那条） */
  attrs: SubAttr[];
  /** 被剔除的冲突词条；主词条不在副词条池里时为 `undefined` */
  droppedAttr: SubAttr | undefined;
  /** 千分制权重，与 `attrs` 一一对应 */
  scaledWeights: number[];
  /** 全部组合，按概率降序 */
  combos: QualityCombo[];
  /** 按分数聚合（分数升序） */
  buckets: QualityBucket[];
  /** 含各有效词条的概率（一次遍历聚合） */
  attrProbs: AttrProbability[];
  /** 期望得分 */
  mean: number;
  /** 概率最大的组合 */
  mode: QualityCombo | undefined;
  /** 最高可能得分 */
  best: number;
}

/** `SUB_ATTRS` 顺序的稳定排序键，避免默认 `sort()` 的码点序在不同地方不一致 */
const ATTR_ORDER = new Map<string, number>(SUB_ATTRS.map((a, i) => [a, i]));

function bySubAttrOrder(a: SubAttr, b: SubAttr): number {
  return (ATTR_ORDER.get(a) ?? 0) - (ATTR_ORDER.get(b) ?? 0);
}

/** 组合的稳定展示名：`暴击 + 暴伤`；空组合是「无有效词条」 */
export function comboLabel(combo: readonly SubAttr[]): string {
  return combo.length === 0 ? '无有效词条' : combo.join(' + ');
}

/**
 * 有效词条列表：权重 `> 0`，且不与主词条冲突。
 * 与主词条冲突的词条即使权重 `> 0` 也会被剔除（它在游戏里不可能出现）。
 */
export function qualityAttrs(
  mainAttr: MainAttr,
  weights: Partial<Record<SubAttr, number>>,
): SubAttr[] {
  const excluded = excludedSubstat(mainAttr);
  return SUB_ATTRS.filter((a) => a !== excluded && (weights[a] ?? 0) > 0);
}

/** 计算胚子（未强化）的得分分布 */
export function qualityDistribution(spec: QualitySpec): QualityDistribution {
  const mainAttr = canonicalMainAttr(spec.mainAttr);
  const attrs = qualityAttrs(spec.mainAttr, spec.weights);
  const droppedAttr = excludedSubstat(spec.mainAttr);

  const scaledOf = new Map<SubAttr, number>();
  for (const a of attrs) {
    const w = spec.weights[a] ?? 0;
    if (!Number.isFinite(w) || w <= 0) throw new Error(`词条「${a}」的权重不合法：${w}`);
    scaledOf.set(a, Math.round(w * WEIGHT_SCALE));
  }

  // allPossibleAttrsProb 已过滤概率为 0 的组合；概率之和恒为 1
  const raw = allPossibleAttrsProb(mainAttr, attrs);

  const combos: QualityCombo[] = raw.map(({ combo, p }) => {
    const sorted = [...combo].sort(bySubAttrOrder);
    let scaled = 0;
    for (const a of sorted) scaled += scaledOf.get(a) ?? 0;
    return { combo: sorted, p, score: scaled / WEIGHT_SCALE };
  });
  combos.sort((x, y) => y.p - x.p || x.score - y.score || comboLabel(x.combo).localeCompare(comboLabel(y.combo)));

  const bucketMap = new Map<number, QualityBucket>();
  const attrTotals = new Map<SubAttr, number>();
  let mean = 0;
  for (const c of combos) {
    const key = Math.round(c.score * WEIGHT_SCALE);
    let bucket = bucketMap.get(key);
    if (!bucket) {
      bucket = { score: key / WEIGHT_SCALE, p: 0, combos: [] };
      bucketMap.set(key, bucket);
    }
    bucket.p += c.p;
    bucket.combos.push(c);
    mean += c.p * c.score;
    for (const a of c.combo) attrTotals.set(a, (attrTotals.get(a) ?? 0) + c.p);
  }

  const buckets = [...bucketMap.values()].sort((x, y) => x.score - y.score);
  for (const b of buckets) b.combos.sort((x, y) => y.p - x.p);

  return {
    mainAttr,
    attrs,
    droppedAttr,
    scaledWeights: attrs.map((a) => scaledOf.get(a) ?? 0),
    combos,
    buckets,
    attrProbs: attrs.map((attr) => ({ attr, p: attrTotals.get(attr) ?? 0 })),
    mean,
    mode: combos[0],
    best: buckets.length > 0 ? buckets[buckets.length - 1]!.score : 0,
  };
}

// ---------------------------------------------------------------------------
// 派生视图
// ---------------------------------------------------------------------------

/** 生存函数：`P(得分 ≥ 该分数)`，分数升序 */
export function qualitySurvival(d: QualityDistribution): { score: number; p: number }[] {
  const out = new Array<{ score: number; p: number }>(d.buckets.length);
  let acc = 0;
  for (let i = d.buckets.length - 1; i >= 0; i--) {
    acc += d.buckets[i]!.p;
    out[i] = { score: d.buckets[i]!.score, p: acc };
  }
  return out;
}

/** 「胚子得分 ≥ targetScore」的概率 */
export function qualityProbAtLeast(d: QualityDistribution, targetScore: number): number {
  let acc = 0;
  for (const b of d.buckets) if (b.score >= targetScore) acc += b.p;
  return acc;
}

/** 大约要刷多少个胚子才能出一个「≥ targetScore 的」 */
export function qualityExpectedAttempts(
  d: QualityDistribution,
  targetScore: number,
): number | undefined {
  const p = qualityProbAtLeast(d, targetScore);
  return p > 0 ? 1 / p : undefined;
}

/** 达到目标概率所需的最低分数（分位数）；`alpha = 0.1` 表示「前 10%」 */
export function qualityScoreAtAlpha(
  d: QualityDistribution,
  alpha: number,
): number | undefined {
  for (const { score, p } of qualitySurvival(d)) if (p <= alpha) return score;
  return undefined;
}

// ---------------------------------------------------------------------------
// 饼图分片（组合数多时把长尾并成一块「其他」）
// ---------------------------------------------------------------------------

export interface PieSlice {
  /** 展示名：`暴击 + 暴伤` 或 `其他 12 种组合` */
  label: string;
  p: number;
  /** 该扇区包含的组合（「其他」扇区会含多个） */
  combos: QualityCombo[];
  /** 是否是聚合出来的长尾扇区 */
  aggregated: boolean;
}

/**
 * 把组合概率整理成饼图分片。
 *
 * 顺序是**画图顺序**：`keep` 的那一项在最前（起点固定在左上角，参考
 * `plot_attr_pie` 的 `startangle=140`），其余**按概率升序**，
 * 「其他」垫底 —— 于是从左上角逆时针走过去扇区越来越大，最大的收在起点旁边。
 *
 * 概率低于 `minShare`、或超出 `maxSlices` 名额的长尾合并成「其他」。
 * 但 `keep` 指定的那个组合**永远单独成片**（不占名额、不被合并）：
 * 它正是「有效词条全齐」的那一项 —— 概率最小，却常是这张图要回答的问题。
 *
 * 不变量：所有分片的概率之和 === 所有组合的概率之和（图形不会丢概率）。
 */
export function pieSlices(
  combos: readonly QualityCombo[],
  opts: { maxSlices?: number; minShare?: number; keep?: readonly SubAttr[] } = {},
): PieSlice[] {
  const maxSlices = opts.maxSlices ?? 12;
  const minShare = opts.minShare ?? 0.005;
  const keep = opts.keep;
  const sorted = [...combos].sort((x, y) => y.p - x.p);

  const kept = keep && keep.length > 0 ? sorted.find((c) => sameCombo(c.combo, keep)) : undefined;
  const singles: QualityCombo[] = [];
  const merged: QualityCombo[] = [];
  for (const c of sorted) {
    if (c === kept) continue;
    if (singles.length < maxSlices && c.p >= minShare) singles.push(c);
    else merged.push(c);
  }

  const slices: PieSlice[] = [];
  if (kept) slices.push({ label: comboLabel(kept.combo), p: kept.p, combos: [kept], aggregated: false });
  // 画图顺序 = 概率升序：从左上角逆时针走过去，扇区越来越大
  for (const c of singles.sort((x, y) => x.p - y.p)) {
    slices.push({ label: comboLabel(c.combo), p: c.p, combos: [c], aggregated: false });
  }
  if (merged.length > 0) {
    slices.push({
      label: `其他 ${merged.length} 种组合`,
      p: merged.reduce((s, c) => s + c.p, 0),
      combos: merged,
      aggregated: true,
    });
  }
  return slices;
}

/**
 * 两个组合是否是同一组词条（顺序无关）。
 *
 * 「得分最高的那一项」要在饼图上单独摘出来（`pieSlices` 的 `keep`），
 * 而组合的顺序在不同路径上不一定一样，所以比集合而不是比数组。
 */
export function sameCombo(a: readonly SubAttr[], b: readonly SubAttr[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** 组合里有几条有效词条（= 堆叠图与饼图的颜色档） */
export function comboSize(combo: readonly SubAttr[]): number {
  return combo.length;
}

/** 某分片是否含指定词条（用于饼图 / 堆叠图的高亮） */
export function sliceContains(slice: PieSlice, attr: SubAttr): boolean {
  return slice.combos.some((c) => c.combo.includes(attr));
}

// ---------------------------------------------------------------------------
// 掉落概率：把「部位 × 主词条 × 副词条」先验乘起来
// ---------------------------------------------------------------------------

export interface DropProbability {
  /** 主词条概率 —— 前提是已经掉到了这个部位 */
  mainP: number;
  /** 副词条包含全部「计分词条」的概率 */
  subsP: number;
  /** 相乘的结果 */
  p: number;
}

/**
 * 掉落一个「部位 = X，主词条 = Y，且副词条包含全部计分词条」的胚子的概率。
 *
 * **不含成长值**——只回答「能不能刷到这件胚子」，不回答「练满多少分」。
 *
 * ## 概率的组成
 *
 * ```
 * p = P(主词条 = Y | 部位 = X) × P(副词条 ⊇ 计分词条)
 * ```
 *
 * **部位不参与相乘**：它是刷本时的既定前提（「我打的就是这个本」），不是随机项。
 * 曾经多乘了一个 1/5，把「空之杯出火伤」的 5% 压成了 1% —— 那是把部位算了两遍。
 *
 * ## 「（不计分）」的语义
 *
 * 权重为 0 的槽位是**通配**：那些位置是什么词条都行，不参与约束。
 * 所以只有「权重 > 0 的词条」进入 `attrs`。
 *
 * 注意这不等于「刷一次副本的出货率」：一次副本掉几件不在模型内
 * （见 `memory.md` §9 的外部不确定性）。
 */
export function dropProbability(spec: QualitySpec, slot: Slot): DropProbability {
  const canonical = canonicalMainAttr(spec.mainAttr);

  // 花 / 羽的主词条固定，没有随机性 → 概率 1
  const mainP = hasRandomMain(slot) ? (mainProbAt(slot, spec.mainAttr) ?? 0) : 1;

  const attrs = qualityAttrs(spec.mainAttr, spec.weights);
  // 用户**确实**要求了词条（权重 > 0），但它们全被主词条冲突剔掉了
  // → 这是一个不可能的组合，概率 0，而不是「没有约束」的 1
  const requested = SUB_ATTRS.filter((a) => (spec.weights[a] ?? 0) > 0);
  // 必须用规范化的主词条名（爆伤 → 暴伤），否则「要暴伤副词条」会被算成可能
  const subsP =
    requested.length === 0 ? 1 : attrs.length === 0 ? 0 : attrsProb(canonical, attrs);

  return { mainP, subsP, p: mainP * subsP };
}
