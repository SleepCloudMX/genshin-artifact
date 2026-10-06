import { SUB_ATTRS, MAIN_ATTRS, excludedSubstat, type MainAttr, type SubAttr } from '../core/stats';
import {
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
  mainAttr: MainAttr;
  slots: Slots;
  theme: 'light' | 'dark';
}

export interface GrowthConfig {
  /** 掉落时可见几个副词条 */
  initialVisible: InitialVisible;
  /** 目标分数（用于「要刷多少个」） */
  targetScore: number;
}

export interface AppState extends SharedConfig, GrowthConfig {}

/** 槽位的固定填充顺序，决定「哪条占第 1 个槽位」——影响 3 词条胚子的建模 */
export const SLOT_ORDER: readonly SubAttr[] = SUB_ATTRS;

export function defaultState(): AppState {
  return {
    ...defaultShared(),
    ...defaultGrowth(),
  };
}

/**
 * 默认配置：主词条 `大攻击`，副词条 `暴击 1` / `暴伤 1`。
 *
 * 后两个槽位**留空、权重 0**：默认口径只有暴击暴伤两条计分，
 * 把 `充能`/`精通` 摆在那里会让指标卡显示「计分槽位 2/4」而下拉却像有 4 条，
 * 自相矛盾。留空反而更明确。
 */
export function defaultShared(): SharedConfig {
  return {
    mainAttr: '大攻击',
    slots: [
      { attr: '暴击', weight: 1, initialRoll: 'random' },
      { attr: '暴伤', weight: 1, initialRoll: 'random' },
      { attr: '', weight: 0, initialRoll: 'random' },
      { attr: '', weight: 0, initialRoll: 'random' },
    ],
    theme: 'light',
  };
}

export function defaultGrowth(): GrowthConfig {
  return { initialVisible: 4, targetScore: 30 };
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
 * - 权重非法时**忽略该词条**而不是抛错：输入框可能正处在中间状态（空串、`-`）。
 */
export function toSpec(state: SharedConfig & GrowthConfig): SpecResult {
  const excluded = excludedSubstat(state.mainAttr);
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
    if (weight <= 0) continue;
    usable.push({ attr, weight, initialRoll });
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
    if (attr !== '' && Number.isFinite(weight) && weight > 0) out[attr] = weight;
  }
  return out;
}

// ---------------------------------------------------------------------------
// URL 序列化：配置可以靠链接分享
// ---------------------------------------------------------------------------

/** 一个槽位在 query 里的写法：`词条:权重:档位`，`词条` 为空则整体省略 */
function encodeSlot(s: SlotInput): string {
  return `${s.attr}:${s.weight}:${s.initialRoll}`;
}

export function toQuery(state: AppState): string {
  const p = new URLSearchParams();
  p.set('main', state.mainAttr);
  p.set('iv', String(state.initialVisible));
  p.set('target', String(state.targetScore));
  p.set('slots', state.slots.map(encodeSlot).join(','));
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
    weight: Number.isFinite(rawWeight) && rawWeight >= 0 ? rawWeight : 0,
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

    const iv = Number(p.get('iv'));
    const target = Number(p.get('target'));
    return {
      mainAttr: main,
      slots: parts.map(decodeSlot) as Slots,
      initialVisible: iv === 3 || iv === 4 ? iv : fallback.initialVisible,
      targetScore: Number.isFinite(target) && target >= 0 ? target : fallback.targetScore,
      theme: p.get('theme') === 'dark' ? 'dark' : 'light',
    };
  } catch {
    return fallback;
  }
}
