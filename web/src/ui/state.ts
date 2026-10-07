import {
  MAIN_ATTRS,
  SLOTS,
  SUB_ATTRS,
  excludedSubstat,
  excludedAt,
  mainAttrsOf,
  type MainAttr,
  type Slot as ArtifactSlot,
  type SubAttr,
} from '../core/stats';
import {
  isBucketSize,
  isInitialRoll,
  type ArtifactSpec,
  type InitialRoll,
  type InitialVisible,
  type Slot,
} from '../core/growth';

/**
 * 一个副词条的配置。
 *
 * 界面上是「词条 / 权重 / 初始档位」的一张表，而计算需要「4 个有序槽位」，
 * 两者之间用 `toSpec` 转换：权重 > 0 的词条按固定顺序占槽位。
 * 这样界面可以随时增删词条（不会因为槽位对不上而出现空洞），
 * 也避免了「同一个词条被选两次」这种非法状态。
 */
export interface SlotInput {
  /** 该槽位的词条；未选时为空串 */
  attr: SubAttr | '';
  /** 计分权重；0 表示「已知但不计分」 */
  weight: number;
  /** 掉落那一次的档位；`'random'` = 四档等概率 */
  initialRoll: InitialRoll;
}

export type Slots = [SlotInput, SlotInput, SlotInput, SlotInput];

/**
 * 配置分成三块，因为**不同任务需要的配置不同**：
 *
 * - `SharedConfig`：所有任务都要的（部位、主词条、配色）。
 * - `GrowthConfig`：**只属于「得分分布」**的（4 个槽位、初始词条数、目标分数、分桶）。
 * - `QualityConfig`：**只属于「胚子质量」**的（每条副词条的评分权重）。
 *
 * 加新任务时先问一句：这个配置是「所有任务都要的」还是「这个任务特有的输入」？
 */
export interface SharedConfig {
  /** 刷的是哪个部位。它决定主词条的可选项，也决定主词条概率 */
  slot: ArtifactSlot;
  mainAttr: MainAttr;
  theme: 'light' | 'dark';
}

export interface GrowthConfig {
  /**
   * 4 个副词条槽位。**只有「得分分布」需要它**：
   * 那个模型里胚子终态就是 4 条副词条，槽位顺序还有语义（见 `core/growth.ts`），
   * 所以必须是定长 4 个、每个槽位带「初始档位」。
   */
  slots: Slots;
  /** 掉落时可见几个副词条 */
  initialVisible: InitialVisible;
  /** 目标分数（用于「要刷多少个」） */
  targetScore: number;
  /**
   * 得分分布图的分桶宽度（分）。`0.1` = 不合并；**默认 `0.2`**。
   *
   * 与权重不同，这个值**不做自动挑选**：自动挑的档会随输入悄悄变，
   * 看起来还是同一个视图，比例尺却换了。默认值在 `defaultGrowth` 里写死，
   * 用户改了就用用户的，并写进 URL。
   */
  bucketSize: number;
}

/**
 * 「胚子质量」词条表的一行。
 *
 * `attr` 为空 = **这一行还没选词条**（「+ 添加词条」刚加出来的样子）：
 * 它留在表里等用户选，但**不参与绘图**（`qualityWeights` 会忽略它）。
 */
export interface QualityRow {
  attr: SubAttr | '';
  /** 计分权重（分）。`0` 或空行都不计分，但行本身仍在表里 */
  weight: number;
}

/**
 * 「胚子质量」的评分标准：**每条副词条一个权重，条数不限**。
 *
 * 与「得分分布」的 4 个槽位是两件事：
 *   - 那边必须有 4 个槽位（胚子终态就是 4 条副词条），槽位顺序还有语义；
 *   - 这边只回答「这条词条长在胚子上算几分」，只关心 1 条可以、关心 10 条也可以。
 *
 * 权重是**分**，**不乘成长值** —— 胚子质量看的是掉落那一刻拥有哪些词条，
 * 与强化无关（见 `core/quality.ts`）。
 *
 * ## 为什么存「行的列表」而不是「词条 → 权重」的表
 *
 * 界面上这张表是**用户自己增删的一份清单**：能加一行还没选词条的空行、能按 × 删掉任意一行、
 * 显示顺序按权重降序。这些都不是「一个映射」能表达的 —— 映射里没有空行、没有顺序，
 * 也分不清「用户删了这一行」和「这一行权重是 0」。
 * 喂给 core 的形状（词条 → 权重）由 `qualityWeights()` 现算，两边各司其职。
 */
export interface QualityConfig {
  /** 词条表的行，**按用户添加的顺序**存；显示顺序由 `qualityRowsInView()` 定 */
  rows: QualityRow[];
}

