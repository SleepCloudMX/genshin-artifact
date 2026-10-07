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
 * 配置分成两半，因为**不同任务需要的配置不同**：
 *
 * - `SharedConfig`：所有任务都要的（主词条、哪些副词条计分、配色）。
 *   它定义「评分标准」，换任务不该丢。
 * - `GrowthConfig`：**只属于「得分分布」这个任务**的（初始词条数、目标分数）。
 *   「胚子质量」只关心掉落那一刻，问它「掉落时可见几条」没有意义；
 *   以后的热力图任务同理。
 *
 * 加新任务时先问一句：这个配置是「评分标准」还是「这个任务特有的输入」？
 */
export interface SharedConfig {
  /** 刷的是哪个部位。它决定主词条的可选项，也决定主词条概率 */
  slot: ArtifactSlot;
  mainAttr: MainAttr;
  slots: Slots;
  theme: 'light' | 'dark';
}

export interface GrowthConfig {
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

export interface AppState extends SharedConfig, GrowthConfig {}

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
 * 从 0 起步时 `+` 落到哪里。
 *
 * 有默认权重的词条落到默认值（暴击一次到 2）；其余词条落到 1 ——
 * 它们是「临时想给点分」才加上的，用 1 当起点比 0.1 合理得多。
 */
export function stepStart(attr: SubAttr | ''): number {
  if (attr === '') return WEIGHT_STEP;
  return CANONICAL_WEIGHT[attr] || 1;
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
 * `+` 的下一档：当前为 0 时直接落到 `stepStart`（暴击一次到 2），
 * 否则按步长递加。这样「加一个词条」是一次点击，而不是点二十下。
 */
export function nextWeightUp(attr: SubAttr | '', weight: number): number {
  if (!(weight > 0)) return stepStart(attr);
  return round2(weight + WEIGHT_STEP);
}

/**
 * `−` 的下一档：正好停在默认权重时直接归零（暴击 2 → 0），否则按步长递减。
 * 归零这一下是刻意的——默认权重往往是最常用的口径，再往下按通常就是「不要它了」。
 */
export function nextWeightDown(attr: SubAttr | '', weight: number): number {
  if (!(weight > 0)) return 0;
  const base = attr === '' ? 0 : CANONICAL_WEIGHT[attr];
  if (base > 0 && Math.abs(weight - base) < 1e-9) return 0;
  return Math.max(0, round2(weight - WEIGHT_STEP));
}

/** 选中某词条时的权重初值：有默认口径就用它，否则用 `stepStart`（1） */
export function weightOnSelect(attr: SubAttr | ''): number {
  if (attr === '') return 0;
  return CANONICAL_WEIGHT[attr] || 1;
}

/**
 * 默认配置。
 *
 * - 主词条 `火伤`：它不在副词条池里，**副词条可选集是完整的**——
 *   用 `大攻击` 之类的当默认值会白白少一个选项，让人以为漏了东西。
 * - 副词条只有 `暴击 2` / `暴伤 1`，后两行留空。摆着权重 0 的词条会让
 *   「计分槽位 2/4」和看起来有 4 条的表格自相矛盾。
 */
export function defaultShared(): SharedConfig {
  return {
    slot: '杯',
    mainAttr: '火伤',
    slots: [
      { attr: '暴击', weight: CANONICAL_WEIGHT['暴击'], initialRoll: 'random' },
      { attr: '暴伤', weight: CANONICAL_WEIGHT['暴伤'], initialRoll: 'random' },
      { attr: '', weight: 0, initialRoll: 'random' },
      { attr: '', weight: 0, initialRoll: 'random' },
    ],
    theme: 'light',
  };
}

export function defaultGrowth(): GrowthConfig {
  // 分桶默认 0.2 分：0.1 在默认配置下有一百多根柱子，糊成一片
  return { initialVisible: 4, targetScore: 30, bucketSize: 0.2 };
}

/** 完整默认状态（两个 tab 的配置合起来） */
export function defaultState(): AppState {
  return { ...defaultShared(), ...defaultGrowth() };
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

/** 当前的「词条 → 权重」映射，只含权重 > 0 的条目（胚子质量页要用） */
export function weightMap(state: SharedConfig): Partial<Record<SubAttr, number>> {
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

export function toQuery(state: AppState): string {
  const p = new URLSearchParams();
  p.set('slot', state.slot);
  p.set('main', state.mainAttr);
  p.set('iv', String(state.initialVisible));
  p.set('target', String(state.targetScore));
  p.set('slots', state.slots.map(encodeSlot).join(','));
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
    return {
      slot,
      mainAttr,
      slots: parts.map(decodeSlot) as Slots,
      initialVisible: iv === 3 || iv === 4 ? iv : fallback.initialVisible,
      targetScore: Number.isFinite(target) && target >= 0 ? target : fallback.targetScore,
      bucketSize: isBucketSize(bucket) ? bucket : fallback.bucketSize,
      theme: p.get('theme') === 'dark' ? 'dark' : 'light',
    };
  } catch {
    return fallback;
  }
}
