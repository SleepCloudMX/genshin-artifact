from pathlib import Path
import pandas as pd
from matplotlib import pyplot as plt

plt.rcParams['font.sans-serif'] = ['SimHei']  # 'Microsoft YaHei' 可以解决指数为负时的显示问题
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
    # for bar, better, total in zip(bars, betters, totals):
    #     width = bar.get_width()
    #     y_pos = bar.get_y() +  bar.get_height() / 2
    #     plt.text(width / 2, y_pos, f'{better} = {total}', ha='center', va='center')
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


def main() -> None:
    """测试"""
    # for score in (30, 40, 45, 50):
    #     better_than(score, '4r-暴击-爆伤/4r-暴击-爆伤.xlsx')
    # for score in (30, 40, 45):
    #     better_than(score, '3r-暴击-爆伤/3r-暴击-爆伤.xlsx')

    better_than(42.8, '4r-暴击-爆伤/4r-暴击-爆伤.xlsx')
    # better_than(43.5, '3r-暴击-爆伤/3r-暴击-爆伤.xlsx')
    # better_than(18.7, '4r-暴击/4r-暴击.xlsx')


if __name__ == '__main__':
    from timeit import timeit
    print('Time used:', timeit(main, number=1))