export interface AppState extends SharedConfig, GrowthConfig, QualityConfig {}

/** 槽位的固定填充顺序，决定「哪条占第 1 个槽位」——影响 3 词条胚子的建模 */
export const SLOT_ORDER: readonly SubAttr[] = SUB_ATTRS;

/**
 * 各副词条的**默认计分权重**。
 *
 * 口径来自社区常用的「双暴 2:1」：一条暴击的收益约等于两条暴伤，
 * 所以暴击 2、暴伤 1；**其余词条默认 0**（不计分）。
 *
 * 这个表有两处用途，改它要同时想到：
 *   1. `defaultShared()` 的初始值；
 *   2. 权重 `+` / `−` 按钮的落点——`+` 从 0 跳到该词条的默认权重，
 *      `−` 从默认权重减到 0（见 `nextWeightUp` / `nextWeightDown`）。
 *      所以「选暴击后权重自动是 2」是自然结果，不需要额外特判。
 */
export const CANONICAL_WEIGHT: Record<SubAttr, number> = {
  小生命: 0, 小攻击: 0, 小防御: 0,
  大生命: 0, 大防御: 0, 大攻击: 0,
  暴击: 2, 暴伤: 1,
  充能: 0, 精通: 0,
};

/** 权重步长 */
export const WEIGHT_STEP = 0.1;

/**
 * 「胚子质量」的默认评分口径：暴击 3 / 暴伤 3 / 精通 2 / 大攻击 2。
 *
 * 与 `CANONICAL_WEIGHT` 是**两套**：那边是「得分分布」的成长权重（暴击 2 / 暴伤 1，
 * 表示一条暴击的收益约等于两条暴伤），这边是胚子质量的**分数**，
 * 口径来自 `docs/ai-ref/v1/init_stats.py` 的示例配置。**两边不要互相套用。**
 */
export const QUALITY_WEIGHT: Record<SubAttr, number> = {
  小生命: 0, 小攻击: 0, 小防御: 0,
  大生命: 0, 大防御: 0, 大攻击: 2,
  暴击: 3, 暴伤: 3, 充能: 0, 精通: 2,
};

/**
 * 从 0 起步时 `+` 落到哪里。
 *
 * 有默认权重的词条落到默认值（暴击一次到 3）；其余词条落到 1 ——
 * 它们是「临时想给点分」才加上的，用 1 当起点比 0.1 合理得多。
 */
export function stepStart(canonical: number): number {
  return canonical > 0 ? canonical : 1;
}

/** 浮点加减后归整到两位小数，避免 `0.1` 反复累加攒出 `0.30000000000000004` */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * 权重的**唯一精度口径**：两位小数、非负。
 *
 * 输入框允许随便填（0.25 / .5 / 1.005），但进 state 之前一律归整到两位小数：
 * `core/growth.ts` 把权重放大 100 倍成整数再乘成长值，多出来的位会被静默丢掉。
 * 先归整，「界面上显示的值」与「真正参与运算的值」就永远是同一个。
 * 归整后为 0 的（如 0.001）等同不计分，这与 `toSpec` 的「权重 > 0 才计分」一致。
 */
export function quantizeWeight(w: number): number {
  return Number.isFinite(w) ? Math.max(0, round2(w)) : 0;
}

/**
 * `+` 的下一档：当前为 0 时直接落到 `canonical`（暴击一次到 3），否则按步长递加。
 * 这样「加一个词条」是一次点击，而不是点二十下。
 *
 * `canonical` 由调用方给：两张权重表（成长 / 胚子质量）各有各的默认口径。
 */
export function nextWeightUp(weight: number, canonical: number): number {
  if (!(weight > 0)) return stepStart(canonical);
  return round2(weight + WEIGHT_STEP);
}

/**
 * `−` 的下一档：正好停在默认权重时直接归零（暴击 3 → 0），否则按步长递减。
 * 归零这一下是刻意的——默认权重往往是最常用的口径，再往下按通常就是「不要它了」。
 */
export function nextWeightDown(weight: number, canonical: number): number {
  if (!(weight > 0)) return 0;
  if (canonical > 0 && Math.abs(weight - canonical) < 1e-9) return 0;
  return Math.max(0, round2(weight - WEIGHT_STEP));
}

/** 选中某词条时的权重初值：有默认口径就用它，否则用 1 */
export function weightOnSelect(attr: SubAttr | ''): number {
  if (attr === '') return 0;
  return CANONICAL_WEIGHT[attr] || 1;
}

