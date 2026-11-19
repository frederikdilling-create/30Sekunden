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
// Every displayed contingency table uses groups as rows and quality as columns.
export function contingencyMatrix({ a, b, c, d }) {
  return [
    [a, c, a + c],
    [b, d, b + d],
    [a + b, c + d, a + b + c + d],
  ];
}
// Marginal totals are included. Empty denominators are undefined, not zero.
export function frequencies(counts, mode = "total") {
  const matrix = contingencyMatrix(counts);
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
// Condition on both margins. Row membership is the population characteristic;
// the selected quality column supplies the sample, for any of the four cells.
export function fisherParameters(t, group = "student", quality = "good") {
  if (!["student", "staff"].includes(group))
    throw new RangeError("Unbekannte Gruppe.");
  if (!["good", "bad"].includes(quality))
    throw new RangeError("Unbekannte Schätzqualität.");
  if (
    ![t.a, t.b, t.c, t.d].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    throw new RangeError(
      "Die Vierfeldertafel benötigt nichtnegative ganze Häufigkeiten.",
    );
  const N = t.a + t.b + t.c + t.d,
    nStudent = t.a + t.c,
    nStaff = t.b + t.d;
  const nGood = t.a + t.b,
    nBad = t.c + t.d;
  const K = group === "student" ? nStudent : nStaff;
  const n = quality === "good" ? nGood : nBad;
  const cell =
    group === "student"
      ? quality === "good"
        ? "a"
        : "c"
      : quality === "good"
        ? "b"
        : "d";
  return {
    N,
    K,
    n,
    nStudent,
    nStaff,
    nGood,
    nBad,
    group,
    quality,
    cell,
    observed: t[cell],
    min: Math.max(0, n - (N - K)),
    max: Math.min(n, K),
    expected: N ? (n * K) / N : null,
    increasingWithStudentSuccess:
      (group === "student") === (quality === "good"),
    testable: nStudent > 0 && nStaff > 0,
    informative: nStudent > 0 && nStaff > 0 && nGood > 0 && nBad > 0,
  };
}
export function fisherTableAt(model, k) {
  if (!Number.isInteger(k) || k < model.min || k > model.max)
    throw new RangeError(
      "Diese Tafel ist bei den festen Randsummen nicht möglich.",
    );
  let a;
  if (model.quality === "good")
    a = model.group === "student" ? k : model.nGood - k;
  else
    a =
      model.group === "student"
        ? model.nStudent - k
        : model.nStudent - model.nBad + k;
  const b = model.nGood - a;
  return { a, b, c: model.nStudent - a, d: model.nStaff - b };
}
// Express the SAME hypothetical table and event using a different inner cell.
export function reparameterizeFisher(model, selection, group, quality) {
  const next = fisherParameters(
    fisherTableAt(model, model.observed),
    group,
    quality,
  );
  const transform = (k) => fisherTableAt(model, k)[next.cell];
  const flips =
    model.increasingWithStudentSuccess !== next.increasingWithStudentSuccess;
  const first = transform(selection.lower ?? model.min),
    last = transform(selection.upper ?? model.max);
  const kind =
    flips && selection.kind === "left"
      ? "right"
      : flips && selection.kind === "right"
        ? "left"
        : selection.kind;
  return {
    x: transform(selection.x ?? model.observed),
    lower: Math.min(first, last),
    upper: Math.max(first, last),
    kind,
  };
}
function logSum(values) {
  if (!values.length) return -Infinity;
  const maximum = values.reduce(
    (maximum, x) => Math.max(maximum, x),
    -Infinity,
  );
  return (
    maximum +
    Math.log(values.reduce((sum, x) => sum + Math.exp(x - maximum), 0))
  );
}
export function hypergeometric(t, group = "student", quality = "good") {
  const model = fisherParameters(t, group, quality),
    { N, K, n, min, max } = model;
  // A recurrence and log-sum-exp avoid factorial overflow and preserve tiny tails.
  let logP = logChoose(K, min) + logChoose(N - K, n - min) - logChoose(N, n);
  const points = [];
  for (let x = min; x <= max; x++) {
    points.push({ x, logProbability: logP });
    if (x < max)
      logP +=
        Math.log(K - x) +
        Math.log(n - x) -
        Math.log(x + 1) -
        Math.log(N - K - n + x + 1);
  }
  const normalizer = logSum(points.map((p) => p.logProbability));
  for (const point of points) {
    point.logProbability -= normalizer;
    point.probability = Math.exp(point.logProbability);
  }
  return { ...model, points };
}
export function probabilityEvent(
  model,
  {
    kind = "single",
    x = model.observed,
    lower = model.min,
    upper = model.max,
    side = "two",
  } = {},
) {
  const observed = model.points.find((p) => p.x === model.observed);
  if (!["single", "left", "right", "interval", "fisher"].includes(kind))
    throw new RangeError("Unbekanntes Ereignis.");
  const selected = model.points.filter((p) => {
    if (kind === "single") return p.x === x;
    if (kind === "left") return p.x <= x;
    if (kind === "right") return p.x >= x;
    if (kind === "interval") return p.x >= lower && p.x <= upper;
    // Test direction always refers to GOOD-estimate rates: student − staff.
    // Switching either the group or quality reverses the selected-cell scale.
    if (side === "left")
      return model.increasingWithStudentSuccess
        ? p.x <= model.observed
        : p.x >= model.observed;
    if (side === "right")
      return model.increasingWithStudentSuccess
        ? p.x >= model.observed
        : p.x <= model.observed;
    return p.logProbability <= observed.logProbability + 1e-10;
  });
  const logProbability = logSum(selected.map((p) => p.logProbability));
  return {
    xs: selected.map((p) => p.x),
    logProbability,
    probability: Math.min(1, Math.exp(logProbability)),
  };
}
export function fisher(t, side = "two") {
  const model = hypergeometric(t);
  return model.testable
    ? probabilityEvent(model, { kind: "fisher", side }).probability
    : null;
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
