"""归档：「不同命中词条数下超过 X 分的概率」（原 better_than.py）

逻辑已移植到 web/src/render/（前端直接在内存分布上切片，不再经过 xlsx）。
本文件仅作存档，不再维护。

已知问题（缺陷 #20）：从 xlsx 回读概率再重算，而 calc_score_dist 本来就在内存里
有精确的整数权重；用格式化后的概率反推会引入舍入误差。
"""
from pathlib import Path

import pandas as pd
from matplotlib import pyplot as plt

plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False


def better_than(score: float, xls_path: str | Path, show: bool = False) -> None:
    # df.index 获取行名, df.loc[i] 按行名获取行, df.iloc[i] 获取第 i 行
    xls_path = Path(xls_path)
    df = pd.read_excel(xls_path, index_col=0)
    cols = [col for col in df.columns if float(col) >= score]
    rows = sorted(df.index)
    betters = [sum(df[cols].loc[i]) for i in rows]
    totals = [sum(df.loc[i]) for i in rows]
    x_ticks = [f'({100 * total}%) {i}' for i, total in enumerate(totals)]
    bars = plt.barh(x_ticks, betters)
    plt.bar_label(bars, label_type='edge')
    plt.xlim([0, 1.2 * max(betters)])
    plt.title(f'{Path(xls_path).stem}: 不同命中词条下超过 {score} 分的概率 '
              f'(共 {sum(betters) * 100:.2f}%)')
    plt.xlabel('概率')
    plt.ylabel('命中词条数')
    plt.grid(axis='x')
    plt.tight_layout()
    plt.savefig(xls_path.parent / f'better-than-{score}.png')
    if show:
        plt.show()
    plt.close()
