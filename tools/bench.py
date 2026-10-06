"""性能基准：为 code review 的效率分析提供实测数字。

先跑 `python tools/verify_math.py` 确认正确性，再用本脚本量化热点。

运行（在项目根目录）：
    python -X utf8 tools/bench.py

要点（结果见 docs/ai-output/1-refactor/01-code-review.md §2）：
    calc_score_dist 只要 5～19 ms；plot_bar 要 2456 ms（占端到端 82%）。
    真正的瓶颈是 matplotlib 渲染，不是算法 —— 所以「优化算法」是错的方向。
"""
from __future__ import annotations

import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARC = ROOT / 'src' / 'artifact_growth'      # 归档的参考实现
sys.path.insert(0, str(ARC))

import artifact_growth as G  # noqa: E402
import init_stats as S  # noqa: E402

SEP = '=' * 78
ART_4R_CRIT = [G.Item('暴击', 2, None), G.Item('暴伤', 1, None),
               G.Item('', 0, None), G.Item('', 0, None)]
ART_4R_SIMPLE = [G.Item('暴击', 2, None)] + [G.Item('', 0, None)] * 3
ART_3R_CRIT = [G.Item('暴击', 2, None), G.Item('暴伤', 1, None),
               G.Item('', 0, None), G.Item('', 0, None)]
ART_PCT_FLAT = [G.Item('大攻击', 1, None), G.Item('小攻击', 0.1, None),
                G.Item('', 0, None), G.Item('', 0, None)]


def timed(label: str, fn, *a, **kw):
    t0 = time.perf_counter()
    r = fn(*a, **kw)
    dt = time.perf_counter() - t0
    print(f'  {label:<52} {dt * 1000:10.1f} ms')
    return dt, r


def bench_calc_score_dist() -> None:
    print(SEP)
    print('[A] calc_score_dist 单次耗时（含 @cache 预热后的重复调用）')
    print(SEP)
    cases = [
        ('4r 暴击2+暴伤1 (init_items=4)', ART_4R_CRIT, 4, True),
        ('3r 暴击2+暴伤1 (init_items=3)', ART_3R_CRIT, 3, True),
        ('4r 单词条暴击 (init_items=4)', ART_4R_SIMPLE, 4, True),
        ('4r 大攻击1+小攻击0.1 (init_items=4)', ART_PCT_FLAT, 4, True),
    ]
    for label, art, n, rnd in cases:
        G.calc_score_dist(art, n, rnd)          # 预热
        ts = []
        for _ in range(3):
            t0 = time.perf_counter()
            G.calc_score_dist(art, n, rnd)
            ts.append(time.perf_counter() - t0)
        print(f'  {label:<52} {min(ts) * 1000:10.1f} ms (3 次取最小)')


def bench_cold() -> None:
    print()
    print(SEP)
    print('[B] 冷启动拆解（清空 @cache 后分段计时）')
    print(SEP)
    G.get_item_dist.cache_clear()
    G.get_multi_growth.cache_clear()
    timed('get_item_dist(4, True)', G.get_item_dist, 4, True)
    for name in ('暴击', '暴伤', '大攻击', '小攻击', ''):
        timed(f'get_multi_growth({name!r})', G.get_multi_growth, name)
    timed('calc_score_dist 整体(4r 暴击+暴伤)', G.calc_score_dist, ART_4R_CRIT, 4, True)


def bench_inner_loop() -> None:
    print()
    print(SEP)
    print('[C] 内层循环规模统计')
    print(SEP)
    item_dist = G.get_item_dist(4, True)
    mg = {it.name: [[(g * it.weight, t) for g, t in line]
                    for line in G.get_multi_growth(it.name)] for it in ART_4R_CRIT}
    n_prod = 0
    for dist, freq in item_dist.items():
        seqs = [mg[it.name][d] for d, it in zip(dist, ART_4R_CRIT)]
        m = 1
        for s in seqs:
            m *= len(s)
        n_prod += m
    print(f'  外层组合 (dist 多重集) 数          = {len(item_dist)}')
    print(f'  Σ 内层 product 迭代次数            = {n_prod:,}')
    print(f'  另: 每次迭代还要 sum() 遍历 {len(ART_4R_CRIT)} 个元素 + prod() 遍历 '
          f'{len(ART_4R_CRIT)} 个')
    print('  → 规模仅 3 千级；itertools.product / sum / math.prod 都是 C 实现，')
    print('    所以「在这个规模上」换算法不会更快（见 [D] 实测）。')


