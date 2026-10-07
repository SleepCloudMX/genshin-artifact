/** 词条枚举与权重表。数值取自归档实现（`docs/ai-ref/v1/init_stats.py`），勿随意改动。 */

/**
 * 圣遗物的五个部位。
 *
 * 前两个（生之花 / 死之羽）**主词条固定**（生命值 / 攻击力），没有随机性，
 * 所以没有主词条概率表；能随机主词条的是后三个。界面上的「部位」下拉按这套写。
 */
export const SLOTS = ['花', '羽', '沙', '杯', '头'] as const;
export type Slot = (typeof SLOTS)[number];

/** 部位全名，界面用 */
export const SLOT_NAMES: Record<Slot, string> = {
  花: '生之花',
  羽: '死之羽',
  沙: '时之沙',
  杯: '空之杯',
  头: '理之冠',
};

/**
 * **主词条可随机**的部位。
 *
 * 花与羽的主词条是固定的，不需要概率表，所以 `MAIN_WEIGHTS` 的键只有这三项。
 * 这个名字保留下来是因为归档与前端一直这么叫。
 */
export const POSITIONS = ['沙', '杯', '头'] as const;
export type Position = (typeof POSITIONS)[number];

/** 该部位的主词条是否随机（花 / 羽固定） */
export function hasRandomMain(slot: Slot): slot is Position {
  return (POSITIONS as readonly string[]).includes(slot);
}

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
 * 副词条的 4 档成长值（**游戏内部值**，两位小数）。
 *
 * 来源：作者 2026-10-07 提供的成长值表（截图 `temp/sleepcloud/10.07/1.png`，temp 不入库）。
 * 归档 `src/artifact_growth` 用的是**游戏内显示值**（只到一位小数：暴伤 5.4/6.2/7.0/7.8），
 * 累加会系统性偏高——暴伤满档 6 次：7.77 × 6 = 46.62，游戏显示 46.6；用 7.8 会算成 46.8。
 *
 * 这仍**不是**最精确的值：官方只给到两位小数，真值可能还有更低位。
 * 界面上的「成长值」子 tab 会把这张表原样列出来，好让分数可核对。
 *
 * 注意 小生命/小防御 保留原始量纲（209.13 而不是 2.0913）：权重自己带量纲换算，
 * 先除以 100 再做乘法会平白引入小数。
 */
export const GROWTHS: Record<SubAttr, readonly [number, number, number, number]> = {
  暴击: [2.72, 3.11, 3.5, 3.89],
  暴伤: [5.44, 6.22, 6.99, 7.77],
  大攻击: [4.08, 4.66, 5.25, 5.83],
  小攻击: [13.62, 15.56, 17.51, 19.45],
  精通: [16.32, 18.65, 20.98, 23.31],
  充能: [4.53, 5.18, 5.83, 6.48],
  大生命: [4.08, 4.66, 5.25, 5.83],
  小生命: [209.13, 239, 268.88, 298.75],
  大防御: [5.1, 5.83, 6.56, 7.29],
  小防御: [16.2, 18.52, 20.83, 23.15],
};

/**
 * 成长值表的**展示顺序**（界面「成长值」子 tab 按它列）。
 *
 * 与 `SUB_ATTRS` 不同：那个是副词条池的权重顺序（小生命、小攻击在前），
 * 这里按玩家实际关注的顺序排，与游戏内「详细属性」面板一致。
 */
export const GROWTH_ORDER: readonly SubAttr[] = [
  '暴击', '暴伤', '大攻击', '小攻击', '精通',
  '充能', '大防御', '小防御', '大生命', '小生命',
];

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
 * 给定部位时的主词条概率；不合法的组合返回 `undefined`。
 *
 * 「空之杯出火伤」= 200/4000 = **5%**。注意这是**条件概率**（前提是已经掉到了杯），
 * 不要再乘「掉到杯」的概率——部位是刷本时的既定前提，不是随机项。
 */
export function mainProbAt(position: Position, mainAttr: MainAttr): number | undefined {
  const weights = MAIN_WEIGHTS[position];
  const w = weights[mainAttr];
  if (w === undefined) return undefined;
  const total = Object.values(weights).reduce<number>((s, v) => s + (v ?? 0), 0);
  return w / total;
}

/** 该部位可选的主词条（按权重降序）。花 / 羽的主词条固定，返回空数组 */
export function mainAttrsOf(slot: Slot): MainAttr[] {
  if (!hasRandomMain(slot)) return [];
  return Object.entries(MAIN_WEIGHTS[slot])
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([attr]) => attr as MainAttr);
}

/** 给定部位时，哪些副词条不能出现（主词条自己） */
export function excludedAt(slot: Slot, mainAttr: MainAttr): SubAttr | undefined {
  // 花 / 羽的主词条是生命值 / 攻击力这种固定值，与副词条池不冲突
  if (!hasRandomMain(slot)) return undefined;
  return excludedSubstat(mainAttr);
}

/** 给定主词条后的可用副词条池（权重表） */
export function subPool(mainAttr: MainAttr): { attr: SubAttr; weight: number }[] {
  return SUB_ATTRS.filter((a) => a !== mainAttr).map((attr) => ({
    attr,
    weight: SUB_WEIGHTS[attr],
  }));
}
