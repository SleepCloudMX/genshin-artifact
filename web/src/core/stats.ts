/** 词条枚举与权重表。数值取自归档实现（src/artifact_growth/），勿随意改动。 */

/** 部位 */
export const POSITIONS = ['沙', '杯', '头'] as const;
export type Position = (typeof POSITIONS)[number];

/** 副词条：与主词条同类，可以成为主词条 */
export const SUB_ATTRS = [
  '小生命', '小攻击', '小防御',
  '大生命', '大防御', '大攻击',
  '暴击', '暴伤', '充能', '精通',
] as const;
export type SubAttr = (typeof SUB_ATTRS)[number];

/** 仅能作为主词条的词条（不会出现在副词条池里） */
export const MAIN_ONLY_ATTRS = [
  '火伤', '雷伤', '岩伤', '风伤', '水伤', '冰伤', '草伤', '物伤', '治疗', '爆伤',
] as const;
export type MainOnlyAttr = (typeof MAIN_ONLY_ATTRS)[number];

export type MainAttr = SubAttr | MainOnlyAttr;

export const MAIN_ATTRS: readonly MainAttr[] = [...SUB_ATTRS, ...MAIN_ONLY_ATTRS];

/**
 * 副词条权重（对应归档 get_stats 的 sub_weights）。
 * 副词条因为「不能与主词条相同」且「不能两两重复」，不能直接用概率，所以用权重。
 */
export const SUB_WEIGHTS: Record<SubAttr, number> = {
  小生命: 150, 小攻击: 150, 小防御: 150,
  大生命: 100, 大防御: 100, 大攻击: 100,
  暴击: 75, 暴伤: 75, 充能: 100, 精通: 100,
};

/** 副词条权重和（= 1100） */
export const SUB_WEIGHT_SUM = SUB_ATTRS.reduce((s, a) => s + SUB_WEIGHTS[a], 0);

/**
 * 主词条权重（官方千分比数据）。
 * 沙的和 = 5000，杯的和 = 4000；头用的是相对权重（和 = 50），
 * 所以 P(暴击主词条) = 5/50 = 0.10 —— 这是近似，不是精确的 1/7。
 */
export const MAIN_WEIGHTS: Record<Position, Partial<Record<MainAttr, number>>> = {
  沙: { 大生命: 1334, 大防御: 1333, 大攻击: 1333, 充能: 500, 精通: 500 },
  杯: {
    大生命: 767, 大防御: 767, 大攻击: 766, 精通: 100, 物伤: 200,
    火伤: 200, 雷伤: 200, 岩伤: 200, 风伤: 200, 水伤: 200, 冰伤: 200, 草伤: 200,
  },
  头: { 大生命: 11, 大防御: 11, 大攻击: 11, 暴击: 5, 爆伤: 5, 治疗: 5, 精通: 2 },
};

/**
 * 副词条的 4 档成长值。与归档 `growths` 完全一致（原始量纲，未经换算）。
 *
 * 注意 小生命/小防御 用的是原始整数（209/239/...），不是换算成百分比后的 2.09。
 * 这不是笔误：权重（如 0.01）就是用来把原始量纲换算到得分量纲的，
 * 先除以 100 再做浮点乘法会丢精度（`2.09 * 0.01 * 10` 会被舍入成 0）。
 */
export const GROWTHS: Record<SubAttr, readonly [number, number, number, number]> = {
  暴击: [2.7, 3.1, 3.5, 3.9],
  暴伤: [5.4, 6.2, 7.0, 7.8],
  大攻击: [4.1, 4.7, 5.3, 5.8],
  小攻击: [14, 16, 18, 19],
  精通: [16, 19, 21, 23],
  充能: [4.5, 5.2, 5.8, 6.5],
  大生命: [4.1, 4.7, 5.3, 5.8],
  小生命: [209, 239, 269, 299],
  大防御: [5.1, 5.8, 6.6, 7.3],
  小防御: [16, 19, 21, 23],
};

/** 五星圣遗物满级 +20 的副词条成长次数 */
export const UPGRADE_COUNT = 5;

