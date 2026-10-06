"""Code-review 验证脚本（保留为可复跑的验收工具）

结论（全部由本脚本复现）：
  A. init_stats.calc_attrs_prob      —— 数学正确（与定义式枚举逐项一致）
  B. artifact_growth.calc_score_dist —— 数学正确（与独立重写实现稠密表逐格一致）
  C. init_rand=False / Item.init     —— 从未执行过的不可用分支（一调用就崩）
  D. 命名 / 常量 / 浮点键等工程问题   —— 见 docs/ai-output/1-refactor/01-code-review.md

运行（在项目根目录）：
    & "$env:CONDA_PREFIX\python.exe" -X utf8 tools/verify_math.py
或：
    python -X utf8 tools/verify_math.py

退出码：0 = 全部通过；1 = 有 FAIL（[BUG] 行是「已记录在案的缺陷」，不计入 FAIL）。
"""
from __future__ import annotations

import sys
from collections import Counter
from fractions import Fraction
from itertools import combinations, permutations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARC = ROOT / 'src' / 'artifact_growth'      # 归档的参考实现
sys.path.insert(0, str(ARC))

import init_stats as S  # noqa: E402

SEP = '=' * 78
FAILS: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        FAILS.append(msg)
        print(f'  [FAIL] {msg}')
    else:
        print(f'  [ OK ] {msg}')


# ============================================================================
# 1. init_stats.calc_attrs_prob
# ============================================================================
def ref_comb_prob(main_attr: str, attrs: frozenset[str], exact: bool = False):
    """按定义：Σ_{4 子集 ⊇ attrs} Σ_{4! 排列} ∏ 权重/剩余权重和。"""
    _, sw, _ = S.get_stats()
    items = [(k, v) for k, v in sw.items() if k != main_attr]
    n = len(items)
    W = sum(w for _, w in items)
    total = Fraction(0) if exact else 0.0
    for chosen in combinations(range(n), 4):
        if not attrs.issubset([items[i][0] for i in chosen]):
            continue
        for perm in permutations(chosen):
            if exact:
                q, cur = Fraction(1), W
                for i in perm:
                    q *= Fraction(items[i][1], cur)
                    cur -= items[i][1]
                total += q
            else:
                q, cur = 1.0, float(W)
                for i in perm:
                    q *= items[i][1] / cur
                    cur -= items[i][1]
                total += q
    return float(total)


def test_init_stats() -> None:
    print(SEP)
    print('[1] init_stats.calc_attrs_prob  <->  按定义枚举（float + Fraction 双参考）')
    print(SEP)
    main_probs, sw, w_sum = S.get_stats()
    print(f'  副词条权重({len(sw)} 条): {dict(sw)}   和 = {w_sum}')
    print(f'  主词条概率和: 沙={sum(main_probs["沙"].values())} '
          f'杯={sum(main_probs["杯"].values())} 头={sum(main_probs["头"].values())}')
    print(f'  头-暴击 = {main_probs["头"]["暴击"]}  (权重 5/50)')
    print()

    n_bad, worst = 0, 0.0
    for main_attr in ('大攻击', '暴伤', '小生命', '火伤', '小防御'):
        pool = [k for k in sw if k != main_attr]
        for k in range(5):
            for attrs in combinations(pool, k):
                fs = frozenset(attrs)
                got = S.calc_attrs_prob(main_attr, fs)
                exp = ref_comb_prob(main_attr, fs)
                exp_ex = ref_comb_prob(main_attr, fs, exact=True)
                if abs(exp - exp_ex) > 1e-12:
                    print(f'  [WARN] 两个参考实现不一致 {main_attr} {sorted(fs)}')
                d = abs(got - exp)
                worst = max(worst, d)
                if d > 1e-12:
                    n_bad += 1
                    if n_bad <= 8:
                        print(f'  [FAIL] main={main_attr!r} attrs={sorted(fs)} '
                              f'code={got!r} ref={exp!r} diff={d:.3e}')
    check(n_bad == 0, f'calc_attrs_prob 与定义式一致：{n_bad} 项不符，最大误差 {worst:.3e}')

    print()
    print('  文档内联样例复核（源码 109-110 行注释）:')
    v = S.calc_attrs_prob('大攻击', frozenset(('暴击', '暴伤', '充能')))
    print(f'    calc_attrs_prob("大攻击", ("暴击","暴伤","充能")) = {v!r}')
    print(f'    注释值 0.019447064532289948 -> '
          f'{"吻合" if abs(v - 0.019447064532289948) < 1e-15 else "不符"}')
    v0 = S.calc_attrs_prob('大攻击', frozenset())
    print(f'    calc_attrs_prob("大攻击", ()) = {v0!r}  (注释 0.9999999999999991)')

    print()
    print('  归一性 Σ all_possible_attrs_prob == 1:')
    for main_attr, attrs in (('大攻击', ('暴击', '暴伤', '充能')),
                             ('小生命', ('暴击', '暴伤', '充能', '大攻击')),
                             ('火伤', ('暴击', '暴伤', '精通', '大攻击', '充能')),
                             ('暴伤', ('暴击', '充能', '精通'))):
        d = S.all_possible_attrs_prob(main_attr, attrs)
        check(abs(sum(d.values()) - 1) < 1e-9,
              f'main={main_attr} attrs={attrs}: Σ={sum(d.values()):.15f} ({len(d)} 项)')

    print()
    print('  健壮性: attrs 传 tuple 含重复（签名声明 tuple[str, ...]，未做校验）')
    a = S.calc_attrs_prob('大攻击', ('暴击', '暴击'))
    b = S.calc_attrs_prob('大攻击', frozenset({'暴击'}))
    print(f'    ("暴击","暴击") = {a!r}   frozenset({{"暴击"}}) = {b!r}   '
          f'{"一致（内部 frozenset 去重）" if a == b else "不一致"}')

    print()
    print('  语义区分（不是 bug，但容易混）:')
    for main_attr in ('大攻击', '火伤'):
        sub = S.get_sub_probs(main_attr)
        c = S.calc_attrs_prob(main_attr, frozenset({'暴击'}))
        print(f'    main={main_attr}: get_sub_probs[暴击]={sub["暴击"]:.6f}  '
              f'calc_attrs_prob({{暴击}})={c:.6f}   '
              f'前者=附加词条池中的权重占比, 后者=终态 4 条里出现暴击的概率')


