"""归档：副词条组合概率与胚子质量分布（原 init_stats.py）

逻辑已移植到 web/src/core/，本文件仅作**前端移植的验收基准**，不再维护。
数值实现未作任何改动，仅统一了引号与注释措辞。
"""
from itertools import combinations, permutations
from functools import cache
from pathlib import Path
from types import MappingProxyType

import numpy as np
import pandas as pd
import seaborn as sns
from matplotlib import pyplot as plt
from matplotlib import patches as mpatches
from matplotlib.legend_handler import HandlerTuple

plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False


@cache
def get_stats(verbose: bool = False) -> tuple[
        MappingProxyType[str, MappingProxyType[str, float]],
        MappingProxyType[str, int], int
]:
    """主词条概率 与 副词条权重。

    副词条因为「不能与主词条相同」且「不能两两重复」，不能直接用概率，所以返回权重。
    :param verbose:     是否输出详细信息
    :return:
        main_probs:     {部位: {主词条: 概率}}
        sub_weights:    {副词条: 权重}
        sub_w_sum:      副词条权重和
    """
    # 官方千分比数据：沙的和 = 5000，杯的和 = 3800
    main_weights = {
        '沙': {'大生命': 1334, '大防御': 1333, '大攻击': 1333, '充能': 500, '精通': 500},
        '杯': {'大生命': 767, '大防御': 767, '大攻击': 766, '精通': 100, '物伤': 200,
               '火伤': 200, '雷伤': 200, '岩伤': 200, '风伤': 200, '水伤': 200, '冰伤': 200,
               '草伤': 200},
        '头': {'大生命': 11, '大防御': 11, '大攻击': 11, '暴击': 5, '爆伤': 5, '治疗': 5,
               '精通': 2},
    }
    main_probs = {}
    for pos in main_weights:
        total = sum(main_weights[pos].values())
        main_probs[pos] = {k: v / total for k, v in main_weights[pos].items()}
    # 内层 dict 是上面新构造的，与外部的 main_weights 已无引用关系，故只需浅拷贝
    main_probs = MappingProxyType({
        part: MappingProxyType(weights)
        for part, weights in main_probs.items()
    })
    if verbose:
        for pos, sub_weights in main_probs.items():
            print(pos, *sub_weights.items(), sep='\n')

    sub_weights = MappingProxyType({
        '小生命': 150, '小攻击': 150, '小防御': 150, '大生命': 100, '大防御': 100,
        '大攻击': 100, '暴击': 75, '暴伤': 75, '充能': 100, '精通': 100,
    })
    sub_w_sum = sum(sub_weights.values())

    return main_probs, sub_weights, sub_w_sum


def get_sub_probs(main_attr: str = None) -> dict[str, float]:
    """给定主词条，返回「附加词条池中各词条的权重占比」。

    注意这**不是**终态 4 个副词条里出现该词条的概率（见 calc_attrs_prob）。
    :param main_attr:   主词条
    :return:            {副词条: 该词条在池中的权重占比}
    """
    _, sub_weights, sub_w_sum = get_stats()
    sub_w_sum -= sub_weights.get(main_attr, 0)
    return {k: v / sub_w_sum for k, v in sub_weights.items() if k != main_attr}


@cache
def calc_exact_4_combo_prob(main_attr: str, combo: frozenset[str]) -> float:
    """底层核心：计算一个确定的、含有正好 4 个副词条的组合的出现概率。

    由于不放回抽样导致各排列概率不同，必须遍历 4! = 24 种排列求和。
    :param main_attr:   主词条
    :param combo:       四个副词条
    :return:            包含着四个副词条的概率
    """
    _, sub_weights, _ = get_stats()
    pool = {k: v for k, v in sub_weights.items() if k != main_attr}
    if not all(attr in pool for attr in combo):
        return 0.0  # 防御性检查：如果有词条和主词条冲突，或者根本不存在，概率为 0

    total_prob = 0.0
    for perm in permutations(combo):
        p = 1.0
        curr_sum = sum(pool.values())
        for attr in perm:
            p *= pool[attr] / curr_sum
            curr_sum -= pool[attr]
        total_prob += p
    return total_prob


