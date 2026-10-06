# src/artifact_growth — 旧 Python 代码归档

[TOC]

原项目根目录下的 4 个脚本，逻辑已/将移植到 `web/src/core/`。
**本目录只作前端移植的验收基准，不再维护**；数值实现未作改动。

| 文件 | 作用 | 移植目标 |
|---|---|---|
| `artifact_growth.py` | 强化后得分分布（PMF/CDF/柱状图 + xlsx） | `web/src/core/growth.ts`、`web/src/render/` |
| `init_stats.py` | 副词条组合概率、胚子质量分布 | `web/src/core/combo.ts`、`web/src/render/` |
| `better_than.py` | 「超过 X 分」概率（经 xlsx 回读） | `web/src/core/` 直接切片，**不再经 xlsx** |
| `literals.py` | 已删除（全项目零引用，内容与实际权重表不一致） | — |

## 怎么用

`tools/` 下的验收脚本依赖本目录：

```powershell
cd <项目根目录>
& 'D:\Software\miniconda3\envs\ai\python.exe' -X utf8 tools/verify_math.py
```

- `tools/verify_math.py` — 数学正确性交叉验证，**退出码 0 = 通过**
- `tools/bench.py` — 性能基准
- `tools/recompute_filler.py` — 第 4 词条池子口径核算

## 关键结论（详见 docs/ai-output/1-refactor/01-code-review.md）

- 两个模块的数学都已用独立重写的参考实现交叉验证通过。
- 3 词条与 4 词条两种场景建模都正确。
- 唯一真实的模型简化：胚子掉落时的初始强化档位从未被建模。
- `init_rand=False` / `Item.init` 是不可用的死分支（一调用就崩）。

## 改动说明

为便于归档阅读，仅做了**非语义**调整：

- 统一引号为单引号、补齐空行与行宽。
- `init_stats.py` 的 `get_stats` 注释修正（原文「或 dict(weights) 拷贝内层」与代码不符）。
- `plot_substat_heatmap` 补上 `plt.close()`（原版缺失，缺陷 #15）。
- 删除只被注释掉的 `main()` / `_test()` 调用入口。
- 在若干处补注「缺陷 #N」，指向 code review。