# ============================================================================
# 2. artifact_growth.calc_score_dist
# ============================================================================
# 关键结构（本脚本已实测确认）：
#   item_dist 的键   = 4 个槽位「各被强化了多少次」的多重集，Σd = init_items + 1
#   item_dist 的值   = 该多重集的排列权重之和，Σ = 4^(init_items+1)
#   槽位 v 的 d_v 次强化有 4^d_v 条等权成长序列
#   ⇒ 全空间总权重 = 4^(init_items+1) × 4^init_items = 4^(2*init_items+2)（init_rand=True）
#   ⇒ 返回的 dist[i] 中，i 直接等于「命中有效词条的次数」
def expected_score_dist(growths, get_item_dist, get_multi_growth, artifact,
                        init_items: int, init_rand: bool):
    """独立实现：复刻 calc_score_dist 的概率空间，但把「product 展开」换成
    「逐槽位同类项合并」。两者在数学上恒等，故必须与 calc_score_dist 逐格相同。
    """
    item_dist = get_item_dist(init_items, init_rand)
    init_times = sum(bool(it.weight) for it in artifact) if init_rand else 0
    n = len(artifact)
    dist: Counter = Counter()
    for counts, freq in item_dist.items():
        # 每槽位的 (分数, 命中增量) 分布；name='' 时成长值都是 0 → 分数不变，
        # 但每次强化仍有 4 条路径（保留 4^k 的权重）
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
    return dist