/**
 * 「胚子质量」权重表的步长。
 *
 * 比成长表（0.1）粗：这里的权重是**分数**（3 / 2 / 1 这种量级），
 * 0.1 一档要按十下才从 1 到 0（作者点过这个毛病），0.5 一档两下就到。
 * 要更细的值直接在框里输入 —— 输入仍然支持两位小数。
 */
export const QUALITY_WEIGHT_STEP = 0.5;

/** 按固定步长增减，**下限 0、不跳档、不删除行**（删除只走 × 按钮） */
export function stepQualityWeight(weight: number, delta: number): number {
  return Math.max(0, round2((weight > 0 ? weight : 0) + delta * QUALITY_WEIGHT_STEP));
}

/**
 * 「胚子质量」表里选中某词条时的权重初值。
 *
 * 与 `weightOnSelect` 同一套规则（有默认口径就用默认，否则 1），只是换用
 * `QUALITY_WEIGHT` 这张表 —— 默认口径让「加一条暴击」不必手打 3。
 */
export function qualityWeightOnSelect(attr: SubAttr): number {
  return stepStart(QUALITY_WEIGHT[attr]);
}

/**
 * 词条表的**显示顺序**：权重高的在前，权重相同的保持用户添加的先后
 * （所以排序是稳定的），**空行一律垫底**（刚按 + 加出来的那一行总在最后）。
 *
 * 不修改原数组：state 里存的是用户的添加顺序，换回来还能复原。
 */
export function qualityRowsInView(rows: readonly QualityRow[]): QualityRow[] {
  const filled = rows.filter((r) => r.attr !== '');
  const empty = rows.filter((r) => r.attr === '');
  // Array.prototype.sort 是稳定的：权重相同的两行不会互换
  return [...filled.sort((a, b) => b.weight - a.weight), ...empty];
}

/** 词条表里已经用掉的词条（用于把下拉里重复的选项灰掉） */
export function qualityUsedAttrs(rows: readonly QualityRow[]): SubAttr[] {
  return rows.map((r) => r.attr).filter((a): a is SubAttr => a !== '');
}

/**
 * 喂给 `core/quality.ts` 的形状：词条 → 权重。
 *
 * 空行与权重 0 的行都在这里被忽略（作者要求：空行「此时绘图时忽略这一项」）；
 * 同一个词条只可能出现在一行里（下拉里重复的选项是灰的），所以不用担心覆盖。
 */
export function qualityWeights(state: QualityConfig): Partial<Record<SubAttr, number>> {
  const out: Partial<Record<SubAttr, number>> = {};
  for (const { attr, weight } of state.rows) {
    if (attr === '') continue;
    const w = quantizeWeight(weight);
    if (w > 0) out[attr] = w;
  }
  return out;
}

/**
 * 默认配置（所有任务共用的那半）。
 *
 * - 部位 `杯` + 主词条 `火伤`：火伤不在副词条池里，**副词条可选集是完整的**——
 *   用 `大攻击` 之类的当默认值会白白少一个选项，让人以为漏了东西。
 */
export function defaultShared(): SharedConfig {
  return { slot: '杯', mainAttr: '火伤', theme: 'light' };
}

/**
 * 「得分分布」的默认输入。
 *
 * 副词条只有 `暴击 2` / `暴伤 1`（社区常用的双暴 2:1），后两个槽位留空。
 * 摆着权重 0 的词条会让「计分槽位 2/4」和看起来有 4 条的表格自相矛盾。
 */
export function defaultGrowth(): GrowthConfig {
  return {
    slots: [
      { attr: '暴击', weight: CANONICAL_WEIGHT['暴击'], initialRoll: 'random' },
      { attr: '暴伤', weight: CANONICAL_WEIGHT['暴伤'], initialRoll: 'random' },
      { attr: '', weight: 0, initialRoll: 'random' },
      { attr: '', weight: 0, initialRoll: 'random' },
    ],
    // 分桶默认 0.2 分：0.1 在默认配置下有一百多根柱子，糊成一片
    initialVisible: 4,
    targetScore: 30,
    bucketSize: 0.2,
  };
}

/**
 * 「胚子质量」的默认输入：暴击 3 / 暴伤 3 / 精通 2 / 大攻击 2（其余不列）。
 *
 * 列表顺序就是权重降序、同权重按 `SUB_ATTRS` 序，所以**表格一打开就是它该有的样子**
 * （表按权重降序排，同权重保持列表顺序）。
 */
