export const target = 30;
export const good = (x, t) => Math.abs(x - 30) <= t + 1e-10;
export function select(rows, mode = "first") {
  const r = rows.filter((x) => x.valid).sort((a, b) => a.attempt - b.attempt);
  if (mode === "all") return r;
  const m = new Map();
  for (const x of r) {
    const p = m.get(x.participant);
    if (
      !p ||
      mode === "last" ||
      (mode === "best" &&
        Math.abs(x.seconds - 30) < Math.abs(p.seconds - 30)) ||
      (mode === "worst" && Math.abs(x.seconds - 30) > Math.abs(p.seconds - 30))
    )
      m.set(x.participant, x);
  }
  return [...m.values()];
}
export function quantile(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((a, b) => a - b),
    i = (s.length - 1) * p,
    l = Math.floor(i);
  return s[l] + (s[Math.ceil(i)] - s[l]) * (i - l);
}
export function describe(rows) {
  const a = rows.map((x) => x.seconds),
    n = a.length;
  if (!n)
    return {
      persons: 0,
      n: 0,
      mean: null,
      median: null,
      min: null,
      max: null,
      range: null,
      q1: null,
      q3: null,
      iqr: null,
      sd: null,
      bias: null,
      mae: null,
      medae: null,
      under: null,
      over: null,
    };
  const mean = a.reduce((s, x) => s + x, 0) / n,
    q1 = quantile(a, 0.25),
    q3 = quantile(a, 0.75);
  return {
    persons: new Set(rows.map((x) => x.participant)).size,
    n,
    mean,
    median: quantile(a, 0.5),
    min: Math.min(...a),
    max: Math.max(...a),
    range: Math.max(...a) - Math.min(...a),
    q1,
    q3,
    iqr: q3 - q1,
    sd:
      n > 1
        ? Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))
        : null,
    bias: mean - 30,
    mae: a.reduce((s, x) => s + Math.abs(x - 30), 0) / n,
    medae: quantile(
      a.map((x) => Math.abs(x - 30)),
      0.5,
    ),
    under: a.filter((x) => x < 30).length / n,
    over: a.filter((x) => x > 30).length / n,
  };
}
export function table(rows, t) {
  const a = rows.filter((x) => x.group === "student"),
    b = rows.filter((x) => x.group === "staff");
  return {
    a: a.filter((x) => good(x.seconds, t)).length,
    b: b.filter((x) => good(x.seconds, t)).length,
    c: a.filter((x) => !good(x.seconds, t)).length,
    d: b.filter((x) => !good(x.seconds, t)).length,
  };
}
// Marginal totals are included. Empty denominators are undefined, not zero.
export function frequencies(counts, mode = "total") {
  const { a, b, c, d } = counts;
  const matrix = [
    [a, b, a + b],
    [c, d, c + d],
    [a + c, b + d, a + b + c + d],
  ];
  return matrix.map((row, i) =>
    row.map((value, j) => {
      const denominator =
        mode === "column"
          ? matrix[2][j]
          : mode === "row"
            ? matrix[i][2]
            : matrix[2][2];
      return denominator ? value / denominator : null;
    }),
  );
}
export const difference = ({ a, b, c, d }) =>
  a + c && b + d ? a / (a + c) - b / (b + d) : null;
export function extreme(x, obs, side = "two") {
  return side === "left"
    ? x <= obs + 1e-10
    : side === "right"
      ? x >= obs - 1e-10
      : Math.abs(x) >= Math.abs(obs) - 1e-10;
}
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= Math.min(k, n - k); i++)
    s += Math.log(n - i + 1) - Math.log(i);
  return s;
}
export function fisher(t, side = "two") {
  const { a, b, c, d } = t,
    n = a + b + c + d,
    n1 = a + c,
    k = a + b;
  if (!n1 || n1 === n) return null;
  const lp = (x) =>
      logChoose(k, x) + logChoose(n - k, n1 - x) - logChoose(n, n1),
    obs = lp(a);
  let p = 0;
  for (let x = Math.max(0, n1 - (n - k)); x <= Math.min(n1, k); x++)
    if (
      side === "left"
        ? x <= a
        : side === "right"
          ? x >= a
          : lp(x) <= obs + 1e-10
    )
      p += Math.exp(lp(x));
  return Math.min(1, p);
}
export function permute(t, rng = Math.random) {
  const n1 = t.a + t.c,
    n2 = t.b + t.d,
    n = n1 + n2,
    k = t.a + t.b;
  if (!n1 || !n2) return null;
  let remaining = k,
    a = 0;
  for (let i = 0; i < n1; i++)
    if (rng() < remaining / (n - i)) {
      a++;
      remaining--;
    }
  return { a, b: k - a, c: n1 - a, d: n2 - (k - a) };
}
export function ranking(rows) {
  const m = new Map();
  for (const r of rows.filter((x) => x.valid)) {
    const p = m.get(r.participant);
    if (!p || Math.abs(r.seconds - 30) < Math.abs(p.seconds - 30))
      m.set(r.participant, r);
  }
  return [...m.values()].sort(
    (a, b) =>
      Math.abs(a.seconds - 30) - Math.abs(b.seconds - 30) ||
      a.created.localeCompare(b.created),
  );
}
