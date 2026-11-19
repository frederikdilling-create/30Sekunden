import test from "node:test";
import assert from "node:assert/strict";
import {
  fisherParameters,
  fisherTableAt,
  hypergeometric,
  probabilityEvent,
  fisher,
  reparameterizeFisher,
  contingencyMatrix,
} from "../public/stats.js";
import {
  probabilityText,
  renderFisherLab,
  fisherDecision,
} from "../public/fisher-lab.js";
const close = (a, b, tolerance = 1e-12) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function choose(n, k) {
  if (k < 0 || k > n) return 0n;
  let c = 1n;
  for (let i = 1; i <= Math.min(k, n - k); i++)
    c = (c * BigInt(n - i + 1)) / BigInt(i);
  return c;
}

test("Hypergeometrie gegen exakte ganzzahlige Kombinatorik für alle kleinen Vierfeldertafeln", () => {
  for (let a = 0; a <= 5; a++)
    for (let b = 0; b <= 5; b++)
      for (let c = 0; c <= 5; c++)
        for (let d = 0; d <= 5; d++) {
          const t = { a, b, c, d };
          for (const group of ["student", "staff"])
            for (const quality of ["good", "bad"]) {
              const model = hypergeometric(t, group, quality),
                denominator = choose(model.N, model.n);
              let total = 0;
              for (const point of model.points) {
                const exact =
                  Number(
                    choose(model.K, point.x) *
                      choose(model.N - model.K, model.n - point.x),
                  ) / Number(denominator);
                close(point.probability, exact);
                total += point.probability;
                const z = fisherTableAt(model, point.x);
                assert.equal(z[model.cell], point.x);
                const previousProbability =
                  Number(choose(a + b, z.a) * choose(c + d, a + c - z.a)) /
                  Number(choose(a + b + c + d, a + c));
                close(point.probability, previousProbability);
                assert.equal(z.a + z.c, a + c);
                assert.equal(z.b + z.d, b + d);
                assert.equal(z.a + z.b, a + b);
                assert.equal(z.c + z.d, c + d);
                assert.ok(
                  Object.values(z).every((x) => x >= 0 && Number.isInteger(x)),
                );
              }
              close(total, 1);
              if (model.testable) {
                const observed =
                  choose(model.K, model.observed) *
                  choose(model.N - model.K, model.n - model.observed);
                for (const side of ["two", "left", "right"]) {
                  let numerator = 0n;
                  for (const p of model.points) {
                    const v =
                      choose(model.K, p.x) *
                      choose(model.N - model.K, model.n - p.x);
                    const candidate = fisherTableAt(model, p.x);
                    const included =
                      side === "two"
                        ? v <= observed
                        : side === "left"
                          ? candidate.a <= t.a
                          : candidate.a >= t.a;
                    if (included) numerator += v;
                  }
                  close(
                    probabilityEvent(model, { kind: "fisher", side })
                      .probability,
                    Number(numerator) / Number(denominator),
                  );
                  close(
                    fisher(t, side),
                    Number(numerator) / Number(denominator),
                  );
                }
              } else assert.equal(fisher(t), null);
            }
        }
});

test("Kumulierte Ereignisse einschließlich ihrer Grenzen und frei wählbarer Intervalle", () => {
  const m = hypergeometric({ a: 1, b: 2, c: 7, d: 1 });
  assert.deepEqual(
    m.points.map((p) => p.x),
    [0, 1, 2, 3],
  );
  close(probabilityEvent(m, { kind: "single", x: 1 }).probability, 24 / 165);
  close(probabilityEvent(m, { kind: "left", x: 1 }).probability, 25 / 165);
  close(probabilityEvent(m, { kind: "right", x: 2 }).probability, 140 / 165);
  close(
    probabilityEvent(m, { kind: "interval", lower: 1, upper: 2 }).probability,
    108 / 165,
  );
  close(
    probabilityEvent(m, { kind: "fisher", side: "two" }).probability,
    25 / 165,
  );
  assert.notEqual(
    probabilityEvent(m, { kind: "fisher", side: "two" }).probability,
    2 * probabilityEvent(m, { kind: "left", x: 1 }).probability,
  );
  assert.deepEqual(probabilityEvent(m, { kind: "fisher" }).xs, [0, 1]);
  assert.equal(
    probabilityEvent(m, { kind: "interval", lower: 5, upper: 6 }).probability,
    0,
  );
  assert.throws(() => fisherTableAt(m, 4), RangeError);
  assert.throws(() => fisherTableAt(m, 0.5), RangeError);
  assert.throws(
    () => fisherParameters({ a: -1, b: 2, c: 3, d: 4 }),
    RangeError,
  );
});

