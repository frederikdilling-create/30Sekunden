import test from "node:test";
import assert from "node:assert/strict";
import {
  good,
  select,
  describe,
  quantile,
  table,
  difference,
  extreme,
  fisher,
  permute,
  ranking,
} from "../public/stats.js";
const row = (
  participant,
  seconds,
  attempt = 1,
  group = "student",
  valid = 1,
) => ({
  participant,
  seconds,
  attempt,
  group,
  valid,
  created: "2026-01-01T00:00:00Z",
});
test("Grenzen des geschlossenen Toleranzintervalls", () => {
  assert.ok(good(25, 5));
  assert.ok(good(35, 5));
  assert.ok(!good(24.999, 5));
  assert.ok(!good(35.001, 5));
  assert.ok(good(29.9, 0.1));
});
test("Kennzahlen, R-7-Quartile, Stichprobenstandardabweichung", () => {
  const d = describe([row("a", 28), row("b", 30), row("c", 32), row("d", 34)]);
  assert.equal(d.mean, 31);
  assert.equal(d.median, 31);
  assert.equal(d.q1, 29.5);
  assert.equal(d.q3, 32.5);
  assert.equal(d.bias, 1);
  assert.equal(d.mae, 2);
  assert.equal(d.under, 0.25);
  assert.equal(d.over, 0.5);
  assert.ok(Math.abs(d.sd - Math.sqrt(20 / 3)) < 1e-10);
  assert.equal(d.persons, 4);
});
test("Leere Stichprobe und Einzelwert", () => {
  assert.equal(describe([]).mean, null);
  assert.equal(describe([row("a", 30)]).sd, null);
  assert.equal(quantile([], 0), null);
  assert.equal(difference({ a: 0, b: 1, c: 0, d: 1 }), null);
  assert.equal(fisher({ a: 0, b: 1, c: 0, d: 1 }), null);
});
test("Datengrundlage zählt erste gültige, letzte und beste Versuche korrekt", () => {
  const r = [
    row("a", 28, 1, "student", 0),
    row("a", 29, 2),
    row("a", 31.5, 3),
    row("b", 35, 1),
  ];
  assert.equal(
    select(r, "first").find((x) => x.participant === "a").seconds,
    29,
  );
  assert.equal(
    select(r, "last").find((x) => x.participant === "a").seconds,
    31.5,
  );
  assert.equal(
    select(r, "best").find((x) => x.participant === "a").seconds,
    29,
  );
  assert.equal(select(r, "all").length, 3);
  assert.equal(ranking(r).length, 2);
  assert.equal(ranking(r)[0].participant, "a");
});
test("Vierfeldertafel und Differenz", () => {
  const z = table(
    [
      row("a", 25),
      row("b", 36),
      row("c", 35, 1, "staff"),
      row("d", 30, 1, "staff"),
    ],
    5,
  );
  assert.deepEqual(z, { a: 1, b: 2, c: 1, d: 0 });
  assert.equal(difference(z), -0.5);
  assert.ok(extreme(-0.6, 0.5));
  assert.ok(!extreme(0.4, 0.5));
});
test("Exakter Fisher-Test gegen publiziertes Referenzbeispiel", () => {
  assert.ok(
    Math.abs(fisher({ a: 1, b: 9, c: 11, d: 3 }) - 0.00275945618522) < 1e-12,
  );
  assert.ok(
    Math.abs(fisher({ a: 1, b: 9, c: 11, d: 3 }, "left") - 0.00137972809261) <
      1e-12,
  );
  assert.ok(Math.abs(fisher({ a: 2, b: 2, c: 2, d: 2 }) - 1) < 1e-12);
});
test("Permutationen erhalten beide Ränder, approximieren die Hypergeometrie", () => {
  let seed = 42;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const z = { a: 7, b: 3, c: 3, d: 7 };
  let sum = 0,
    tail = 0;
  for (let i = 0; i < 30000; i++) {
    const t = permute(z, random);
    assert.equal(t.a + t.c, 10);
    assert.equal(t.b + t.d, 10);
    assert.equal(t.a + t.b, 10);
    sum += t.a;
    if (extreme(difference(t), difference(z))) tail++;
  }
  assert.ok(Math.abs(sum / 30000 - 5) < 0.03);
  assert.ok(Math.abs(tail / 30000 - fisher(z)) < 0.008);
});

test("Einzelperson: identische Kennzahlen nur bei einem ausgewählten Versuch", () => {
  const rows = [row("a", 22, 1), row("a", 29, 2), row("a", 37, 3)];
  const first = describe(select(rows, "first"));
  assert.deepEqual(
    [first.n, first.mean, first.median, first.min, first.max],
    [1, 22, 22, 22, 22],
  );
  const all = describe(select(rows, "all"));
  assert.deepEqual(
    [all.n, all.mean, all.median, all.min, all.max],
    [3, 88 / 3, 29, 22, 37],
  );
});

test("Beste und schlechteste Messung anhand absoluter Abweichung, nicht nach kleinster/größter Zeit", () => {
  const rows = [
    row("a", 20, 1),
    row("a", 31, 2),
    row("a", 29, 3),
    row("a", 60, 4, "student", 0),
    row("b", 30, 1),
  ];
  assert.equal(
    select(rows, "worst").find((x) => x.participant === "a").seconds,
    20,
  );
  assert.equal(
    select(rows, "best").find((x) => x.participant === "a").seconds,
    31,
  );
  assert.equal(
    select(rows, "last").find((x) => x.participant === "a").seconds,
    29,
  );
  assert.equal(select(rows, "worst").length, 2);
  const tie = [row("a", 32, 3), row("a", 28, 1)];
  assert.equal(select(tie, "worst")[0].attempt, 1);
  assert.equal(select(tie, "best")[0].attempt, 1);
  assert.equal(select([], "worst").length, 0);
});
