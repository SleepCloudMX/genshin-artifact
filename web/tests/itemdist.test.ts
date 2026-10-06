/**
 * itemDist（各槽位强化次数的分配权重）与归档逐项对拍。
 * 这一层是 growth 的地基，单独验一次能让后续排错快得多。
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { itemDist } from '../src/core/growth';

const PY = 'D:\\Software\\miniconda3\\envs\\ai\\python.exe';
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function archiveItemDist(): Record<string, { keys: string[]; freqs: number[] }> {
  const script = `
import sys, json
sys.path.insert(0, r"${REPO_ROOT}\\src\\artifact_growth")
import artifact_growth as AG
res = {}
for n in (3, 4):
    d = AG.get_item_dist(n, True)
    res[str(n)] = {"keys": [",".join(map(str, k)) for k in d], "freqs": list(d.values())}
print(json.dumps(res))
`;
  const out = execFileSync(PY, ['-X', 'utf8', '-c', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

describe('itemDist 对拍归档', () => {
  const ref = archiveItemDist();

  for (const n of [3, 4] as const) {
    it(`n=${n} 的键与权重与归档完全一致`, () => {
      const mine = itemDist(n);
      const refMap = new Map<string, number>();
      ref[String(n)]!.keys.forEach((k, i) => refMap.set(k, ref[String(n)]!.freqs[i]!));

      expect(mine.size).toBe(refMap.size);
      for (const [k, v] of mine) {
        expect(refMap.get(k), `key ${k}`).toBe(v);
      }
    });
  }

  it('权重之和 = 4^(n+1)', () => {
    for (const n of [3, 4] as const) {
      const sum = [...itemDist(n).values()].reduce((s, v) => s + v, 0);
      expect(sum).toBe(4 ** (n + 1));
    }
  });

  it('每个键的 Σd 恒定（= 词条数 + 5）', () => {
    const sumOf = (n: 3 | 4) =>
      new Set(
        [...itemDist(n).keys()].map((k) =>
          k.split(',').reduce((s, x) => s + Number(x), 0),
        ),
      );
    expect(sumOf(3)).toEqual(new Set([8]));
    expect(sumOf(4)).toEqual(new Set([9]));
  });
});
