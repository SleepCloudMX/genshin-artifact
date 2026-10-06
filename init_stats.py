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

plt.rcParams['font.sans-serif'] = ['SimHei']  # 'Microsoft YaHei' 可以解决指数为负时的显示问题
plt.rcParams['axes.unicode_minus'] = False


@cache
def get_stats(verbose: bool = False) -> tuple[
        MappingProxyType[str, MappingProxyType[str, float]],
        MappingProxyType[str, int], int
]:
    """
    计算并缓存 主词条属性概率 和 副词条属性权重.
    其中副词条因 "a.不能与主词条相同; b.不能两两重复" 而不能直接使用概率, 因此返回权重.
    :param verbose:     是否输出详细信息
    :return:
        main_probs:     {部位: {主词条: 概率}}
        sub_weights:    {副词条: 权重}
        sub_w_sum:      副词条权重和
    """
    main_weights = {
        '沙': {'大生命': 1334, '大防御': 1333, '大攻击': 1333, '充能': 500, '精通': 500},
        '杯': {'大生命': 767, '大防御': 767, '大攻击': 766, '精通': 100, '物伤': 200,
               '火伤': 200, '雷伤': 200, '岩伤': 200, '风伤': 200, '水伤': 200, '冰伤': 200, '草伤': 200},
        '头': {'大生命': 11, '大防御': 11, '大攻击': 11, '暴击': 5, '爆伤': 5, '治疗': 5, '精通': 2},
    }
    main_probs = {}
    for pos in main_weights:
        total = sum(main_weights[pos].values())
        main_probs[pos] = {k: v / total for k, v in main_weights[pos].items()}
    main_probs = MappingProxyType({
        part: MappingProxyType(weights)         # 或 dict(weights) 拷贝内层，隔离原数据
        for part, weights in main_probs.items() # 不过这里重新幅值, 因此无需拷贝
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
    """
    给定主词条, 返回副词条包含某词条的概率
    :param main_attr:   主词条
    :return:            {副词条: 给定主词条出现该副词条的概率}
    """
    _, sub_weights, sub_w_sum = get_stats()
    sub_w_sum -= sub_weights.get(main_attr, 0)
    return {k: v / sub_w_sum for k, v in sub_weights.items() if k != main_attr}


@cache
def calc_exact_4_combo_prob(main_attr: str, combo: frozenset[str]) -> float:
    """
    底层核心：计算一个确定的、含有正好 4 个副词条的组合的出现概率。
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
def calc_attrs_prob(main_attr: str, attrs: frozenset[str], excluded: frozenset[str] = frozenset()) -> float:
    """
    计算含有 attrs，且不含 excluded 的概率。
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
    """
    计算有效词条任意组合的概率 (已过滤概率为 0 的情况)
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
                print(f"包含 {list(comb_fs)} 排除 {list(excluded_fs)}: {p:.6f}")
    if verbose:
        print(f"总和 (应严格等于1.0或近似有效全集概率): {total:.6f}")
    return {k: v for k, v in result.items() if v > 0}


def plot_substat_heatmap() -> None:
    main_probs, sub_weights, sub_w_sum = get_stats()
    main_attrs = ['小生命', '小攻击', '大生命', '大防御', '大攻击',
                  '暴击', '暴伤', '充能', '精通', '其他']
    all_data = []
    sub_names = list(sub_weights.keys())
    for m_attr in main_attrs:
        sub_probs = get_sub_probs(m_attr)
        row = {sub: sub_probs.get(sub, 0) for sub in sub_names}
        all_data.append(row | {'主词条类型': m_attr})
    df = pd.DataFrame(all_data).set_index('主词条类型')

    plt.figure(figsize=(10, 8))  # 稍微加宽一点，防止文字重叠
    sns.heatmap(df, annot=True, fmt=".2%", cmap="YlOrRd")
    plt.title("给定主词条的副词条出现概率", fontsize=16, pad=20)
    plt.xlabel("副词条类型", fontsize=12, labelpad=10)
    plt.ylabel("主词条类型", fontsize=12, labelpad=10)
    # plt.xticks(rotation=45)
    plt.tight_layout()

    root = Path('init_stats')
    root.mkdir(exist_ok=True, parents=True)
    plt.savefig(root / '主词条-副词条.png')


def plot_attr_pie(
        main_attr: str,
        attrs_comb_prob: dict[tuple[str, ...], float],
        highlight_attr: tuple[str, ...],
        save_path: Path,
):
    """
    绘制美化的组合概率饼图，并将 highlight_attr 组合分离出来。
    """
    # 1. 数据预处理
    target_set = frozenset(highlight_attr)
    data = sorted(attrs_comb_prob.items(), key=lambda x: x[1])

    labels = []
    sizes = []
    explode = []

    for comb, p in data:
        label_text = " + ".join(comb) if comb else "无有效词条"
        labels.append(label_text)
        sizes.append(p)

        # 判断是否为需要高亮分离的组合
        if frozenset(comb) == target_set:
            explode.append(0.2)  # 分离距离
        else:
            explode.append(0)

    # 2. 绘图设置
    fig, ax = plt.subplots(figsize=(10, 7), dpi=120)

    # 使用更加柔和的调色板
    colors = sns.color_palette("pastel") + sns.color_palette("Set3")

    # 绘制饼图
    wedges, texts, autotexts = ax.pie(
        sizes,
        explode=explode,
        labels=labels,
        autopct='%1.2f%%',
        startangle=140,    # 旋转角度使视觉更平衡
        colors=colors,
        pctdistance=0.8,   # 百分比距离圆心的距离
        # shadow=True,       # 增加立体感
        textprops={'fontsize': 9},
        wedgeprops={'edgecolor': 'w', 'linewidth': 1, 'alpha': 0.9} # 白色边框更精致
    )

    # 3. 细节美化
    plt.setp(autotexts, size=8, weight="bold", color="#333333")
    plt.title(f"五星圣遗物副词条组合分布 (主词条: {main_attr})", fontsize=14, pad=20, weight='bold')

    # 4. 存储
    save_path.parent.mkdir(exist_ok=True, parents=True)
    plt.savefig(save_path, bbox_inches='tight')
    plt.close()


def plot_quality_distribution(
    main_attr: str,
    attrs_comb_prob: dict[tuple[str, ...], float],
    score_weights: dict[str, int],
    save_path: Path
):
    """
    计算并绘制胚子质量分布图（柱状图 + CDF曲线）。
    """
    # 步骤 2: 概率聚合
    score_map = {}
    for comb, prob in attrs_comb_prob.items():
        # 计算该组合的总分
        total_score = sum(score_weights.get(attr, 0) for attr in comb)
        score_map[total_score] = score_map.get(total_score, 0) + prob

    # 排序分数，确保 X 轴有序
    sorted_scores = sorted(score_map.keys())
    probs = [score_map[s] for s in sorted_scores]

    # 计算累积概率 (CDF) - 这里用 "大于等于该分数" 的概率，更符合玩家习惯
    # 即：我有多少概率拿到 X 分及以上的胚子
    reversed_probs = probs[::-1]
    cumulative_probs = np.cumsum(reversed_probs)[::-1]

    # 步骤 3: 绘制双轴图
    fig, ax1 = plt.subplots(figsize=(10, 6), dpi=120)

    # 3.1 绘制左轴：概率柱状图
    color_bar = sns.color_palette("Blues_d", n_colors=len(sorted_scores))
    bars = ax1.bar(sorted_scores, probs, color=color_bar, alpha=0.7, label='单项概率', width=0.6)
    ax1.set_xlabel('胚子得分 (有效词条加权和)', fontsize=12)
    ax1.set_ylabel('出现概率', fontsize=12)
    ax1.set_ylim(0, max(probs) * 1.2) # 留出顶部空间

    # 在柱子上标注具体百分比
    for bar in bars:
        height = bar.get_height()
        ax1.text(bar.get_x() + bar.get_width()/2., height + 0.005,
                 f'{height:.1%}', ha='center', va='bottom', fontsize=9)

    # 3.2 绘制右轴：累积分布曲线 (CDF)
    ax2 = ax1.twinx()
    ax2.plot(sorted_scores, cumulative_probs, color='#E74C3C', marker='o',
             linewidth=2, markersize=6, label='累积概率 (≥该分数)')
    ax2.set_ylabel('累积概率 (1-CDF)', fontsize=12, color='#E74C3C')
    ax2.tick_params(axis='y', labelcolor='#E74C3C')
    ax2.set_ylim(0, 1.1)

    # 设置网格
    ax1.grid(axis='y', linestyle='--', alpha=0.5)

    plt.title(f"圣遗物胚子质量分布 - {main_attr}\n权重: {score_weights}",
              fontsize=14, pad=20, weight='bold')

    # 合并图例
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper right')

    # 4. 存储
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
    # 1. 数据准备
    score_to_combs = {}
    for comb, p in attrs_comb_prob.items():
        s = sum(score_weights.get(a, 0) for a in comb)
        score_to_combs.setdefault(s, []).append((comb, p))
    sorted_scores = sorted(score_to_combs.keys())

    # 2. 统计看板数据
    legend_handles = []
    legend_labels = []

    # 统计高亮组合概率
    if highlight_comb:
        h_set = set(highlight_comb)
        p_h = sum(p for comb, p in attrs_comb_prob.items() if h_set.issubset(set(comb)))
        if p_h > 0:
            legend_handles.append(mpatches.Patch(facecolor='#FF8C00', edgecolor='white'))
            legend_labels.append(f"含[{'+'.join(highlight_comb)}]: {p_h:>6.2%}")

    # 统计高亮单词条概率
    hl_bg_color = "#FF8C00"  # 背景高亮：暖橙色
    hl_text_color = "green" # 文字高亮：绿色
    if highlight_attr:
        p_a = sum(p for comb, p in attrs_comb_prob.items() if highlight_attr in comb)
        if p_a > 1e-6:
            # 1. 创建底层灰色方块
            bg_patch = mpatches.Patch(facecolor='#E5E7E9', edgecolor='none')
            # 2. 创建顶层绿色圆点
            # marker='o' 圆点, markersize 设置大一点以保证在方块中心明显
            dot_marker = plt.Line2D([0], [0], marker='o', color='none',
                                    markerfacecolor=hl_text_color,
                                    markeredgecolor='none', markersize=6)

            # 将二者作为一个元组存入，表示它们是“同一个图例项”的两个图层
            legend_handles.append((bg_patch, dot_marker))
            legend_labels.append(f"含[{highlight_attr}]: {p_a:>6.2%}")

    # 其他有效词条统计
    all_attrs = sorted(score_weights.keys(), key=lambda x: score_weights[x], reverse=True)
    for attr in all_attrs:
        if attr == highlight_attr: continue # 避免重复
        p_sum = sum(p for comb, p in attrs_comb_prob.items() if attr in comb)
        if p_sum > 0:
            legend_handles.append(mpatches.Patch(facecolor='#E5E7E9', edgecolor='none'))
            legend_labels.append(f"含[{attr}]: {p_sum:>6.2%}")

    # 3. 绘图初始化
    fig, ax1 = plt.subplots(figsize=(14, 9), dpi=240)
    total_probs = [sum(p for _, p in score_to_combs[s]) for s in sorted_scores]
    left_y_max = max(total_probs) * 1.3
    ax1.set_ylim(0, left_y_max)

    # CDF 与 颜色
    max_stack = max(len(v) for v in score_to_combs.values()) if score_to_combs else 1
    base_palette = sns.color_palette("Blues_d", n_colors=max_stack + 3)

    ax1.grid(axis='y', linestyle='--', alpha=0.4, zorder=0)

    # 4. 循环绘制
    len2size = [9, 9, 7, 5, 5]
    for score in sorted_scores:
        combs = sorted(score_to_combs[score], key=lambda x: x[1], reverse=True)
        bottom = 0
        for i, (comb, p) in enumerate(combs):
            comb_set = set(comb)

            # 背景颜色判定
            is_bg_hl = highlight_comb and set(highlight_comb).issubset(comb_set)
            face_color = hl_bg_color if is_bg_hl else base_palette[i % len(base_palette)]

            ax1.bar(score, p, bottom=bottom, width=0.6,
                    color=face_color, edgecolor='white', linewidth=0.8, zorder=1)

            # 文字颜色判定
            is_text_hl = highlight_attr and highlight_attr in comb_set
            t_color = hl_text_color if is_text_hl else "black"
            t_weight = 'bold' if not is_text_hl else 'black' # 高亮时使用极粗体

            label_text = "+".join(comb) if comb else "无"
            y_pos = bottom + p/2 if len(comb) < 4 else bottom + p + 0.003

            ax1.text(score, y_pos, f"{label_text}\n{p:.1%}",
                     ha='center', va='center' if len(comb) < 4 else 'bottom',
                     fontsize=len2size[min(len(comb), 4)],
                     color=t_color, weight=t_weight, zorder=3)
            bottom += p

        # 顶部总概率
        total_p = sum(p for _, p in combs)
        y_top = total_p + (0.012 if (len(combs) == 1 and len(combs[0][0]) == 4) else 0.002)
        ax1.text(score, y_top, f"{total_p:.1%}", ha='center', va='bottom',
                 fontsize=10, color='#333333', weight='bold', zorder=3)

    # 5. CDF 曲线
    cumulative_probs = np.cumsum(total_probs[::-1])[::-1]
    cdf_y_coords = [(v/1.1)*left_y_max for v in cumulative_probs]

    # 绘制 CDF 主曲线
    line_cdf, = ax1.plot(sorted_scores, cdf_y_coords,
                         color='#E74C3C', marker='D', linewidth=2.5, markersize=6, zorder=2)

    # 获取数据坐标系下的 X 范围，用于计算起始比例
    x_data_min, x_data_max = ax1.get_xlim()

    for x_val, y_val, prob in zip(sorted_scores, cdf_y_coords, cumulative_probs):
        if prob < 0.001: continue

        # 计算节点在 X 轴上的百分比位置 (0~1)
        x_prop = (x_val - x_data_min) / (x_data_max - x_data_min)

        # 1. 绘制水平虚线：从节点精准戳到右边框 (xmax=1)
        # alpha=0.15 保持极淡，避免干扰
        ax1.axhline(y=y_val, xmin=x_prop, xmax=1,
                    color='#E74C3C', linestyle='--', linewidth=0.6, alpha=0.3, zorder=0)

        # 2. 在虚线末端 (边框内侧) 标注概率
        # x=0.99 表示在右边框内侧留出 1% 的间隙
        # transform=ax1.get_yaxis_transform() 结合了数据 Y 坐标和物理 X 比例
        ax1.text(0.99, y_val + 0.002, f"{prob:.1%}",
                 transform=ax1.get_yaxis_transform(),
                 color='#E74C3C', fontsize=8, alpha=0.7,
                 ha='right', va='bottom', zorder=6)

    legend_handles.append(line_cdf)
    legend_labels.append('累计概率 (≥该分数)')

    # 6. 看板与轴
    # Windows 推荐 'SimSun-ExtB' (等宽宋体) 或直接混用
    leg = ax1.legend(legend_handles, legend_labels, loc='upper right',
                     bbox_to_anchor=(0.93, 0.98), title='统计指标',
                     facecolor='#FAFAFA', framealpha=0.9,
                     prop={'family': ['SimHei', 'monospace'], 'size': 10},
                     # ndivide=None 使其重叠，pad=0 消除间距
                     handler_map={tuple: HandlerTuple(ndivide=None, pad=-2)})

    # 后处理：强制对所有图例文字进行二次修复
    # 这一步能解决 99% 的 prop 失效问题
    for text in leg.get_texts():
        text.set_fontfamily(['SimHei', 'monospace']) # 这里的列表顺序确保中文优先

    plt.setp(leg.get_title(), weight='bold', size=11, fontfamily='SimHei')

    secax = ax1.secondary_yaxis('right', functions=(lambda x: (x/left_y_max)*1.1, lambda x: (x/1.1)*left_y_max))
    secax.set_ylabel('累计概率', color='#E74C3C', fontweight='bold')

    ax1.set_xlabel('胚子得分', fontsize=12, fontweight='bold')
    ax1.set_ylabel('单项组合出现概率', fontsize=12, fontweight='bold')
    ax1.set_xticks(sorted_scores)
    sns.despine(top=True, right=False)
    plt.title(f"圣遗物胚子质量分布 - {main_attr}\n评分标准: {score_weights}", fontsize=14, pad=25, weight='bold')

    save_name.parent.mkdir(exist_ok=True, parents=True)
    plt.savefig(save_name, bbox_inches='tight')
    plt.close()


def _test() -> None:
    plot_root = Path('init_stats/大攻击')

    # 1. 绘制 主词条-副词条 热图
    # main_probs, sub_weights, sub_w_sum = get_stats(show=True)
    # sub_probs = get_sub_probs('大生命')
    # plot_substat_heatmap()

    # 2. 绘制饼图
    # main_attr = '大攻击'
    # attrs = ('暴击', '暴伤', '充能')
    # save_path = plot_root / f"pie-有效({','.join(attr for attr in attrs)}.png"
    # attrs_comb_prob = all_possible_attrs_prob(main_attr, attrs, verbose=False)
    # plot_attr_pie(main_attr, attrs_comb_prob, attrs, save_path)

    # 3. 绘制柱状图
    main_attr = '大攻击'
    attrs_scores = {
        '暴击': 3, '暴伤': 3,
        '精通': 2, '大攻击': 2,
        '充能': 1,
    }
    highlight_comb = ('暴击', '暴伤')
    highlight_attr = '充能'
    attrs_comb_prob = all_possible_attrs_prob(main_attr, tuple(attrs_scores.keys()), verbose=False)
    # for comb, p in attrs_comb_prob.items():
    #     print(comb, p)
    # plot_quality_distribution(main_attr, attrs_comb_prob, attrs_scores, plot_root / '质量分布.png')
    plot_quality_distribution_stacked(
        main_attr, attrs_comb_prob, attrs_scores, plot_root / '质量分布-堆叠.png',
        highlight_comb=highlight_comb, highlight_attr=highlight_attr
    )


def main() -> None:
    # plot_substat_heatmap()

    root = Path('init_stats')

    pie_configs = [
        # {'main_attr': '大攻击', 'attrs': ('暴击', '暴伤', '充能')},
        # {'main_attr': '大攻击', 'attrs': ('暴击', '暴伤', '充能', '精通')},
        # {'main_attr': '暴伤', 'attrs': ('暴击', '充能', '精通')},
        # {'main_attr': '暴伤', 'attrs': ('暴击', '充能', '精通', '大攻击')},
        {'main_attr': '小生命', 'attrs': ('暴击', '暴伤', '充能')},
        {'main_attr': '小生命', 'attrs': ('暴击', '暴伤', '充能', '大攻击')},
    ]
    for config in pie_configs:
        main_attr = config['main_attr']
        attrs = config['attrs']
        save_path = root / main_attr / f"pie-有效({','.join(attr for attr in attrs)}.png"
        attrs_comb_prob = all_possible_attrs_prob(main_attr, attrs, verbose=False)
        plot_attr_pie(main_attr, attrs_comb_prob, attrs, save_path)

    dist_configs = [
        # {
        #     'name': '1',
        #     'main_attr': '大攻击',
        #     'attrs_scores': {
        #         '暴击': 3, '暴伤': 3,
        #         '精通': 2, '大攻击': 2,
        #         '充能': 1,
        #     },
        #     'highlight_comb': ('暴击', '暴伤'),
        #     'highlight_attr': '充能',
        # },
        # {
        #     'name': '1',
        #     'main_attr': '暴伤',
        #     'attrs_scores': {
        #         '暴击': 3,
        #         '精通': 2, '大攻击': 2,
        #         '充能': 1,
        #     },
        #     'highlight_comb': ('暴击', ),
        #     'highlight_attr': '充能',
        # },
        # {
        #     'name': '1',
        #     'main_attr': '火伤',
        #     'attrs_scores': {
        #         '暴击': 3, '暴伤': 3,
        #         '精通': 2, '大攻击': 2,
        #         '充能': 1,
        #     },
        #     'highlight_comb': ('暴击', '暴伤'),
        #     'highlight_attr': '充能',
        # },
    ]
    for config in dist_configs:
        name = config['name']
        main_attr = config['main_attr']
        attrs_scores = config['attrs_scores']
        highlight_comb = config['highlight_comb']
        highlight_attr = config['highlight_attr']
        plot_root = root / main_attr
        attrs_comb_prob = all_possible_attrs_prob(main_attr, tuple(attrs_scores.keys()), verbose=False)
        plot_quality_distribution(main_attr, attrs_comb_prob, attrs_scores, plot_root / f'质量分布-{name}.png')
        plot_quality_distribution_stacked(
            main_attr, attrs_comb_prob, attrs_scores, plot_root / f'质量分布-详细-{name}.png',
            highlight_comb=highlight_comb, highlight_attr=highlight_attr
        )


if __name__ == '__main__':
    from timeit import timeit
    print('Time used:', timeit(main, number=1))
