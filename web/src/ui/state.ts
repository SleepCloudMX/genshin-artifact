import { SUB_ATTRS, MAIN_ATTRS, excludedSubstat, type MainAttr, type SubAttr } from '../core/stats';
import type { ArtifactSpec, Slot } from '../core/growth';

/**
 * 一个副词条的配置。
 *
 * 界面上是「词条 → 权重」的一张表，而计算需要「4 个有序槽位」，
 * 两者之间用 `toSlots` 转换：权重 > 0 的词条按固定顺序占槽位。
 * 这样界面可以随时增删词条（不会因为槽位对不上而出现空洞），
 * 也避免了「同一个词条被选两次」这种非法状态。
 */
export interface SlotInput {
  /** 该槽位的词条；未选时为空串 */
  attr: SubAttr | '';
  /** 计分权重；0 表示「已知但不计分」 */
  weight: number;
}

export type Slots = [SlotInput, SlotInput, SlotInput, SlotInput];

export interface AppState {
  /** 主词条 */
  mainAttr: MainAttr;
  /** 4 个副词条槽位（顺序有语义，不要重排） */
  slots: Slots;
  /** 掉落时可见几个副词条 */
  initialVisible: 3 | 4;
  /** 目标分数（用于「要刷多少个」） */
  targetScore: number;
  /** 配色 */
  theme: 'light' | 'dark';
}

/** 槽位的固定填充顺序，决定「哪条占第 1 个槽位」——影响 3 词条胚子的建模 */
export const SLOT_ORDER: readonly SubAttr[] = SUB_ATTRS;

export function defaultState(): AppState {
  return {
    mainAttr: '大攻击',
    // 需求里的默认：暴击 / 暴伤，权重都是 1。
    // 后两行留成「选了词条但权重 0」，让用户一眼看到还能加哪两条。
    slots: [
      { attr: '暴击', weight: 1 },
      { attr: '暴伤', weight: 1 },
      { attr: '充能', weight: 0 },
      { attr: '精通', weight: 0 },
    ],
    initialVisible: 4,
    targetScore: 30,
    theme: 'light',
  };
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
export function toSpec(state: AppState): SpecResult {
  const excluded = excludedSubstat(state.mainAttr);
  const ignored: SubAttr[] = [];
  const usable: { attr: SubAttr; weight: number }[] = [];

  for (const { attr, weight } of state.slots) {
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
    usable.push({ attr, weight });
  }

  usable.sort((a, b) => SLOT_ORDER.indexOf(a.attr) - SLOT_ORDER.indexOf(b.attr));

  const slots: Slot[] = [0, 1, 2, 3].map((i) => {
    const u = usable[i];
    // 空槽位必须给一个合法词条名；权重 0 时它对得分没有影响
    return u ? { attr: u.attr, weight: u.weight } : { attr: SLOT_ORDER[9]!, weight: 0 };
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
export function weightMap(state: AppState): Partial<Record<SubAttr, number>> {
  const out: Partial<Record<SubAttr, number>> = {};
  for (const { attr, weight } of state.slots) {
    if (attr !== '' && Number.isFinite(weight) && weight > 0) out[attr] = weight;
  }
  return out;
}

// ---------------------------------------------------------------------------
// URL 序列化：配置可以靠链接分享
// ---------------------------------------------------------------------------

export function toQuery(state: AppState): string {
  const p = new URLSearchParams();
  p.set('main', state.mainAttr);
  p.set('iv', String(state.initialVisible));
  p.set('target', String(state.targetScore));
  p.set('slots', state.slots.map((s) => `${s.attr}:${s.weight}`).join(','));
  if (state.theme === 'dark') p.set('theme', 'dark');
  return p.toString();
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

    const slots = parts.map((chunk): SlotInput => {
      const i = chunk.lastIndexOf(':');
      const attr = (i >= 0 ? chunk.slice(0, i) : chunk) as SubAttr | '';
      const w = i >= 0 ? Number(chunk.slice(i + 1)) : 0;
      const known = attr === '' || (SUB_ATTRS as readonly string[]).includes(attr);
      return {
        attr: known ? attr : '',
        weight: Number.isFinite(w) && w >= 0 ? w : 0,
      };
    }) as Slots;

    const iv = Number(p.get('iv'));
    const target = Number(p.get('target'));
    return {
      mainAttr: main,
      slots,
      initialVisible: iv === 3 || iv === 4 ? iv : fallback.initialVisible,
      targetScore: Number.isFinite(target) && target >= 0 ? target : fallback.targetScore,
      theme: p.get('theme') === 'dark' ? 'dark' : 'light',
    };
  } catch {
    return fallback;
  }
}
