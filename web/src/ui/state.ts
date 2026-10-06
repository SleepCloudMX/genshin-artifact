import type { MainAttr, SubAttr } from '../core/stats';

/** 一个计分槽位的配置 */
export interface SlotInput {
  /** 该槽位的词条；未选时为空串 */
  attr: SubAttr | '';
  /** 计分权重；0 表示「已知但不计分」 */
  weight: number;
}

export interface AppState {
  /** 主词条 */
  mainAttr: MainAttr;
  /** 4 个副词条槽位（顺序有语义，不要重排） */
  slots: [SlotInput, SlotInput, SlotInput, SlotInput];
  /** 掉落时可见几个副词条 */
  initialVisible: 3 | 4;
  /** 目标分数（用于「要刷多少个」） */
  targetScore: number;
  /** 是否在柱状图上标注文字 */
  showLabels: boolean;
}

export const WEIGHT_PRESETS: { label: string; value: number }[] = [
  { label: '1（主）', value: 1 },
  { label: '0.5', value: 0.5 },
  { label: '0.1', value: 0.1 },
  { label: '0（不计分）', value: 0 },
];

export function defaultState(): AppState {
  return {
    mainAttr: '暴击',
    slots: [
      { attr: '暴伤', weight: 1 },
      { attr: '大攻击', weight: 0.5 },
      { attr: '', weight: 0 },
      { attr: '', weight: 0 },
    ],
    initialVisible: 4,
    targetScore: 30,
    showLabels: true,
  };
}

/** 序列化到 URL query，便于分享配置 */
export function toQuery(state: AppState): string {
  const p = new URLSearchParams();
  p.set('main', state.mainAttr);
  p.set('iv', String(state.initialVisible));
  p.set('target', String(state.targetScore));
  p.set(
    'slots',
    state.slots.map((s) => `${s.attr}:${s.weight}`).join(','),
  );
  return p.toString();
}

/** 从 URL query 还原；解析失败则回退到默认值 */
export function fromQuery(search: string): AppState {
  const fallback = defaultState();
  try {
    const p = new URLSearchParams(search);
    const main = p.get('main') as MainAttr | null;
    const iv = Number(p.get('iv'));
    const target = Number(p.get('target'));
    const slotsRaw = p.get('slots');
    if (!main || !slotsRaw) return fallback;

    const parts = slotsRaw.split(',');
    if (parts.length !== 4) return fallback;

    const slots = parts.map((chunk) => {
      const i = chunk.lastIndexOf(':');
      const attr = (i >= 0 ? chunk.slice(0, i) : chunk) as SubAttr | '';
      const w = i >= 0 ? Number(chunk.slice(i + 1)) : 0;
      return { attr: attr === '' ? '' : attr, weight: Number.isFinite(w) ? w : 0 };
    }) as AppState['slots'];

    return {
      mainAttr: main,
      slots,
      initialVisible: iv === 3 || iv === 4 ? iv : fallback.initialVisible,
      targetScore: Number.isFinite(target) ? target : fallback.targetScore,
      showLabels: fallback.showLabels,
    };
  } catch {
    return fallback;
  }
}
