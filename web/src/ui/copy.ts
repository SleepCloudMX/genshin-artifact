/**
 * 界面全部文案。
 *
 * 集中放一处是为了两件事：
 *   1. 风格统一 —— **言简意赅、术语直说**。不解释常识、不用「我有多大几率」这类口水话、
 *      不加语气词。界面不是教程，用户是来算概率的。
 *   2. 便于整体审阅与修改，不用在 DOM 装配代码里翻找字符串。
 *
 * 约定：说明性文字（`*_HINT`）只写「这里和默认理解不一样的地方」，
 * 能从轴标题、表头、单位看出来的，一律不写。
 */

export const APP_TITLE = '圣遗物词条概率分布';

/** 一句话定位。只保留必要信息，去掉「不是 X 而是 Y」这种修辞 */
export const APP_LEDE = '计算胚子练满 +20 后的得分分布，以及掉落时的胚子质量。';

export const THEME_TO_LIGHT = '切换到浅色主题';
export const THEME_TO_DARK = '切换到深色主题';

/** 源码仓库。放在标题行右侧，与主题按钮并排 */
export const REPO_URL = 'https://github.com/SleepCloudMX/genshin-artifact';
export const REPO_LINK = '源代码';

// ---------------------------------------------------------------------------
// 配置区
// ---------------------------------------------------------------------------

export const CONFIG = '配置';
export const RESET = '重置';
export const RESET_TITLE = '恢复默认配置';

export const FIELD_SLOT = '部位';
export const FIELD_MAIN = '主词条';
export const FIELD_INITIAL = '初始';

/** 花 / 羽的主词条固定，没有可选项 */
export const MAIN_FIXED = '固定';
export const MAIN_FIXED_HINT = '生之花与死之羽的主词条固定，没有可选项。';

export const SECT_SUBSTATS = '副词条';
/** 「初始档位」列不存在时（胚子质量页）不显示这段 */
export const SUBSTATS_HINT_ROLL =
  '「初始档位」= 掉落时那一次成长的档位，固定它可算上下界。';
export const SUBSTATS_HINT_NOROLL = '只统计权重大于 0 的词条。';

export const COL_ATTR = '词条';
export const COL_WEIGHT = '权重';
export const COL_ROLL = '初始档位';

export const ROLL_RANDOM = '随机';
export function rollFixed(tier: number): string {
  return `第 ${tier + 1} 档`;
}

export const FIELD_TARGET = '目标分数';

export const ARIA_WEIGHT_UP = '增大权重';
export const ARIA_WEIGHT_DOWN = '减小权重';
export function ariaWeightOf(attr: string, index: number): string {
  return `${attr || `第 ${index + 1} 条`}的权重`;
}
export function ignoredNote(attrs: string[]): string {
  return attrs.length > 0 ? `已忽略权重非法的词条：${attrs.join('、')}` : '';
}

// ---------------------------------------------------------------------------
// 主 tab
// ---------------------------------------------------------------------------

export const TAB_GROWTH = '得分分布';
export const TAB_QUALITY = '胚子质量';
export const TAB_MORE = '更多';

export const GROWTH_BLURB = '练满 +20 后的得分分布（含 5 次成长）。';
export const QUALITY_BLURB = '掉落时、未强化的得分分布（不含成长）。';

// ---------------------------------------------------------------------------
// 子 tab
// ---------------------------------------------------------------------------

export const SUB_DIST = '概率分布';
export const SUB_SURVIVAL = '达到概率';
export const SUB_HITS = '命中次数';
export const SUB_QUANTILE = '分位分数线';
export const SUB_GROWTHS = '成长值';
export const SUB_QUALITY_DIST = '质量分布';
export const SUB_COMBOS = '组合概率';
export const SUB_ATTRS = '词条概率';

/** 分桶：柱数太多时把相邻分数并成一根柱子 */
export const BUCKET_LABEL = '分桶';
export const BUCKET_NONE = '不分桶';
export function bucketSizeLabel(size: number): string {
  return size <= 0.1 ? BUCKET_NONE : String(size);
}


// ---------------------------------------------------------------------------
// 指标卡
// ---------------------------------------------------------------------------

export const CARD_REACH = '达到概率';
export function reachNote(target: string): string {
  return `得分 ≥ ${target}`;
}
export const CARD_ATTEMPTS = '大致要刷';
export const CARD_ATTEMPTS_NOTE = '按 1/p 估算，单位「个胚子」';
export const CARD_BEST = '最高可能分';
export function scoredSlotsNote(n: number): string {
  return `计分槽位 ${n}/4`;
}