export function defaultQuality(): QualityConfig {
  const rows: QualityRow[] = SUB_ATTRS.filter((a) => QUALITY_WEIGHT[a] > 0).map((attr) => ({
    attr,
    weight: QUALITY_WEIGHT[attr],
  }));
  const order = (a: SubAttr): number => SUB_ATTRS.indexOf(a);
  rows.sort((a, b) => b.weight - a.weight || order(a.attr as SubAttr) - order(b.attr as SubAttr));
  return { rows };
}

/** 完整默认状态（三个 tab 的配置合起来） */
export function defaultState(): AppState {
  return { ...defaultShared(), ...defaultGrowth(), ...defaultQuality() };
}

// ---------------------------------------------------------------------------
// 界面状态 → 计算输入
// ---------------------------------------------------------------------------

/** 该词条是否因为「与主词条同一条」而不能作为副词条 */
export function isExcludedByMain(main: MainAttr, attr: SubAttr | ''): boolean {
  if (attr === '') return false;
  return excludedSubstat(main) === attr;
}

/** 当前可选的副词条（主词条不能同时是副词条，含 `爆伤` / `暴伤` 这种别名） */
export function selectableAttrs(main: MainAttr): SubAttr[] {
  const excluded = excludedSubstat(main);
  return SUB_ATTRS.filter((a) => a !== excluded);
}

export interface SpecResult {
  spec: ArtifactSpec;
  /** 权重非法（负数 / 非数字）而被忽略的词条 */
  ignored: SubAttr[];
  /** 参与计分的词条数 */
  scoredCount: number;
}

/**
 * 把界面状态转成计算输入。
 *
 * - 权重 > 0 的词条按 `SLOT_ORDER` 依次填进槽位；不足 4 个时剩下的槽位权重为 0
 *   （对应「这个词条不可能出现 / 出现了也不计分」，正好是 3 词条胚子第 4 条的语义）。
 * - 权重先归整到两位小数（`quantizeWeight`），再判 > 0。
 * - 权重非法时**忽略该词条**而不是抛错：输入框可能正处在中间状态（空串、`-`）。
 */
export function toSpec(state: SharedConfig & GrowthConfig): SpecResult {
  const excluded = excludedAt(state.slot, state.mainAttr);
  const ignored: SubAttr[] = [];
  const usable: { attr: SubAttr; weight: number; initialRoll: InitialRoll }[] = [];

  for (const { attr, weight, initialRoll } of state.slots) {
    if (attr === '') continue;
    if (attr === excluded) {
      ignored.push(attr);
      continue;
    }
    if (!Number.isFinite(weight)) {
      ignored.push(attr);
      continue;
    }
    const w = quantizeWeight(weight);
    if (w <= 0) continue;
    usable.push({ attr, weight: w, initialRoll });
  }

  usable.sort((a, b) => SLOT_ORDER.indexOf(a.attr) - SLOT_ORDER.indexOf(b.attr));

  const slots: Slot[] = [0, 1, 2, 3].map((i) => {
    const u = usable[i];
    // 空槽位必须给一个合法词条名；权重 0 时它对得分没有影响
    return u
      ? { attr: u.attr, weight: u.weight, initialRoll: u.initialRoll }
      : { attr: SLOT_ORDER[9]!, weight: 0, initialRoll: 'random' as const };
  });

  return {
    spec: {
      slots: slots as unknown as ArtifactSpec['slots'],
      initialVisible: state.initialVisible,
    },
    ignored,
    scoredCount: usable.length,
  };
}

/** 「得分分布」的「词条 → 权重」映射：从 4 个槽位里取权重 > 0 的条目 */
export function growthWeights(state: GrowthConfig): Partial<Record<SubAttr, number>> {
  const out: Partial<Record<SubAttr, number>> = {};
  for (const { attr, weight } of state.slots) {
    if (attr === '') continue;
    const w = quantizeWeight(weight);
    if (w > 0) out[attr] = w;
  }
  return out;
}

// ---------------------------------------------------------------------------
// URL 序列化：配置可以靠链接分享
// ---------------------------------------------------------------------------

/** 一个槽位在 query 里的写法：`词条:权重:档位`，`词条` 为空则整体省略 */
function encodeSlot(s: SlotInput): string {
  // 权重已归整到两位小数，`String` 不会再出现 0.30000000000000004 这类值
  return `${s.attr}:${quantizeWeight(s.weight)}:${s.initialRoll}`;
}

/**
 * 胚子质量词条表在 query 里的写法：`暴击:3,暴伤:3,精通:2`。
 *
 * 按**用户添加的顺序**输出（同一个配置永远得到同一个串，便于 diff 分享链接），
 * 权重 0 的行也照写（表上看得见它，链接就该还原出同一张表）。
 * **空行不写**：它还没选词条、不参与计算，写进链接只是噪音。
 * 空串是合法状态（表里一行都没有），与「没写过这个参数」不同。
 */
