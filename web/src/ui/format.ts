/** 数字与文案格式化 */

/** 概率：小值用更多位小数，避免显示成 0 */
export function pct(p: number, digits?: number): string {
  if (p === 0) return '0%';
  if (p >= 0.01) return `${(p * 100).toFixed(digits ?? 2)}%`;
  if (p >= 0.0001) return `${(p * 100).toFixed(4)}%`;
  return `${(p * 100).toExponential(2)}%`;
}

/**
 * **轴标号**用的百分比：小数位由刻度间隔决定，同一根轴上格式统一。
 *
 * 不能直接用 `pct`：它在小概率那档会切到 4 位小数，于是同一根轴上会出现
 * `1%` 与 `0.5000%` 并排（`niceAxis` 给出 0.5% 步长时就会遇到）。
 * 也不能一律 `toFixed(0)`：0.5% 会被写成 `1%`，与真正的 1% 撞在一起。
 * 所以按「几位小数才写得下这个步长」来定，`0.5%` → `0.5%`、`2%` → `2%`。
 */
export function pctTick(p: number, step: number): string {
  const stepPct = Math.abs(step) * 100;
  let digits = 0;
  for (; digits < 4; digits++) {
    if (Math.abs(Number(stepPct.toFixed(digits)) - stepPct) < 1e-9) break;
  }
  return `${(p * 100).toFixed(digits)}%`;
}

/** 「1 / p」的直观表达：大约多少次里出一次 */
export function oneIn(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1.05) return '必然';
  if (n < 10) return `约 ${n.toFixed(1)} 次`;
  if (n < 1e4) return `约 ${Math.round(n).toLocaleString('zh-CN')} 次`;
  if (n < 1e8) return `约 ${(n / 1e4).toFixed(1)} 万次`;
  return `约 ${(n / 1e8).toFixed(1)} 亿次`;
}

/** 分数：保留一位小数，整数也显示 .0 */
export function score(x: number): string {
  return x.toFixed(1);
}

/** 权重：0.5 / 1 / 0.1 之类，去掉多余的 0 */
export function weight(x: number): string {
  return String(Number(x.toFixed(3)));
}