def test_artifact_growth() -> None:
    import artifact_growth as G

    print()
    print(SEP)
    print('[2] artifact_growth.calc_score_dist  <->  独立重写实现（稠密表逐格比对）')
    print(SEP)
    cases = [
        ('4r 暴击2+暴伤1', [G.Item('暴击', 2, None), G.Item('暴伤', 1, None),
                            G.Item('', 0, None), G.Item('', 0, None)], 4),
        ('3r 暴击2+暴伤1', [G.Item('暴击', 2, None), G.Item('暴伤', 1, None),
                            G.Item('', 0, None), G.Item('', 0, None)], 3),
        ('4r 单词条暴击', [G.Item('暴击', 2, None)] + [G.Item('', 0, None)] * 3, 4),
        ('4r 大攻击1+小攻击0.1', [G.Item('大攻击', 1, None), G.Item('小攻击', 0.1, None),
                                  G.Item('', 0, None), G.Item('', 0, None)], 4),
        ('4r 四条全有效', [G.Item('暴击', 1, None), G.Item('暴伤', 1, None),
                           G.Item('大攻击', 1, None), G.Item('充能', 1, None)], 4),
        ('3r 四条全有效', [G.Item('暴击', 1, None), G.Item('暴伤', 1, None),
                           G.Item('大攻击', 1, None), G.Item('充能', 1, None)], 3),
    ]
    for label, artifact, init_items in cases:
        total, sd = G.calc_score_dist(artifact, init_items, True)
        # 返回「稠密二维表」：dist[i] = 命中 i 次的权重，未出现的组合填 0
        code_dense: dict[tuple[float, int], int] = {}
        for score, d in sd:
            for i, f in enumerate(d):
                code_dense[(round(float(score), 9), i)] = f
        n_hits = {len(d) for _, d in sd}
        assert len(n_hits) == 1, n_hits
        n_hits = n_hits.pop()

        ref = expected_score_dist(G.growths, G.get_item_dist, G.get_multi_growth,
                                  artifact, init_items, True)
        ref_dense = {k: ref.get(k, 0) for k in code_dense}
        ref_dense.update({k: 0 for k in ref if k not in code_dense})

        n_nonzero_code = sum(1 for v in code_dense.values() if v)
        n_nonzero_ref = sum(1 for v in ref.values() if v)
        check(code_dense == ref_dense,
              f'{label}: 稠密表逐格一致（{len(code_dense)} 格 = {len(sd)} 分数 × '
              f'{n_hits} 命中档；非零格 {n_nonzero_code}）')
        check(n_nonzero_code == n_nonzero_ref,
              f'{label}: 非零格数一致（code={n_nonzero_code} ref={n_nonzero_ref}）')
        check(n_hits == init_items + 2,
              f'{label}: 命中档数 = init_items + 2 = {n_hits}')
        # total 的唯一实质作用是归一化常数：概率 = 格子值 / total
        check(total == sum(code_dense.values()),
              f'{label}: total == Σ稠密表格子 = {sum(code_dense.values())}'
              f'（归一化正确 ⇒ 概率可信）')
        check(total == 4 ** (2 + 2 * init_items + 4 * int(True)),
              f'{label}: total == 代码硬编码常量 4^(2+2*{init_items}+4*1) = '
              f'{4 ** (2 + 2 * init_items + 4)}')

    print()
    print('  score_dist 桶数组长度 (2 + init_items) 是否够用:')
    print('    hits 上界 = 强化次数 = init_items + 1，最大合法索引 = init_items + 1，')
    print('    数组长度 2 + init_items ⇒ 索引上界 init_items + 1 ⇒ 恰好够用')
    print('    （「4 条全有效」用例已触发最大值，无 IndexError）。')
    print('    但该长度依赖 init_items == len(artifact)，属隐式假设（见报告缺陷 #7）。')


def test_init_rand_false() -> None:
    import artifact_growth as G

    print()
    print(SEP)
    print('[3] init_rand=False / Item.init: 不可用分支（已记录在案的缺陷）')
    print(SEP)
    for desc, art in (('init 全为 None（工程里的实际写法）',
                       [G.Item('暴击', 1, None)] + [G.Item('', 0, None)] * 3),
                      ('init 全为 0.0', [G.Item('暴击', 1, 0.0)] + [G.Item('', 0, 0.0)] * 3)):
        try:
            t, _ = G.calc_score_dist(art, 4, init_rand=False)
            print(f'  init_rand=False ({desc}): 正常返回 total={t}')
        except AssertionError:
            print(f'  [BUG] init_rand=False ({desc}): AssertionError '
                  f'(第 83 行 total 自校验失败)')
        except TypeError as e:
            print(f'  [BUG] init_rand=False ({desc}): TypeError: {e}')
    print()
    print('  结论: init_rand=False 与 Item.init 是「从未被调用过、且一调用就崩」的分支。')
    print('        工程中全部调用均为 init_rand=True（默认值，见 main()）。')
    print('        → 移植到 web/src/core 时应直接删除该参数，改用类型显式表达。')