@cache
def calc_attrs_prob(main_attr: str, attrs: frozenset[str],
                    excluded: frozenset[str] = frozenset()) -> float:
    """计算含有 attrs，且不含 excluded 的概率。

    :param main_attr:   主词条
    :param attrs:       若干有效副词条
    :param excluded:    若干排除的有效副词条
    :return:            概率

    其中
    1. 副词条种类 = 有效副词条 + 无效副词条
    2. 有效副词条 = 包含的词条 + 不包含的词条
    其中有效副词条数量任意
    1. 若少于 4 个, 则全部使用, 且不包含 excluded
    2. 若不低于 4 个, 则任取 4 个, 计算总的概率
    例子
    calc_attrs_prob('大攻击', ('暴击', '暴伤', '充能'))  # 0.019447064532289948
    calc_attrs_prob('大攻击', ())  # 0.9999999999999991
    """
    if not isinstance(attrs, frozenset):
        attrs = frozenset(attrs)
    if len(attrs) > 4:
        return 0.0
    if attrs & excluded or main_attr in attrs:
        return 0.0

    _, sub_weights, _ = get_stats()
    pool = {k: v for k, v in sub_weights.items() if k != main_attr}                 # 建立可用词条池
    valid_candidates = [k for k in pool if k not in attrs and k not in excluded]    # 非有效合法词条
    slots_to_fill = 4 - len(attrs)
    if len(valid_candidates) < slots_to_fill:
        return 0.0  # 如果合法的候选词条不够填满剩下的槽位，说明这种状态无法达成

    total_prob = 0.0
    for filler_combo in combinations(valid_candidates, slots_to_fill):
        full_combo = attrs | frozenset(filler_combo)    # 构成一个完整的 4 词条终态
        total_prob += calc_exact_4_combo_prob(main_attr, full_combo)
    return total_prob


def all_possible_attrs_prob(
        main_attr: str, attrs: tuple[str, ...], verbose: bool = False
) -> dict[tuple[str, ...], float]:
    """计算有效词条任意组合的概率（已过滤概率为 0 的情况）。

    :param main_attr:   主词条
    :param attrs:       有效词条列表
    :param verbose:     是否输出详细信息
    :return:            {有效词条组合: 概率}
    """
    total = 0.0
    result = {}
    attrs_set = frozenset(attrs)
    for n in range(len(attrs_set) + 1):
        for comb in combinations(attrs_set, n):
            comb_fs = frozenset(comb)
            excluded_fs = attrs_set - comb_fs
            p = calc_attrs_prob(main_attr, comb_fs, excluded=excluded_fs)
            total += p
            result[comb] = p
            if verbose:
                print(f'包含 {list(comb_fs)} 排除 {list(excluded_fs)}: {p:.6f}')
    if verbose:
        print(f'总和 (应严格等于1.0或近似有效全集概率): {total:.6f}')
    return {k: v for k, v in result.items() if v > 0}


def plot_substat_heatmap() -> None:
    main_probs, sub_weights, sub_w_sum = get_stats()
    # '其他' 不是主词条，get_sub_probs('其他') 会退化为全池分布
    main_attrs = ['小生命', '小攻击', '大生命', '大防御', '大攻击',
                  '暴击', '暴伤', '充能', '精通', '其他']
    all_data = []
    sub_names = list(sub_weights.keys())
    for m_attr in main_attrs:
        sub_probs = get_sub_probs(m_attr)
        row = {sub: sub_probs.get(sub, 0) for sub in sub_names}
        all_data.append(row | {'主词条类型': m_attr})
    df = pd.DataFrame(all_data).set_index('主词条类型')

    plt.figure(figsize=(10, 8))
    sns.heatmap(df, annot=True, fmt='.2%', cmap='YlOrRd')
    plt.title('给定主词条的副词条出现概率', fontsize=16, pad=20)
    plt.xlabel('副词条类型', fontsize=12, labelpad=10)
    plt.ylabel('主词条类型', fontsize=12, labelpad=10)
    plt.tight_layout()

    root = Path('init_stats')
    root.mkdir(exist_ok=True, parents=True)
    plt.savefig(root / '主词条-副词条.png')
    plt.close()          # 原版缺这一行，会导致 figure 泄漏（缺陷 #15）


def plot_attr_pie(
        main_attr: str,
        attrs_comb_prob: dict[tuple[str, ...], float],
        highlight_attr: tuple[str, ...],
        save_path: Path,
):
    """绘制组合概率饼图，并将 highlight_attr 组合分离出来。"""
    target_set = frozenset(highlight_attr)
    data = sorted(attrs_comb_prob.items(), key=lambda x: x[1])

    labels = []
    sizes = []
    explode = []

    for comb, p in data:
        labels.append(' + '.join(comb) if comb else '无有效词条')
        sizes.append(p)
        explode.append(0.2 if frozenset(comb) == target_set else 0)

    fig, ax = plt.subplots(figsize=(10, 7), dpi=120)
    colors = sns.color_palette('pastel') + sns.color_palette('Set3')

    wedges, texts, autotexts = ax.pie(
        sizes,
        explode=explode,
        labels=labels,
        autopct='%1.2f%%',
        startangle=140,
        colors=colors,
        pctdistance=0.8,
        textprops={'fontsize': 9},
        wedgeprops={'edgecolor': 'w', 'linewidth': 1, 'alpha': 0.9},
    )

    plt.setp(autotexts, size=8, weight='bold', color='#333333')
    plt.title(f'五星圣遗物副词条组合分布 (主词条: {main_attr})', fontsize=14, pad=20,
              weight='bold')

    save_path.parent.mkdir(exist_ok=True, parents=True)
    plt.savefig(save_path, bbox_inches='tight')
    plt.close()