test("Bekannter Fisher-Referenzwert, Gruppentausch und unveränderliche beobachtete Tafel", () => {
  const counts = { a: 1, b: 9, c: 11, d: 3 };
  const m = hypergeometric(counts),
    mirror = hypergeometric(counts, "staff");
  close(
    probabilityEvent(m, { kind: "fisher" }).probability,
    0.0027594561852200836,
  );
  assert.deepEqual(probabilityEvent(m, { kind: "fisher" }).xs, [0, 1, 9, 10]);
  close(
    probabilityEvent(m, { kind: "fisher", side: "left" }).probability,
    0.0013797280926100418,
  );
  for (const side of ["two", "left", "right"])
    close(
      probabilityEvent(m, { kind: "fisher", side }).probability,
      probabilityEvent(mirror, { kind: "fisher", side }).probability,
    );
  const original = { ...counts };
  fisherTableAt(m, 5);
  assert.deepEqual(counts, original);
  const before = probabilityEvent(m, { kind: "fisher" }).probability;
  probabilityEvent(m, { kind: "single", x: 5 });
  close(probabilityEvent(m, { kind: "fisher" }).probability, before);
});

test("Leere Gruppen, konstante Qualität und numerisch sehr kleine Wahrscheinlichkeiten", () => {
  assert.equal(hypergeometric({ a: 0, b: 0, c: 0, d: 0 }).testable, false);
  assert.equal(fisher({ a: 0, b: 4, c: 0, d: 6 }), null);
  assert.equal(fisher({ a: 5, b: 4, c: 0, d: 0 }), 1);
  assert.equal(fisher({ a: 0, b: 0, c: 5, d: 4 }), 1);
  const model = hypergeometric({ a: 0, b: 2000, c: 2000, d: 0 });
  close(
    model.points.reduce((sum, p) => sum + p.probability, 0),
    1,
    1e-11,
  );
  const exact = probabilityEvent(model, { kind: "fisher" });
  assert.ok(Number.isFinite(exact.logProbability));
  assert.ok(exact.logProbability < -1000);
  assert.match(
    probabilityText(exact.probability, exact.logProbability),
    /× 10\^-/,
  );
  assert.notEqual(
    probabilityText(exact.probability, exact.logProbability),
    "0",
  );
});