def test_item_dist() -> None:
    import artifact_growth as G

    print()
    print(SEP)
    print('[4] get_item_dist / get_multi_growth 自洽性')
    print(SEP)
    alloc_of = {3: {(4, 0, 0, 0): 1, (3, 1, 0, 0): 4, (2, 2, 0, 0): 6,
                    (2, 1, 1, 0): 12, (1, 1, 1, 1): 24},
                4: {(5, 0, 0, 0): 1, (4, 1, 0, 0): 5, (3, 2, 0, 0): 10,
                    (3, 1, 1, 0): 20, (2, 2, 1, 0): 30, (2, 1, 1, 1): 60}}
    print('  实测（item_dist 的键 = 各槽位「被强化的总次数」，Σd = init_items + 1）:')
    for init_items in (3, 4):
        for init_rand in (True, False):
            d = G.get_item_dist(init_items, init_rand)
            sfreq = sum(alloc_of[init_items].values())
            print(f'    get_item_dist({init_items}, init_rand={init_rand}): '
                  f'条目={len(d):3d} Σfreq={sum(d.values()):5d} '
                  f'(原始 alloc 权重和={sfreq})')
    print('    Σfreq 恒为 4^(init_items+1)：permutations 的重复元组被 dict 覆盖去重后，')
    print('    得到「多重集个数 × 其 distinct 排列数」，其和恰为 4^Σd。')
    print('    例: init_items=4 时 Σfreq = 1024 = 4^5 ✓')
    print('    ⚠ 第 59 行「if init_rand: ×4!」在 init_rand=False 时照旧执行，')
    print('      所以 init_rand 并未真正改变分布 —— 只是个恒为 True 的死开关。')

    print()
    print('  get_multi_growth: i 次强化的合并同类项权重和 == 4^i')
    for name in ('暴击', '暴伤', '小攻击', '精通'):
        ok = all(sum(t for _, t in line) == 4 ** i
                 for i, line in enumerate(G.get_multi_growth(name)))
        check(ok, f'get_multi_growth({name!r}) i=0..6 权重和 == 4^i')

    print()
    print('  分数键 f"{score:.1f}" 的碰撞风险:')
    print('    现有 growths 的值都是 0.1 的整数倍 ⇒ 暂不碰撞')
    print(f'    但 0.1 不是二进制精确小数: 0.1*3 == 0.3 -> {0.1 * 3 == 0.3}，'
          f'f"{{0.1*3:.1f}}" = {f"{0.1 * 3:.1f}"}')
    print('    若权重改为 1/3、1/7 等，:.1f 归并会把不同得分静默合并。')


# ============================================================================
# 5. 跨模块一致性
# ============================================================================
def test_cross_module() -> None:
    print()
    print(SEP)
    print('[5] 跨模块一致性: 胚子得分分布（只看副词条组合，不含强化成长）')
    print(SEP)
    main_attr = '大攻击'
    scores = {'暴击': 3, '暴伤': 3, '精通': 2, '大攻击': 2, '充能': 1}
    comb_prob = S.all_possible_attrs_prob(main_attr, tuple(scores))
    by_score: dict[int, float] = {}
    for comb, p in comb_prob.items():
        s = sum(scores.get(a, 0) for a in comb)
        by_score[s] = by_score.get(s, 0.0) + p

    _, sw, _ = S.get_stats()
    pool = {k: v for k, v in sw.items() if k != main_attr}
    names = list(pool)
    W = sum(pool.values())
    ref: dict[int, Fraction] = {}
    for chosen in combinations(names, 4):
        for perm in permutations(chosen):
            q, cur = Fraction(1), W
            for a in perm:
                q *= Fraction(pool[a], cur)
                cur -= pool[a]
            s = sum(scores.get(a, 0) for a in chosen)
            ref[s] = ref.get(s, Fraction(0)) + q

    print(f'  主词条={main_attr}  权重={scores}')
    print(f'  {"得分":>4} {"init_stats":>14} {"独立枚举":>14}')
    for s in sorted(set(ref) | set(by_score)):
        print(f'  {s:>4} {by_score.get(s, 0.0):>14.6f} {float(ref.get(s, 0)):>14.6f}')
    ok = all(abs(float(ref.get(s, 0)) - by_score.get(s, 0.0)) < 1e-12
             for s in set(ref) | set(by_score))
    check(ok, f'Σ={sum(by_score.values()):.12f}，两路结果完全一致')


if __name__ == '__main__':
    test_init_stats()
    test_artifact_growth()
    test_init_rand_false()
    test_item_dist()
    test_cross_module()
    print()
    print(SEP)
    print(f'汇总: {len(FAILS)} 项 FAIL')
    for f in FAILS:
        print(f'  - {f}')
    print(SEP)
    sys.exit(1 if FAILS else 0)