def plot_quality_distribution(
    main_attr: str,
    attrs_comb_prob: dict[tuple[str, ...], float],
    score_weights: dict[str, int],
    save_path: Path
):
    """胚子质量分布图（柱状图 + "≥该分数" 累积曲线）。"""
    score_map = {}
    for comb, prob in attrs_comb_prob.items():
        total_score = sum(score_weights.get(attr, 0) for attr in comb)
        score_map[total_score] = score_map.get(total_score, 0) + prob

    sorted_scores = sorted(score_map.keys())
    probs = [score_map[s] for s in sorted_scores]

    # 累积概率用「大于等于该分数」，更符合玩家习惯
    cumulative_probs = np.cumsum(probs[::-1])[::-1]

    fig, ax1 = plt.subplots(figsize=(10, 6), dpi=120)
    color_bar = sns.color_palette('Blues_d', n_colors=len(sorted_scores))
    bars = ax1.bar(sorted_scores, probs, color=color_bar, alpha=0.7, label='单项概率',
                   width=0.6)
    ax1.set_xlabel('胚子得分 (有效词条加权和)', fontsize=12)
    ax1.set_ylabel('出现概率', fontsize=12)
    ax1.set_ylim(0, max(probs) * 1.2)

    for bar in bars:
        height = bar.get_height()
        ax1.text(bar.get_x() + bar.get_width() / 2., height + 0.005,
                 f'{height:.1%}', ha='center', va='bottom', fontsize=9)

    ax2 = ax1.twinx()
    ax2.plot(sorted_scores, cumulative_probs, color='#E74C3C', marker='o',
             linewidth=2, markersize=6, label='累积概率 (≥该分数)')
    ax2.set_ylabel('累积概率 (1-CDF)', fontsize=12, color='#E74C3C')
    ax2.tick_params(axis='y', labelcolor='#E74C3C')
    ax2.set_ylim(0, 1.1)

    ax1.grid(axis='y', linestyle='--', alpha=0.5)
    plt.title(f'圣遗物胚子质量分布 - {main_attr}\n权重: {score_weights}',
              fontsize=14, pad=20, weight='bold')

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper right')

    save_path.parent.mkdir(exist_ok=True, parents=True)
    plt.savefig(save_path, bbox_inches='tight')
    plt.close()