def bench_vs_optimal() -> None:
    print()
    print(SEP)
    print('[D] 「逐槽位卷积」重写 vs 原实现（结论：在此规模下并不会更快）')
    print(SEP)

    def optimized(growths, artifact, init_items: int, init_rand: bool = True):
        """按「逐槽位卷积」重写 calc_score_dist：保持同一概率空间与权重口径，
        只把 product 的全量枚举换成同类项合并。"""
        item_dist = G.get_item_dist(init_items, init_rand)
        init_times = sum(bool(it.weight) for it in artifact) if init_rand else 0
        n = len(artifact)
        dist: Counter = Counter()
        for counts, freq in item_dist.items():
            states: Counter = Counter({(0.0, 0): 1})
            for v in range(n):
                item = artifact[v]
                w = item.weight
                slot: Counter = Counter({(0.0, 0): 1})
                for _ in range(counts[v]):
                    nxt: Counter = Counter()
                    for (s, h), c in slot.items():
                        for g in growths[item.name]:
                            nxt[(round(s + g, 9), h + 1)] += c
                    slot = nxt
                merged: Counter = Counter()
                for (s0, h0), c0 in states.items():
                    for (s1, h1), c1 in slot.items():
                        merged[(round(s0 + s1 * w, 9),
                                h0 + (h1 if w else 0))] += c0 * c1
                states = merged
            for (score, hits), c in states.items():
                dist[(round(score, 9), hits - init_times)] += c * freq
        # 与 calc_score_dist 返回的 total 同口径
        total = 4 ** (2 + 2 * init_items + 4 * int(init_rand))
        assert sum(dist.values()) == total, (sum(dist.values()), total)
        return total, dist

    for label, art, n, rnd in (('4r 暴击+暴伤', ART_4R_CRIT, 4, True),
                               ('4r 大攻击+小攻击', ART_PCT_FLAT, 4, True)):
        t0 = time.perf_counter()
        total_o, dist_o = optimized(G.growths, art, n, rnd)
        t_opt = time.perf_counter() - t0
        dist_opt = dict(dist_o)

        G.calc_score_dist(art, n, rnd)           # 预热
        t0 = time.perf_counter()
        total_c, sd_c = G.calc_score_dist(art, n, rnd)
        t_old = time.perf_counter() - t0
        dist_c = {}
        for score, d in sd_c:
            for i, f in enumerate(d):
                dist_c[(round(float(score), 9), i)] = f
        ref_dense = {k: dist_opt.get(k, 0) for k in dist_c}
        ref_dense.update({k: 0 for k in dist_opt if k not in dist_c})

        same = dist_c == ref_dense
        print(f'  {label}:')
        print(f'    原实现 (itertools.product)  {t_old * 1000:8.2f} ms   total={total_c}')
        print(f'    卷积版 (Counter 合并同类项)  {t_opt * 1000:8.2f} ms   total={total_o}')
        print(f'    速度比 原/新 = {t_old / t_opt:5.2f}×   稠密表一致 = {same}')
        print('    → 结论: 「先合并同类项」反而更慢，因为纯 Python 的 Counter/dict')
        print('      操作比 itertools.product 的 C 实现更贵；真正的加速手段是')
        print('      减少 Python 层循环（即整体搬离 Python），而非抠算法。')
        if not same:
            diff = [k for k in set(dist_c) | set(ref_dense)
                    if dist_c.get(k, 0) != ref_dense.get(k, 0)]
            print(f'    [FAIL] 差异格 {len(diff)}')


