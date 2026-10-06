/** 副词条组合概率。对应归档 init_stats.py 的 calc_exact_4_combo_prob / calc_attrs_prob。 */

import { SUB_WEIGHTS, SUB_ATTRS, type MainAttr, type SubAttr } from './stats';

/** 终态副词条数量：五星圣遗物最终一定有 4 个副词条 */
export const FINAL_SUB_COUNT = 4;

/** 给定主词条后的可用副词条池（排除主词条自身） */
export function poolOf(mainAttr: MainAttr): SubAttr[] {
  return SUB_ATTRS.filter((a) => a !== mainAttr);
}

/**
 * 缓存：`${mainAttr}|${排列后的词条}` → 概率。
 * 归档实现用 @cache，这里等价。
 */
const exactCache = new Map<string, number>();

function cacheKey(mainAttr: string, attrs: readonly string[]): string {
  return `${mainAttr}|${[...attrs].sort().join(',')}`;
}

/**
 * 一个确定的、正好 4 个副词条的组合的出现概率。
 *
 * 注意：副词条是**加权不放回**抽样，不同抽取顺序的概率乘积不同
 * （分母随已抽走的权重递减），所以必须遍历 4! = 24 种排列求和。
 */
export function exact4ComboProb(mainAttr: MainAttr, combo: readonly SubAttr[]): number {
  if (combo.length !== FINAL_SUB_COUNT) return 0;
  const pool = poolOf(mainAttr);
  // 与主词条相同、或不在池里的词条，概率为 0（防御性检查）
  if (combo.some((a) => !pool.includes(a))) return 0;

  const key = cacheKey(mainAttr, combo);
  const hit = exactCache.get(key);
  if (hit !== undefined) return hit;

  let totalProb = 0;
  const poolWeight = pool.reduce((s, a) => s + SUB_WEIGHTS[a], 0);

  for (const perm of permutations(combo)) {
    let p = 1;
    let currSum = poolWeight;
    for (const attr of perm) {
      p *= SUB_WEIGHTS[attr] / currSum;
      currSum -= SUB_WEIGHTS[attr];
    }
    totalProb += p;
  }

  exactCache.set(key, totalProb);
  return totalProb;
}

/** 计算含有 attrs、且不含 excluded 的概率 */
export function attrsProb(
  mainAttr: MainAttr,
  attrs: readonly SubAttr[],
  excluded: readonly SubAttr[] = [],
): number {
  const attrSet = new Set(attrs);
  const exclSet = new Set(excluded);

  if (attrSet.size > FINAL_SUB_COUNT) return 0;
  // 注意：这里是 Set，必须用 .has()；写成 `mainAttr in attrSet` 恒为 false
  if (attrSet.has(mainAttr as SubAttr)) return 0;
  for (const a of attrSet) if (exclSet.has(a)) return 0;

  const pool = poolOf(mainAttr);
  const candidates = pool.filter((k) => !attrSet.has(k) && !exclSet.has(k));
  const slotsToFill = FINAL_SUB_COUNT - attrSet.size;
  if (candidates.length < slotsToFill) return 0;

  let totalProb = 0;
  for (const filler of combinations(candidates, slotsToFill)) {
    totalProb += exact4ComboProb(mainAttr, [...attrSet, ...filler]);
  }
  return totalProb;
}

export interface AttrCombo {
  /** 该组合中包含的有效词条（升序） */
  combo: SubAttr[];
  /** 出现概率 */
  p: number;
}

/**
 * 有效词条任意组合的概率（已过滤概率为 0 的项）。
 * 概率之和恒为 1（已用 `tools/verify_math.py` 与归档实现对拍验证）。
 */
export function allPossibleAttrsProb(
  mainAttr: MainAttr,
  attrs: readonly SubAttr[],
): AttrCombo[] {
  const unique = [...new Set(attrs)];
  const out: AttrCombo[] = [];

  for (let n = 0; n <= unique.length; n++) {
    for (const comb of combinations(unique, n)) {
      const combSet = new Set(comb);
      const excluded = unique.filter((a) => !combSet.has(a));
      const p = attrsProb(mainAttr, comb, excluded);
      if (p > 0) out.push({ combo: [...comb].sort(), p });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 组合枚举工具（避免依赖生成器，便于在热路径上使用普通循环）
// ---------------------------------------------------------------------------

export function* combinations<T>(items: readonly T[], k: number): Generator<T[]> {
  const n = items.length;
  if (k < 0 || k > n) return;
  if (k === 0) {
    yield [];
    return;
  }
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield idx.map((i) => items[i]!);
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

export function* permutations<T>(items: readonly T[]): Generator<T[]> {
  const arr = [...items];
  const n = arr.length;
  const c = new Array<number>(n).fill(0);
  yield [...arr];
  let i = 0;
  while (i < n) {
    if (c[i]! < i) {
      const j = i % 2 === 0 ? 0 : c[i]!;
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      yield [...arr];
      c[i]!++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}
