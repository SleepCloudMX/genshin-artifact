"""从前端移植基准（src/artifact_growth/）导出 JSON 固件，供 vitest 对拍。

运行（在项目根目录）：
    python -X utf8 tools/gen_fixtures.py

产物写入 web/src/core/__fixtures__/：
    stats.json          —— 副词条权重、主词条概率表
    combo.json          —— calc_attrs_prob 全组合、all_possible_attrs_prob 抽样
    growth.json         —— calc_score_dist 在若干用例上的稠密表（权重与概率）
    quality.json        —— 胚子得分分布（init_stats 侧）
"""
from __future__ import annotations

import json
import shutil
import sys
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARC = ROOT / 'src' / 'artifact_growth'
sys.path.insert(0, str(ARC))

import artifact_growth as AG  # noqa: E402
import init_stats as IS  # noqa: E402

OUT = ROOT / 'web' / 'src' / 'core' / '__fixtures__'

MAIN_ATTRS_PROBED = ['大攻击', '暴伤', '小生命', '火伤', '小防御', '治疗', '爆伤']


def gen_stats() -> dict:
    main_probs, sub_weights, sub_w_sum = IS.get_stats()
    return {
        'subWeights': dict(sub_weights),
        'subWeightSum': sub_w_sum,
        'mainProbs': {pos: dict(v) for pos, v in main_probs.items()},
    }


def gen_combo() -> dict:
    _, sub_weights, _ = IS.get_stats()
    subs = list(sub_weights)

    # 1) calc_attrs_prob：每个主词条 × 词条数 0..4 的全部组合
    attrs_prob: list[dict] = []
    for main_attr in MAIN_ATTRS_PROBED:
        pool = [k for k in subs if k != main_attr]
        for n in range(5):
            for attrs in combinations(pool, n):
                attrs_prob.append({
                    'mainAttr': main_attr,
                    'attrs': sorted(attrs),
                    'p': IS.calc_attrs_prob(main_attr, frozenset(attrs)),
                })

    # 2) calc_exact_4_combo_prob：全部 4 子集
    exact: list[dict] = []
    for main_attr in ('大攻击', '火伤'):
        pool = [k for k in subs if k != main_attr]
        for combo in combinations(pool, 4):
            exact.append({
                'mainAttr': main_attr,
                'combo': sorted(combo),
                'p': IS.calc_exact_4_combo_prob(main_attr, frozenset(combo)),
            })

    # 3) all_possible_attrs_prob：几个有代表性的有效词条集合
    sets = [
        ('大攻击', ['暴击', '暴伤', '充能']),
        ('大攻击', ['暴击', '暴伤', '精通', '大攻击', '充能']),
        ('小生命', ['暴击', '暴伤', '充能', '大攻击']),
        ('火伤', ['暴击', '暴伤', '精通', '大攻击', '充能']),
        ('暴伤', ['暴击', '充能', '精通']),
    ]
    all_prob: list[dict] = []
    for main_attr, attrs in sets:
        d = IS.all_possible_attrs_prob(main_attr, tuple(attrs))
        all_prob.append({
            'mainAttr': main_attr,
            'attrs': attrs,
            'entries': [{'combo': sorted(c), 'p': p} for c, p in d.items()],
        })

    return {'attrsProb': attrs_prob, 'exact4': exact, 'allPossible': all_prob}


GROWTH_CASES = [
    ('4r-crit-dmg', [('暴击', 2), ('暴伤', 1), ('', 0), ('', 0)], 4),
    ('3r-crit-dmg', [('暴击', 2), ('暴伤', 1), ('', 0), ('', 0)], 3),
    ('4r-crit-only', [('暴击', 2), ('', 0), ('', 0), ('', 0)], 4),
    ('4r-atk-small', [('大攻击', 1), ('小攻击', 0.1), ('', 0), ('', 0)], 4),
    ('4r-all-four', [('暴击', 1), ('暴伤', 1), ('大攻击', 1), ('充能', 1)], 4),
    ('3r-all-four', [('暴击', 1), ('暴伤', 1), ('大攻击', 1), ('充能', 1)], 3),
    ('4r-hp-flat', [('大生命', 1), ('小生命', 0.01), ('', 0), ('', 0)], 4),
]


def gen_growth() -> dict:
    cases = []
    for name, spec, init_items in GROWTH_CASES:
        artifact = [AG.Item(n, w, None) for n, w in spec]
        total, sd = AG.calc_score_dist(artifact, init_items, True)
        multi_growth: dict[str, list] = {}
        for slot_name, _ in spec:
            if slot_name not in multi_growth:
                # 按 i（0..6 次成长）分档：[{g, t}, ...]
                multi_growth[slot_name] = [
                    [{'g': g, 't': t} for g, t in line]
                    for line in AG.get_multi_growth(slot_name)
                ]
        cases.append({
            'name': name,
            'slots': [{'name': n, 'weight': w} for n, w in spec],
            'initItems': init_items,
            'total': total,
            # 稠密表：每行 = 一个得分，列 = 命中 i 次的权重（dist[i] 的 i 就是命中数）
            'dense': [[float(score), dist] for score, dist in sd],
            'multiGrowth': multi_growth,
        })
    return {'cases': cases}


QUALITY_CASES = [
    ('大攻击', {'暴击': 3, '暴伤': 3, '精通': 2, '大攻击': 2, '充能': 1}),
    ('暴伤', {'暴击': 3, '精通': 2, '大攻击': 2, '充能': 1}),
    ('火伤', {'暴击': 3, '暴伤': 3, '精通': 2, '大攻击': 2, '充能': 1}),
    ('小生命', {'暴击': 3, '暴伤': 3, '充能': 1}),
]


def gen_quality() -> dict:
    """胚子得分分布：按得分聚合 all_possible_attrs_prob 的概率。"""
    cases = []
    for main_attr, weights in QUALITY_CASES:
        comb_prob = IS.all_possible_attrs_prob(main_attr, tuple(weights))
        by_score: dict[int, float] = {}
        for comb, p in comb_prob.items():
            s = sum(weights.get(a, 0) for a in comb)
            by_score[s] = by_score.get(s, 0.0) + p
        cases.append({
            'mainAttr': main_attr,
            'weights': weights,
            'combos': [{'combo': sorted(c), 'p': p} for c, p in comb_prob.items()],
            'byScore': {str(k): v for k, v in sorted(by_score.items())},
        })
    return {'cases': cases}


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    files = {
        'stats.json': gen_stats(),
        'combo.json': gen_combo(),
        'growth.json': gen_growth(),
        'quality.json': gen_quality(),
    }
    for name, data in files.items():
        p = OUT / name
        p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'{name:16s} {p.stat().st_size:>9,d} bytes  '
              f'({len(json.dumps(data, ensure_ascii=False))} chars)')
    print(f'\n写入 {OUT}')


if __name__ == '__main__':
    main()