def plot_quality_distribution_stacked(
    main_attr: str,
    attrs_comb_prob: dict[tuple[str, ...], float],
    score_weights: dict[str, int],
    save_name: Path,
    highlight_comb: tuple[str, ...] = None,
    highlight_attr: str = None
):
    """堆叠柱状图 + 双轴「≥该分数」累积曲线 + 高亮。

    这是全项目信息密度最高的图，移植到 Web 时建议先 1:1 复刻。
    """
    score_to_combs = {}
    for comb, p in attrs_comb_prob.items():
        s = sum(score_weights.get(a, 0) for a in comb)
        score_to_combs.setdefault(s, []).append((comb, p))
    sorted_scores = sorted(score_to_combs.keys())

    legend_handles = []
    legend_labels = []

    if highlight_comb:
        h_set = set(highlight_comb)
        p_h = sum(p for comb, p in attrs_comb_prob.items() if h_set.issubset(set(comb)))
        if p_h > 0:
            legend_handles.append(mpatches.Patch(facecolor='#FF8C00', edgecolor='white'))
            legend_labels.append(f"含[{'+'.join(highlight_comb)}]: {p_h:>6.2%}")

    hl_bg_color = '#FF8C00'   # 背景高亮：暖橙色
    hl_text_color = 'green'   # 文字高亮：绿色
    if highlight_attr:
        p_a = sum(p for comb, p in attrs_comb_prob.items() if highlight_attr in comb)
        if p_a > 1e-6:
            bg_patch = mpatches.Patch(facecolor='#E5E7E9', edgecolor='none')
            dot_marker = plt.Line2D([0], [0], marker='o', color='none',
                                    markerfacecolor=hl_text_color,
                                    markeredgecolor='none', markersize=6)
            # 两个图元作为一个图例项
            legend_handles.append((bg_patch, dot_marker))
            legend_labels.append(f'含[{highlight_attr}]: {p_a:>6.2%}')

    all_attrs = sorted(score_weights.keys(), key=lambda x: score_weights[x], reverse=True)
    for attr in all_attrs:
        if attr == highlight_attr:
            continue
        p_sum = sum(p for comb, p in attrs_comb_prob.items() if attr in comb)
        if p_sum > 0:
            legend_handles.append(mpatches.Patch(facecolor='#E5E7E9', edgecolor='none'))
            legend_labels.append(f'含[{attr}]: {p_sum:>6.2%}')

    fig, ax1 = plt.subplots(figsize=(14, 9), dpi=240)
    total_probs = [sum(p for _, p in score_to_combs[s]) for s in sorted_scores]
    left_y_max = max(total_probs) * 1.3
    ax1.set_ylim(0, left_y_max)

    max_stack = max(len(v) for v in score_to_combs.values()) if score_to_combs else 1
    base_palette = sns.color_palette('Blues_d', n_colors=max_stack + 3)
    ax1.grid(axis='y', linestyle='--', alpha=0.4, zorder=0)

    len2size = [9, 9, 7, 5, 5]
    for score in sorted_scores:
        combs = sorted(score_to_combs[score], key=lambda x: x[1], reverse=True)
        bottom = 0
        for i, (comb, p) in enumerate(combs):
            comb_set = set(comb)
            is_bg_hl = highlight_comb and set(highlight_comb).issubset(comb_set)
            face_color = hl_bg_color if is_bg_hl else base_palette[i % len(base_palette)]

            ax1.bar(score, p, bottom=bottom, width=0.6,
                    color=face_color, edgecolor='white', linewidth=0.8, zorder=1)

            is_text_hl = highlight_attr and highlight_attr in comb_set
            t_color = hl_text_color if is_text_hl else 'black'
            t_weight = 'bold' if not is_text_hl else 'black'

            label_text = '+'.join(comb) if comb else '无'
            y_pos = bottom + p / 2 if len(comb) < 4 else bottom + p + 0.003

            ax1.text(score, y_pos, f'{label_text}\n{p:.1%}',
                     ha='center', va='center' if len(comb) < 4 else 'bottom',
                     fontsize=len2size[min(len(comb), 4)],
                     color=t_color, weight=t_weight, zorder=3)
            bottom += p

        total_p = sum(p for _, p in combs)
        y_top = total_p + (0.012 if (len(combs) == 1 and len(combs[0][0]) == 4) else 0.002)
        ax1.text(score, y_top, f'{total_p:.1%}', ha='center', va='bottom',
                 fontsize=10, color='#333333', weight='bold', zorder=3)

    cumulative_probs = np.cumsum(total_probs[::-1])[::-1]
    cdf_y_coords = [(v / 1.1) * left_y_max for v in cumulative_probs]

    line_cdf, = ax1.plot(sorted_scores, cdf_y_coords,
                         color='#E74C3C', marker='D', linewidth=2.5, markersize=6, zorder=2)

    x_data_min, x_data_max = ax1.get_xlim()
    for x_val, y_val, prob in zip(sorted_scores, cdf_y_coords, cumulative_probs):
        if prob < 0.001:
            continue
        x_prop = (x_val - x_data_min) / (x_data_max - x_data_min)
        ax1.axhline(y=y_val, xmin=x_prop, xmax=1,
                    color='#E74C3C', linestyle='--', linewidth=0.6, alpha=0.3, zorder=0)
        ax1.text(0.99, y_val + 0.002, f'{prob:.1%}',
                 transform=ax1.get_yaxis_transform(),
                 color='#E74C3C', fontsize=8, alpha=0.7,
                 ha='right', va='bottom', zorder=6)

    legend_handles.append(line_cdf)
    legend_labels.append('累计概率 (≥该分数)')

    leg = ax1.legend(legend_handles, legend_labels, loc='upper right',
                     bbox_to_anchor=(0.93, 0.98), title='统计指标',
                     facecolor='#FAFAFA', framealpha=0.9,
                     prop={'family': ['SimHei', 'monospace'], 'size': 10},
                     handler_map={tuple: HandlerTuple(ndivide=None, pad=-2)})

    # prop 对部分文本会失效，这里再强制设一次字体
    for text in leg.get_texts():
        text.set_fontfamily(['SimHei', 'monospace'])

    plt.setp(leg.get_title(), weight='bold', size=11, fontfamily='SimHei')

    secax = ax1.secondary_yaxis(
        'right', functions=(lambda x: (x / left_y_max) * 1.1,
                            lambda x: (x / 1.1) * left_y_max))
    secax.set_ylabel('累计概率', color='#E74C3C', fontweight='bold')

    ax1.set_xlabel('胚子得分', fontsize=12, fontweight='bold')
    ax1.set_ylabel('单项组合出现概率', fontsize=12, fontweight='bold')
    ax1.set_xticks(sorted_scores)
    sns.despine(top=True, right=False)
    plt.title(f'圣遗物胚子质量分布 - {main_attr}\n评分标准: {score_weights}',
              fontsize=14, pad=25, weight='bold')

    save_name.parent.mkdir(exist_ok=True, parents=True)
    plt.savefig(save_name, bbox_inches='tight')
    plt.close()
