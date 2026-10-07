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
export const MAIN_FIXED_HINT =
  '生之花固定生命值（= 副词条里的小生命）、死之羽固定攻击力（= 小攻击），只有这一种。';
/**
 * 换了部位之后，原主词条在新部位不合法。
 *
 * 界面**不替用户挑**（作者明说「待用户重新选择」）：下拉标成浅红、值原样留着，
 * 主词条概率会诚实算成 0（`DROP_OUT_OF_RANGE`）。
 */
export const MAIN_INVALID_HINT = '该部位不出这个词条，请重新选择。';

export const SECT_SUBSTATS = '副词条';
/** 「初始档位」列存在时（得分分布页） */
export const SUBSTATS_HINT_ROLL =
  '「初始档位」= 掉落时那一次成长的档位，固定它可算上下界。';
/**
 * 「胚子质量」页的副词条说明。
 *
 * 这一页与「得分分布」的差别是**条数不限**：那边是 4 个槽位（胚子终态就是 4 条），
 * 这边只统计「这些词条长在胚子上的情况」。权重就是分数，**不乘成长值**。
 *
 * 表格是一份用户自己增删的清单，所以要把三件事交代清楚：怎么加、怎么删、按什么排。
 */
export const QUALITY_WEIGHTS_HINT =
  '权重即得分，不乘成长值；按权重从高到低排列，+ 在末尾追加一行、× 删除该行。';
export const ADD_ATTR = '+ 添加词条';
export const ADD_ATTR_TITLE = '在末尾追加一行（词条待选）';
export const ADD_ATTR_NONE = '副词条已全部列出';
/** 每行末尾那个叉号 */
export const ARIA_ROW_DELETE = '删除这一行';

export const COL_ATTR = '词条';
export const COL_WEIGHT = '权重';
export const COL_ROLL = '初始档位';

/** 词条下拉里的空选项：这个词条位置不计分 */
export const NOT_SCORED = '（不计分）';

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
// 主 tab（界面上一级任务；侧边栏里那一层，正文顶上那个小标题也是它）
// ---------------------------------------------------------------------------

export const TAB_GROWTH = '得分分布';
export const TAB_QUALITY = '胚子质量';
export const TAB_MORE = '更多';

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
/** 「主词条 · 副词条」：部位 × 主词条、主词条 × 副词条两张概率表（都与配置无关） */
export const SUB_MAIN_SUB = '主词条 · 副词条';

/** 第一张：部位 × 主词条的二维概率表 */
export const MAIN_PROB_TITLE = '各部位的主词条概率';
/**
 * 主词条概率是**条件**概率（前提是已经掉到了这个部位，与「该部位的胚子概率」同一口径）；
 * 空格子是「该部位不出这个词条」，不是 0%。
 */
export const MAIN_PROB_HINT =
  '已掉到该部位的前提下，出这个主词条的概率；空格子 = 该部位不出它。';
export const MAIN_PROB_ROW_AXIS = '部位';
export const MAIN_PROB_COL_AXIS = '主词条';
export const HEAT_TITLE = '给定主词条的副词条概率';
/**
 * 热力图的口径。
 *
 * 三件事图上读不出来：
 *   1. 格子里是**「下一条」**（不是「4 条里含有它」，那个数大得多，在「词条概率」子 tab 里）；
 *   2. 前两行是花 / 羽 固定的主词条（行名用的是副词条池里的写法）；
 *   3. 「其他」那一行是什么。
 */
export const HEAT_HINT =
  '格 = 下一条副词条是该词条的概率；悬停看再下一条的分布。' +
  '小生命 / 小攻击 两行是生之花 / 死之羽 固定的主词条；' +
  '「其他」= 元素伤害 / 物伤 / 治疗这类只做主词条的词条。';
export const HEAT_ROW_AXIS = '主词条';
export const HEAT_COL_AXIS = '副词条';
/** 浮框里那组横条：它是「再下一条」的条件分布，而且条长按本组最大值折算过 */
export const HEAT_NEXT_CAPTION = '再下一条的概率（已抽走该词条，条长按本组最大值折算）';

/** 分桶：柱数太多时把相邻分数并成一根柱子 */
export const BUCKET_LABEL = '分桶';
export const BUCKET_NONE = '不分桶';
export function bucketSizeLabel(size: number): string {
  return size <= 0.1 ? BUCKET_NONE : String(size);
}


// ---------------------------------------------------------------------------
// 指标卡
// ---------------------------------------------------------------------------

/**
 * 「达到概率」这张卡：标签里直接带上目标分数（作者要求「胚子 {目标分数} 分概率」）。
 *
 * 卡片里不再重复那个数字，`CARD_REACH_NOTE` 只交代口径是「≥」而不是「=」。
 */
export function cardReach(target: string): string {
  return `胚子 ${target} 分概率`;
}
export const CARD_REACH_NOTE = '得分 ≥ 该分数';

/** 前 10% 分数：P(得分 ≥ 该分数) ≤ 10% 的那条分数线 */
export const CARD_TOP10 = '前 10% 分数';
export const CARD_TOP10_NOTE = '得分 ≥ 该分数的概率 ≤ 10%';

/** 该部位的胚子概率：不含成长值，只回答「能不能刷到这件胚子」 */
export const CARD_DROP = '该部位的胚子概率';
export function dropBreakdown(main: string, subs: string): string {
  return `主词条 ${main} × 副词条 ${subs}`;
}
/** 主词条不在该部位的表里（切到别的部位后还没重选主词条时就是这个状态） */
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

/**
 * 柱内按组合拆开的那张图。
 *
 * 要交代三件图上读不出来的事：
 *   1. **段色只在一根柱子内有意义**（这正是它与参考实现的差别所在）；
 *   2. 红线是累计概率，读右轴；
 *   3. 勾选框是「同时含这几条」而不是「含其中任意一条」。
 */
export const QUALITY_DIST_HINT =
  '仅统计掉落瞬间的 4 个副词条，不含强化成长。柱内按组合拆开，颜色只区分同一根柱子里' +
  '的段；红线为累计概率（右轴）。';
/** 画不画累计概率曲线的勾选框 */
export const CUM_SERIES = '累计概率';
/** 图内右上角的标注：勾选了哪几条、这些胚子占多少 */
export function pickedLabel(attrs: readonly string[]): string {
  // 词条多了会顶到画布边上，改用条数交代（勾选框就在图上方，不用在图里再列一遍）
  return attrs.length <= 3 ? `含 ${attrs.join(' + ')}` : `含勾选的 ${attrs.length} 条`;
}
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
  '3 / 4 词条混合掉落（比例可配）',
  '图表导出 PNG / SVG',
];

export const CALC_FAILED = '计算失败：';