function encodeQuality(rows: readonly QualityRow[]): string {
  return rows
    .filter((r) => r.attr !== '')
    .map((r) => `${r.attr}:${quantizeWeight(r.weight)}`)
    .join(',');
}

/** 解析胚子质量的词条表；`raw === null`（老链接没带这个参数）时用默认口径 */
function decodeQuality(raw: string | null, fallback: QualityConfig): QualityConfig {
  if (raw === null) return fallback;
  const rows: QualityRow[] = [];
  for (const chunk of raw.split(',')) {
    const [attr, w] = chunk.split(':');
    if (!attr || !(SUB_ATTRS as readonly string[]).includes(attr)) continue;
    const n = Number(w);
    if (!Number.isFinite(n) || n < 0) continue;
    rows.push({ attr: attr as SubAttr, weight: quantizeWeight(n) });
  }
  return { rows };
}

export function toQuery(state: AppState): string {
  const p = new URLSearchParams();
  p.set('slot', state.slot);
  p.set('main', state.mainAttr);
  p.set('iv', String(state.initialVisible));
  p.set('target', String(state.targetScore));
  p.set('slots', state.slots.map(encodeSlot).join(','));
  p.set('qw', encodeQuality(state.rows));
  // 分桶一律写进链接（有默认值，不存在「没选过」的状态），分享出去是同一个视图
  p.set('bucket', String(state.bucketSize));
  if (state.theme === 'dark') p.set('theme', 'dark');
  return p.toString();
}

/** 解析一个槽位；无法识别时返回空槽位（权重 0） */
function decodeSlot(chunk: string): SlotInput {
  const parts = chunk.split(':');
  const attr = (parts[0] ?? '') as SubAttr | '';
  const rawWeight = Number(parts[1]);
  // 兼容老链接：只有 `词条:权重` 两段时，初始档位按 random 处理
  const rawRoll = parts[2];
  const rollNumber = rawRoll === undefined ? Number.NaN : Number(rawRoll);
  const initialRoll: InitialRoll = isInitialRoll(rollNumber) ? rollNumber : 'random';

  return {
    attr: attr === '' || (SUB_ATTRS as readonly string[]).includes(attr) ? attr : '',
    weight: Number.isFinite(rawWeight) && rawWeight >= 0 ? quantizeWeight(rawWeight) : 0,
    initialRoll,
  };
}

/** 从 URL query 还原；解析失败则回退到默认值 */
export function fromQuery(search: string): AppState {
  const fallback = defaultState();
  try {
    const p = new URLSearchParams(search);
    const main = p.get('main') as MainAttr | null;
    const slotsRaw = p.get('slots');
    if (!main || !MAIN_ATTRS.includes(main) || !slotsRaw) return fallback;

    const parts = slotsRaw.split(',');
    if (parts.length !== 4) return fallback;

    const rawSlot = p.get('slot');
    const slot: ArtifactSlot = (SLOTS as readonly string[]).includes(rawSlot ?? '')
      ? (rawSlot as ArtifactSlot)
      : fallback.slot;
    // 主词条必须在**该部位**可选：老链接（没有 slot）或手改的链接都可能不合法。
    // 回落目标不是 fallback.mainAttr（它属于另一个部位，可能同样不合法），
    // 而是该部位权重最高的那个。花 / 羽没有可选项，不做限制。
    const mains = mainAttrsOf(slot);
    const mainAttr: MainAttr =
      mains.length === 0 || mains.includes(main) ? main : mains[0]!;

    const iv = Number(p.get('iv'));
    const target = Number(p.get('target'));
    const bucket = Number(p.get('bucket'));
    // 副词条不能与主词条重复（`爆伤` / `暴伤` 这种别名也算同一条）：链接可能是
    // 手改的或旧的，在入口就把这些行剔掉 —— 与 `core/quality.ts` 的 `qualityAttrs` 同一口径。
    const conflict = excludedSubstat(mainAttr);
    const rows = decodeQuality(p.get('qw'), fallback).rows.filter(
      (r) => r.attr === '' || r.attr !== conflict,
    );
    return {
      slot,
      mainAttr,
      slots: parts.map(decodeSlot) as Slots,
      initialVisible: iv === 3 || iv === 4 ? iv : fallback.initialVisible,
      targetScore: Number.isFinite(target) && target >= 0 ? target : fallback.targetScore,
      bucketSize: isBucketSize(bucket) ? bucket : fallback.bucketSize,
      rows,
      theme: p.get('theme') === 'dark' ? 'dark' : 'light',
    };
  } catch {
    return fallback;
  }
}