/** 掉落概率：不含成长值，只回答「能不能刷到这件胚子」 */
export const CARD_DROP = '掉落概率';
export function dropBreakdown(main: string, subs: string): string {
  return `主词条 ${main} × 副词条 ${subs}`;
}
/** 主词条不在该部位的表里（正常操作到不了） */
export const DROP_OUT_OF_RANGE = '该部位没有这个主词条';

// ---------------------------------------------------------------------------
// 成长值表（左栏小表 + 「成长值」子 tab）—— 数值口径只有这一处说明
// ---------------------------------------------------------------------------

export const GROWTH_TABLE_TITLE = '成长值';
/**
 * 成长值的口径。**不要说成「游戏内部值」**：那两个小数本身就是四舍五入的结果，
 * 游戏内的精确值我们不知道。也不要写「已四舍五入」这类主动语态 ——
 * 那会把「我们只有这个精度」说成「我们砍了精度」。
 *
 * 左栏小表窄，只放第一句；「成长值」子 tab 有位置，把总分差 0.1 也交代清楚。
 */
export const GROWTHS_HINT = '成长值四舍五入到两位小数，不是游戏内的精确值。';
export const SUB_GROWTHS_HINT =
  `全部副词条的成长值，得分 = Σ(成长值 × 权重)。${GROWTHS_HINT}` +
  '游戏内只显示到一位小数，故总分可能有 0.1 的出入。';
export const TH_GROWTH_ATTR = '词条';
export const TH_GROWTH_TIERS = ['一档', '二档', '三档', '四档'] as const;
export const GROWTH_TABLE_EMPTY = '还没有计分词条。';

export const CARD_ATTRS = '有效词条';
export const CARD_MEAN = '期望得分';
export const CARD_MEAN_NOTE = '掉落时，非练满后';
export const CARD_BEST_DROP = '最高可能分';
export const CARD_BEST_DROP_NOTE = '有效词条全部命中';
export const CARD_MODE = '最常见组合';

// ---------------------------------------------------------------------------
// 图与表
// ---------------------------------------------------------------------------

export function scoreChartTitle(mainAttr: string, initial: number): string {
  return `${mainAttr}主词条 · ${initial} 词条胚子`;
}
export const SCORE_CHART_HINT = '柱高 = 该分数的概率；颜色 = 命中的有效词条次数。悬停看明细。';
export const AXIS_SCORE = '得分（分）';
export const AXIS_SCORE_LINE = '分数线（分）';
export const SURVIVAL_TITLE = 'P(得分 ≥ 分数线)';
export const SURVIVAL_HINT = '纵轴为独立 0~100%，不与上图共用比例。';
/** 浮框里那组横条的口径：它是条件分布，不是无条件概率 */
export const HIT_MIX_CAPTION = '仅统计 ≥ 该分数的结果（合计 100%）';
export const HIT_CHART_TITLE = '各命中档的概率';

/** 参考线标注：`30.0 分` / `p = 11.66%` */
export function markerScore(score: string): string {
  return `${score} 分`;
}
export function markerProb(p: string): string {
  return `p = ${p}`;
}
/** 命中档的显示名，如 `命中 2 次`。命中次数是整数台阶，界面各处共用 */
export function hitLabel(hits: number): string {
  return `命中 ${hits} 次`;
}
export function sameScoreCombos(n: number): string {
  return `${n} 种组合同分`;
}

export const QUANTILE_HINT = 'α =「不低于该分数线」的概率。';
export const TH_HITS = '命中有效词条';
export const TH_PROB = '概率';
export const TH_ATTEMPTS = '大致要刷';
export const TH_ALPHA = '目标概率 α';
export const TH_LINE = '分数线';
export const QUANTILE_OUT_OF_RANGE = '超出可能范围';
export function topPercent(alpha: number): string {
  return `前 ${alpha * 100}%`;
}

export const QUALITY_DIST_HINT = '仅统计掉落瞬间的 4 个副词条，不含强化成长。';
export const COMBOS_HINT = '概率过小的长尾合并为「其他」。';
export const ATTRS_HINT = '「胚子含该词条」的概率；词条不重复，故不等于权重占比。';
export const TH_ATTR = '词条';
export const TH_ATTR_PROB = '出现概率';
export const TH_WEIGHT = '权重';
export const TH_ATTR_ATTEMPTS = '大致要刷';

export function qualityNote(mainAttr: string, dropped: string | undefined, attrCount: number): string {
  const parts = [`主词条 ${mainAttr}`];
  if (dropped) parts.push(`「${dropped}」不再出现在副词条`);
  if (attrCount === 0) parts.push('未填写计分词条');
  return parts.join(' · ');
}

export const MORE_TITLE = '待做';
export const MORE_ITEMS: readonly string[] = [
  '主词条 → 副词条热力图（数据已备好）',
  '3 / 4 词条混合掉落（比例可配）',
  '图表导出 PNG / SVG',
];

export const CALC_FAILED = '计算失败：';
