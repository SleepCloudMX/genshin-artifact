"""重算：3 词条胚子「已可见的第 4 词条」其实是有效词条的概率。

修正后的语义（用户说明）：
  · 3 词条胚子的第 4 词条在 2025 版本后**掉落时就可见**，不是升级才揭晓；
  · 因此当用户标注「暴击, 暴伤, '', ''」时，意思是
      - 已知 3 个词条 = 暴击 + 暴伤 + 某个**非有效**词条
      - 第 4 个词条 = 某个**非有效**词条
    即：明确知道「只有这 2 个有效词条」的情况；
  · 所以第 4 词条必须从「排除已知 3 个词条」后的池子里抽。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARC = ROOT / 'src' / 'artifact_growth'      # 归档的参考实现
sys.path.insert(0, str(ARC))

import init_stats as S  # noqa: E402

SEP = '=' * 78
_, sw, _ = S.get_stats()
print(SEP)
print('[1] 3 词条胚子：第 4 词条落在有效词条上的概率')
print('    池子 = 全部 10 个副词条 − 主词条 − 已知的 3 个词条')
print(SEP)
print()

# (主词条, 已知的 3 个词条, 有效词条集合, 说明)
scenarios = [
    ('暴击', ('暴击', '暴伤', ''), {'暴击', '暴伤'},
     '双暴有效（原 3r-暴击-爆伤 用法）'),
    ('暴击', ('暴击', '', ''), {'暴击'},
     '单词条有效（原 4r-暴击 用法）'),
    ('暴击', ('暴击', '暴伤', '大攻击'), {'暴击', '暴伤', '大攻击'},
     '三有效词条'),
    ('暴击', ('暴击', '暴伤', ''), {'暴击', '暴伤', '大攻击', '精通', '充能'},
     '双暴出坯 + 5 词条评分'),
    ('火伤', ('暴击', '暴伤', ''), {'暴击', '暴伤'},
     '属性杯 + 双暴有效'),
    ('大攻击', ('暴击', '暴伤', ''), {'暴击', '暴伤'},
     '攻击沙 + 双暴有效'),
]

for main_attr, known3, valid, desc in scenarios:
    excluded = {main_attr} | {k for k in known3 if k}
    pool = {k: v for k, v in sw.items() if k not in excluded}
    W = sum(pool.values())
    p = sum(v for k, v in pool.items() if k in valid) / W
    print(f'  {desc}')
    print(f'    主词条={main_attr}  已知 3 词条={[k for k in known3 if k] or ["(仅主词条外的两个)"]}')
    print(f'    池子（{len(pool)} 条）={list(pool)}')
    print(f'    池权重和 = {W}')
    print(f'    → P(第 4 词条 ∈ 有效集) = {p:.6f}  = {p:.2%}')
    print()

print(SEP)
print('[2] 对照：如果把第 4 词条当成「已知 3 词条中那个占位符」的两种解读')
print(SEP)
main_attr = '暴击'
valid = {'暴击', '暴伤'}
# 解读一（修正后）：第 4 词条从扣除已知 3 词条后的池子里抽
excluded = {main_attr, '暴击', '暴伤'}
pool1 = {k: v for k, v in sw.items() if k not in excluded}
p1 = sum(v for k, v in pool1.items() if k in valid) / sum(pool1.values())
# 解读二（我上一版错误）：第 4 词条只排除主词条
pool2 = {k: v for k, v in sw.items() if k != main_attr}
p2 = sum(v for k, v in pool2.items() if k in valid) / sum(pool2.values())
print(f'  解读一（正确）：排除主词条 + 已知 3 词条 → 池子 {len(pool1)} 条 → p = {p1:.6f} ({p1:.2%})')
print(f'  解读二（错误）：只排除主词条           → 池子 {len(pool2)} 条 → p = {p2:.6f} ({p2:.2%})')
print()
print('  二者差异极大：因为「已知 3 词条 = 暴击 + 暴伤 + 某个非有效词条」这一条件')
print('  已经把暴击和暴伤从池子里拿掉了 —— 它们不可能再出现在第 4 位。')
print()
print('  这就是"明确知道只有 2 个有效词条"的含义：第 4 词条必然是第 3 个非有效词条。')