/**
 * 主词条与副词条「同一条词条但写法不同」的别名。
 *
 * 归档 `init_stats.get_stats()` 的 `头` 部位写的是 `爆伤`（爆 U+7206），
 * 而副词条池里写的是 `暴伤`（暴 U+66B4）—— 游戏里这是同一条词条（暴击伤害）。
 * 主词条概率表只把键当标签用，所以归档里这个不一致没有影响；
 * 但「主词条不能出现在副词条里」这条规则要求把它们认成同一个词条，
 * 否则 `爆伤` 主词条的副词条池会错误地多出 `暴伤`。
 *
 * 注意：**不要**把这个别名塞进 `combo.poolOf`——那会改变 `attrsProb` 的语义，
 * 与 `__fixtures__/baseline.json` 的回归基线冲突。别名只在下面这个辅助函数里生效。
 */
export const MAIN_ATTR_ALIAS: Partial<Record<MainAttr, SubAttr>> = { 爆伤: '暴伤' };

/**
 * 主词条会从副词条池里排除掉的副词条。
 * 主词条不是副词条（元素伤害 / 物伤 / 治疗）时返回 `undefined`。
 */
export function excludedSubstat(mainAttr: MainAttr): SubAttr | undefined {
  if ((SUB_ATTRS as readonly string[]).includes(mainAttr)) return mainAttr as SubAttr;
  return MAIN_ATTR_ALIAS[mainAttr];
}

/**
 * 把主词条规范化为「副词条池里对应的那一条」。
 * 只有 `爆伤` → `暴伤` 这一种情况会变化，其余原样返回。
 */
export function canonicalMainAttr(mainAttr: MainAttr): MainAttr {
  return excludedSubstat(mainAttr) ?? mainAttr;
}

/** 按部位取主词条概率表 */
export function mainProbabilities(position: Position): { attr: MainAttr; p: number }[] {
  const weights = MAIN_WEIGHTS[position];
  const total = Object.values(weights).reduce<number>((s, v) => s + (v ?? 0), 0);
  return Object.entries(weights).map(([attr, w]) => ({
    attr: attr as MainAttr,
    p: (w ?? 0) / total,
  }));
}

/**
 * 各部位「可用的主词条集合」与「主词条概率」。
 *
 * 主词条要按**部位**分开算：沙不会出元素伤害、头不会出充能，
 * 所以「火伤主词条」的概率必须取「杯」那一行的 1/10，而不是把三张表混在一起。
 *
 * 权重表只覆盖各部位**可出现**的条目，因此这里不需要额外过滤。
 */
export function mainAttrsByPosition(): { position: Position; attr: MainAttr; p: number }[] {
  const out: { position: Position; attr: MainAttr; p: number }[] = [];
  for (const position of POSITIONS) {
    for (const { attr, p } of mainProbabilities(position)) out.push({ position, attr, p });
  }
  return out;
}

/**
 * 给定主词条时，该主词条的掉落概率。
 *
 * 「掉落时主词条正好是 X」= `P(掉到能出 X 的某个部位) × P(X | 部位)`。
 * 元素伤害/物伤/治疗只在杯上（`POSITION_PROBABILITY × 1/10`），
 * 大攻击则在沙/杯/头都有可能，三处相加。
 */
export function mainAttrProbability(mainAttr: MainAttr): number | undefined {
  const hits = mainAttrsByPosition().filter((e) => e.attr === mainAttr);
  if (hits.length === 0) return undefined;
  return hits.reduce((s, e) => s + e.p, 0) * POSITION_PROBABILITY;
}

/**
 * 一次掉落里，圣遗物落到**指定部位**的概率。
 *
 * 注意别和 `POSITIONS.length` 混了：`POSITIONS` 只有沙/杯/头三种**类型**
 * （花与羽没有主词条、也没有副词条随机性，不在本项目的模型里），
 * 而一套五星圣遗物有 5 个部位，掉到其中某一个特定部位是 1/5。
 */
export const POSITION_PROBABILITY = 1 / 5;

/** 给定主词条后，它**可能出现的部位**（火伤只会在杯上） */
export function positionsOf(mainAttr: MainAttr): Position[] {
  return POSITIONS.filter((p) => MAIN_WEIGHTS[p][mainAttr] !== undefined);
}

/** 给定主词条后的可用副词条池（权重表） */
export function subPool(mainAttr: MainAttr): { attr: SubAttr; weight: number }[] {
  return SUB_ATTRS.filter((a) => a !== mainAttr).map((attr) => ({
    attr,
    weight: SUB_WEIGHTS[attr],
  }));
}