def bench_pipeline() -> None:
    """端到端：calc → excel → bar/pmf/cdf，看时间真正花在哪里。

    为避免在项目里落盘，这里把 plt.savefig 重定向到内存缓冲；
    Excel 部分走 pandas.to_excel 到 BytesIO。目的只是量出相对开销。
    """
    print()
    print(SEP)
    print('[E] 端到端耗时拆解（这才是有意义的效率指标）')
    print(SEP)
    import io as _io

    import matplotlib
    matplotlib.use('Agg')
    from matplotlib import pyplot as plt
    from pandas import DataFrame

    art = ART_4R_CRIT
    n = 4
    G.calc_score_dist(art, n, True)          # 预热 @cache

    t0 = time.perf_counter()
    data = G.calc_score_dist(art, n, True)
    t_calc = time.perf_counter() - t0

    total, score_dist = data
    t0 = time.perf_counter()
    cols = [score for score, _ in score_dist]
    index = range(len(score_dist[0][1]) - 1, -1, -1)
    lines = [[freq[i] / total for _, freq in score_dist] for i in index]
    buf = _io.BytesIO()
    DataFrame(lines, columns=cols, index=index).to_excel(buf)
    t_xlsx = time.perf_counter() - t0

    def timed_render(fn, *a):
        """fn 内部会 savefig 到磁盘；这里替换成渲染到 BytesIO，只计时。"""
        t_png = float('nan')
        real_savefig = plt.savefig
        real_show = plt.show

        def fake_savefig(*aa, **kw):
            nonlocal t_png
            t0 = time.perf_counter()
            real_savefig(_io.BytesIO(), **kw)
            t_png = time.perf_counter() - t0

        t0 = time.perf_counter()
        plt.savefig = fake_savefig
        plt.show = lambda *aa, **kw: None
        try:
            fn(*a)
        finally:
            plt.savefig = real_savefig
            plt.show = real_show
        return time.perf_counter() - t0, t_png

    t_bar, png_bar = timed_render(G.plot_bar, 'temp/nonexistent', *data)
    t_pmf, png_pmf = timed_render(G.plot_pmf, 'temp/nonexistent', *data)
    t_cdf, png_cdf = timed_render(G.plot_cdf, 'temp/nonexistent', *data)

    tot = t_calc + t_xlsx + t_bar + t_pmf + t_cdf
    print(f'  calc_score_dist            {t_calc * 1000:9.1f} ms  ({t_calc / tot:5.1%})')
    print(f'  DataFrame.to_excel         {t_xlsx * 1000:9.1f} ms  ({t_xlsx / tot:5.1%})')
    print(f'  plot_bar  (含 PNG 编码)     {t_bar * 1000:9.1f} ms  ({t_bar / tot:5.1%})'
          f'   其中 PNG 编码 {png_bar * 1000:6.1f} ms')
    print(f'  plot_pmf  (含 PNG 编码)     {t_pmf * 1000:9.1f} ms  ({t_pmf / tot:5.1%})'
          f'   其中 PNG 编码 {png_pmf * 1000:6.1f} ms')
    print(f'  plot_cdf  (含 PNG 编码)     {t_cdf * 1000:9.1f} ms  ({t_cdf / tot:5.1%})'
          f'   其中 PNG 编码 {png_cdf * 1000:6.1f} ms')
    print(f'  ------------------------------ 合计 {tot * 1000:9.1f} ms')
    print()
    print('  → 纯计算约占 0.2%；Excel 写入与 matplotlib 渲染是主要开销。')
    print('  → Web 端不需要 Excel 与 matplotlib，这部分开销整体消失。')


def bench_stacked_plot() -> None:
    """plot_quality_distribution_stacked 的 O(n^2) 扫描规模。"""
    print()
    print(SEP)
    print('[F] plot_quality_distribution_stacked 的内层扫描规模')
    print(SEP)
    for n_attrs in (3, 5, 7, 10):
        attrs = list(S.get_stats()[1].keys())[:n_attrs]
        comb_prob = S.all_possible_attrs_prob('大攻击', tuple(attrs))
        n_comb = len(comb_prob)
        # 每个图例项都做一次全量扫描（源码 331/340/358 行）
        n_scan = n_comb * (n_attrs + 2)
        print(f'  有效词条 {n_attrs:2d} 个 → 组合数 {n_comb:4d}，'
              f'图例统计的全量扫描次数 ≈ {n_scan:6d}')
    print('  说明: 这些统计量（「含 X 的概率」）本可一次遍历得到，')
    print('        组合数随词条数按 2^n 增长。但绝对值仍是毫秒级，')
    print('        属「写法不优雅」而非「性能问题」。')


def bench_init_stats() -> None:
    print()
    print(SEP)
    print('[G] init_stats 热点')
    print(SEP)
    S.get_stats.cache_clear()
    S.calc_exact_4_combo_prob.cache_clear()
    S.calc_attrs_prob.cache_clear()
    timed('get_stats() 冷', S.get_stats)
    timed('calc_attrs_prob(大攻击, 3 词条) 冷', S.calc_attrs_prob,
          '大攻击', frozenset(('暴击', '暴伤', '充能')))
    timed('all_possible_attrs_prob(5 词条)', S.all_possible_attrs_prob,
          '大攻击', ('暴击', '暴伤', '精通', '大攻击', '充能'))
    for attrs in (('暴击', '暴伤', '充能'), ('暴击', '暴伤', '精通', '大攻击'),
                  tuple(S.get_stats()[1].keys())):
        S.calc_attrs_prob.cache_clear()
        S.calc_exact_4_combo_prob.cache_clear()
        t0 = time.perf_counter()
        d = S.all_possible_attrs_prob('大攻击', attrs)
        dt = time.perf_counter() - t0
        print(f'  all_possible_attrs_prob(大攻击, {len(attrs)} 词条): '
              f'{dt * 1000:8.1f} ms  返回 {len(d)} 项  '
              f'calc_exact_4_combo_prob 缓存 {S.calc_exact_4_combo_prob.cache_info().currsize} 条')


if __name__ == '__main__':
    bench_calc_score_dist()
    bench_cold()
    bench_inner_loop()
    bench_vs_optimal()
    bench_pipeline()
    bench_stacked_plot()
    bench_init_stats()
    print()
    print(SEP)
    print('基准结束')
    print(SEP)