test("Didaktische Darstellung trennt Einzelereignis, Ereignissumme und Testentscheidung", () => {
  const settings = {
    mode: "first",
    tolerance: 5,
    lockedTolerance: null,
    side: "two",
    alpha: 0.05,
    fisherGroup: "student",
    fisherStep: 1,
    fisherEvent: "single",
  };
  const counts = { a: 1, b: 9, c: 11, d: 3 };
  const initial = renderFisherLab({ counts, settings, admin: true });
  assert.ok(!initial.includes('data-probability="fisher"'));
  assert.ok(!initial.includes('data-setting="fisherX"'));
  const point = renderFisherLab({
    counts,
    settings: { ...settings, fisherStep: 4, fisherX: 2 },
    admin: true,
  });
  assert.match(point, /data-probability="single"/);
  assert.match(point, /Ausgewählte mögliche Vierfeldertafel/);
  assert.ok(!point.includes('data-probability="fisher"'));
  const event = renderFisherLab({
    counts,
    settings: { ...settings, fisherStep: 5, fisherEvent: "left", fisherX: 1 },
    admin: true,
  });
  assert.match(event, /P\(X ≤ 1\)/);
  assert.match(event, /nicht automatisch der Fisher-p-Wert/);
  const p = renderFisherLab({
    counts,
    settings: { ...settings, fisherStep: 6, fisherX: 5, fisherEvent: "fisher" },
    admin: true,
  });
  assert.match(p, /p = 0,00275946/);
  assert.match(p, /beobachtete Tafel mit X = 1/);
  assert.match(fisherDecision(counts, settings), /H₀ verwerfen/);
  assert.match(
    fisherDecision({ a: 4, b: 4, c: 4, d: 4 }, settings),
    /H₀ nicht verwerfen/,
  );
  assert.match(
    fisherDecision({ a: 0, b: 4, c: 0, d: 4 }, settings),
    /benötigt jede Gruppe/,
  );
});

test("Alle vier Testzellen nutzen die Zeilensumme als K und die Qualitätsspalte als n", () => {
  const t = { a: 2, b: 5, c: 7, d: 3 };
  const expected = [
    ["student", "good", "a", 9, 7, 2],
    ["student", "bad", "c", 9, 10, 7],
    ["staff", "good", "b", 8, 7, 5],
    ["staff", "bad", "d", 8, 10, 3],
  ];
  const original = hypergeometric(t);
  const observedProbability = original.points.find(
    (p) => p.x === original.observed,
  ).probability;
  for (const [group, quality, cell, K, n, observed] of expected) {
    const model = hypergeometric(t, group, quality);
    assert.deepEqual(
      [model.N, model.cell, model.K, model.n, model.observed],
      [17, cell, K, n, observed],
    );
    close(
      model.points.find((p) => p.x === observed).probability,
      observedProbability,
    );
    for (const side of ["two", "left", "right"])
      close(
        probabilityEvent(model, { kind: "fisher", side }).probability,
        fisher(t, side),
      );
  }
});

test("Zellwechsel erhalten dieselbe hypothetische Tafel und dasselbe kumulierte Ereignis", () => {
  const counts = { a: 2, b: 5, c: 7, d: 3 };
  const base = hypergeometric(counts);
  const candidate = fisherTableAt(base, 4);
  for (const group of ["student", "staff"])
    for (const quality of ["good", "bad"]) {
      const model = hypergeometric(counts, group, quality);
      for (const kind of ["single", "left", "right", "interval", "fisher"]) {
        const selection = { kind, x: 4, lower: 2, upper: 4 };
        const transformed = reparameterizeFisher(
          base,
          selection,
          group,
          quality,
        );
        assert.deepEqual(fisherTableAt(model, transformed.x), candidate);
        for (const side of ["two", "left", "right"]) {
          const oldEvent = probabilityEvent(base, { ...selection, side });
          const nextEvent = probabilityEvent(model, { ...transformed, side });
          close(nextEvent.probability, oldEvent.probability);
          const oldTables = oldEvent.xs
            .map((x) => fisherTableAt(base, x).a)
            .sort((a, b) => a - b);
          const nextTables = nextEvent.xs
            .map((x) => fisherTableAt(model, x).a)
            .sort((a, b) => a - b);
          assert.deepEqual(nextTables, oldTables);
        }
      }
    }
});

test("Gemeinsame Vierfeldertafel: Gruppen in den Zeilen, Qualität in den Spalten", () => {
  assert.deepEqual(contingencyMatrix({ a: 2, b: 3, c: 1, d: 4 }), [
    [2, 1, 3],
    [3, 4, 7],
    [5, 5, 10],
  ]);
  assert.throws(
    () => fisherParameters({ a: 1, b: 2, c: 3, d: 4 }, "student", "unknown"),
    RangeError,
  );
});
