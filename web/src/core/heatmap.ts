/**
 * 「主词条 → 副词条」的逐条抽取概率。
 *
 * 对应归档 `init_stats.get_sub_probs()` 与 `plot_substat_heatmap()`，
 * 参考图是 `docs/ai-ref/v1/init_stats/主词条-副词条.png`。
 *
 * ## 口径：**逐条抽取**的概率，不是「4 条里含有它」的概率
 *
 * 副词条是**加权不放回**地一条一条抽出来的：下一条抽到词条 `a` 的概率是
 *
 * ```
 * p = w_a / (Σw − w_主词条 − Σw_已抽走)
 * ```
 *
 * `picked` 为空时就是「第 1 条副词条是它」的概率，与归档 `get_sub_probs()` 同式
 * （那个函数只把主词条的权重从分母里减掉）。**照抄这个口径**是为了让
 * 「悬浮某一格 → 再下一条的分布」能顺着同一个模型往下走一层：
 * 每格都是「下一条」，浮框里给的是「它的下一条」。
 *
 * 与它容易混的是 `combo.attrsProb`：**「胚子含有某词条」是把 4 条都抽完之后看的
 * 边缘概率**（「词条概率」子 tab 那张表），数值大得多（暴击 7.32% vs 47%），
 * 两个口径别互相套用。
 *
 * ## 为什么「其他」也是一行
 *
 * 五行主词条里，只有一部分词条**能**当主词条：花 / 羽 固定（小生命 / 小攻击），
 * 沙 / 杯 / 头 能出的是另外 7 条；小防御只能当副词条。
 * 元素伤害 / 物伤 / 治疗这些只做主词条的词条合成一行「其他」——
 * 它们在抽取模型里完全等价（都不从副词条池里排除任何东西）。
 */

import {
  POSITIONS,
  SLOT_NAMES,
  SUB_ATTRS,
  SUB_WEIGHTS,
  SUB_WEIGHT_SUM,
  canonicalMainAttr,
  excludedSubstat,
  mainProbabilities,
  type MainAttr,
  type SubAttr,
} from './stats';

export interface SubProb {
  attr: SubAttr;
  /** 概率；一行的概率之和恒为 1 */
  p: number;
}

/**
 * 「部位 × 主词条」：已掉到该部位的前提下，这个部位出这个主词条的概率。
 *
 * 与副词条那张热力图是**两个不同的问题**：
 *   - 这张问「掉下来的这件，主词条是什么」（`stats.mainProbabilities`，就是权重占比）；
 *   - 那张问「主词条定了之后，副词条一条条抽出来是什么」。
 * 两张都**不依赖任何配置**（部位与主词条只是表格的维度，不是输入）。
 *
 * 沙 / 杯 / 头 是仅有的三个「主词条可随机」的部位；花 / 羽 的主词条固定
 * （生命值 / 攻击力，概率 1），放进来只是一行全是同一个数，所以不列。
 */

/** 列（可能成为主词条的词条），顺序取「玩家遇到的顺序」：沙 → 杯 → 头 各自新增的那些 */
export const MAIN_ATTR_COLS: readonly string[] = [
  '大生命', '大防御', '大攻击', '充能', '精通', // 沙
  '物伤', '火伤', '雷伤', '岩伤', '风伤', '水伤', '冰伤', '草伤', // 杯
  '暴击', '爆伤', '治疗', // 头
];

export interface MainAttrRow {
  /** 部位（`沙` / `杯` / `头`） */
  key: string;
  label: string;
  /** 该部位**能出**的主词条；不在里面的列就是空格子（该部位不出它） */
  probs: { attr: string; p: number }[];
}

export function mainAttrHeatmap(): MainAttrRow[] {
  return POSITIONS.map((pos) => ({
    key: pos,
    label: SLOT_NAMES[pos],
    // 权重表只覆盖各部位可出现的主词条，所以这里不需要再过滤
    probs: mainProbabilities(pos).map((d) => ({ attr: d.attr as string, p: d.p })),
  }));
}

/** 「其他主词条」那一行的键（元素伤害 / 物伤 / 治疗这类只做主词条的词条） */
export const OTHER_MAIN = '其他';

/** 「其他」代表的主词条：随便取一条不在副词条池里的，抽取模型上完全等价 */
const OTHER_PROBE: MainAttr = '火伤';

/** 一行：某个主词条下，**下一条**副词条各个取值的概率 */
export interface HeatRow {
  /** 稳定标识（= 词条名，或 `OTHER_MAIN`） */
  key: string;
  label: string;
  /** 这一行的主词条；「其他」行为 `undefined` */
  mainAttr: MainAttr | undefined;
  /** 计算用的主词条（「其他」行借用 `火伤`）—— 概率只取决于它是否在副词条池里 */
  probe: MainAttr;
  probs: SubProb[];
}

/**
 * 逐条抽取的下一词条分布。
 *
 * - `picked` 里的词条已被抽走，不再出现；重复项只算一次；
 * - 与主词条同名的那一条**永远不出现**（游戏里主词条与副词条不重复）；
 * - 概率之和恒为 1（`Σw` 减去已抽走的权重后归一）。
 */
export function nextSubstatDist(
  mainAttr: MainAttr,
  picked: readonly SubAttr[] = [],
): SubProb[] {
  const removed = new Set<SubAttr>(picked);
  const main = excludedSubstat(canonicalMainAttr(mainAttr));
  if (main) removed.add(main);

  let rest = SUB_WEIGHT_SUM;
  for (const a of removed) rest -= SUB_WEIGHTS[a];

  const out: SubProb[] = [];
  for (const attr of SUB_ATTRS) {
    if (removed.has(attr)) continue;
    out.push({ attr, p: SUB_WEIGHTS[attr] / rest });
  }
  return out;
}

/**
 * 热力图的**行**：可能成为主词条的词条，按「花 / 羽 → 沙杯头能出的 7 条 → 其他」排。
 *
 * 每行只算一次「下一条」的分布（`picked` 为空），与归档 `get_sub_probs()` 一致。
 */
export function substatHeatmap(): HeatRow[] {
  const defs: { key: string; label: string; mainAttr: MainAttr | undefined }[] = [
    // 花 / 羽的主词条与副词条池同名，行名就用池里的写法（小生命 = 生命值）
    { key: '小生命', label: '小生命', mainAttr: '小生命' },
    { key: '小攻击', label: '小攻击', mainAttr: '小攻击' },
    ...(['大生命', '大防御', '大攻击', '暴击', '暴伤', '充能', '精通'] as const).map((a) => ({
      key: a,
      label: a,
      mainAttr: a as MainAttr,
    })),
    { key: OTHER_MAIN, label: OTHER_MAIN, mainAttr: undefined },
  ];

  return defs.map((d) => {
    const probe = d.mainAttr ?? OTHER_PROBE;
    return { ...d, probe, probs: nextSubstatDist(probe) };
  });
}

/** 当前主词条落在哪一行上；`pooled` 之外（元素伤害等）都归到「其他」 */
export function heatRowKey(mainAttr: MainAttr): string {
  return excludedSubstat(canonicalMainAttr(mainAttr)) ?? OTHER_MAIN;
}
