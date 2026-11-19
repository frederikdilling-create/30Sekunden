import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { frequencies, table, select } from "../public/stats.js";

test("Relative Häufigkeiten mit Gesamt-, Zeilen-, Spaltenbezug und leeren Rändern", () => {
  const z = { a: 2, b: 3, c: 1, d: 4 };
  assert.deepEqual(frequencies(z, "total"), [
    [2 / 10, 1 / 10, 3 / 10],
    [3 / 10, 4 / 10, 7 / 10],
    [5 / 10, 5 / 10, 1],
  ]);
  assert.deepEqual(frequencies(z, "column"), [
    [2 / 5, 1 / 5, 3 / 10],
    [3 / 5, 4 / 5, 7 / 10],
    [1, 1, 1],
  ]);
  assert.deepEqual(frequencies(z, "row"), [
    [2 / 3, 1 / 3, 1],
    [3 / 7, 4 / 7, 1],
    [5 / 10, 5 / 10, 1],
  ]);
  assert.deepEqual(
    frequencies({ a: 0, b: 0, c: 0, d: 0 }),
    Array.from({ length: 3 }, () => [null, null, null]),
  );
  assert.equal(frequencies({ a: 0, b: 0, c: 1, d: 2 }, "column")[0][0], null);
  assert.equal(frequencies({ a: 0, b: 1, c: 0, d: 2 }, "row")[0][0], null);
});

test("Gruppenstatistik für fünf Datengrundlagen, Live-Bestenliste und abgesicherter Neustart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "challenge-analysis-"));
  const password = "local-analysis-test-only-42";
  const port = 3318,
    base = `http://127.0.0.1:${port}`;
  let child;
  async function start() {
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        DATA_DIR: dir,
        PORT: String(port),
        ADMIN_PASSWORD: password,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Start timeout")), 10000);
      child.stdout.on("data", (d) => {
        if (d.toString().includes("Challenge läuft")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        reject(Error("Unexpected exit: " + code));
      });
    });
  }
  let cookie = "";
  async function request(path, body, token, admin = false) {
    const res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(admin ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }
  try {
    await start();
    const id = (await request("/api/status")).data.first,
      ep = (x) => `/api/e/${id}/${x}`;
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    cookie = login.headers.get("set-cookie").split(";")[0];
    const people = [];
    const datasets = [
      [25, 30.2, 38],
      [33, 28],
      [20, 31, 32, 29],
      [70, 30, 34],
    ];
    let excludedId;
    for (let i = 0; i < 4; i++) {
      const p = (
        await request(ep("join"), {
          nickname: "Person " + i,
          group: i < 2 ? "student" : "staff",
        })
      ).data;
      people.push(p);
      for (const seconds of datasets[i]) {
        const measurementId = crypto.randomUUID();
        assert.equal(
          (
            await request(
              ep("measure"),
              { id: measurementId, seconds },
              p.token,
            )
          ).status,
          200,
        );
        if (i === 3 && seconds === 70) excludedId = measurementId;
      }
    }
    await request(ep("valid"), { id: excludedId, valid: false }, null, true);
    const before = (await request(ep("state"), undefined, null, true)).data;
    assert.equal((await request(ep("state"))).data.leaderboard.length, 4);
    assert.equal(
      (
        await request(ep("state"), undefined, people[0].token)
      ).data.leaderboard.find((x) => x.self).seconds,
      30.2,
    );
    const cases = {
      all: [11, 330.2 / 11, 30.2, 20, 38],
      first: [4, 27, 27.5, 20, 33],
      best: [4, 29.8, 30.1, 28, 31],
      worst: [4, 31.25, 33.5, 20, 38],
      last: [4, 32.25, 31.5, 28, 38],
    };
    const groupCases = {
      all: [
        [5, 30.84, 30.2, 25, 38],
        [6, 176 / 6, 30.5, 20, 34],
      ],
      first: [
        [2, 29, 29, 25, 33],
        [2, 25, 25, 20, 30],
      ],
      best: [
        [2, 29.1, 29.1, 28, 30.2],
        [2, 30.5, 30.5, 30, 31],
      ],
      worst: [
        [2, 35.5, 35.5, 33, 38],
        [2, 27, 27, 20, 34],
      ],
      last: [
        [2, 33, 33, 28, 38],
        [2, 31.5, 31.5, 29, 34],
      ],
    };
    for (const [mode, expected] of Object.entries(cases)) {
      assert.equal(
        (await request(ep("settings"), { mode }, null, true)).status,
        200,
      );
      const exp = (
        await request(ep("export") + "?format=json", undefined, null, true)
      ).data;
      const stats = exp.kennzahlen[0];
      const actual = [stats.n, stats.mean, stats.median, stats.min, stats.max];
      actual.forEach((x, i) =>
        assert.ok(
          Math.abs(x - expected[i]) < 1e-10,
          `${mode}: ${actual} != ${expected}`,
        ),
      );
      assert.equal(stats.persons, 4);
      assert.equal(exp.datengrundlage, mode);
      for (let group = 1; group <= 2; group++) {
        const g = exp.kennzahlen[group];
        [g.n, g.mean, g.median, g.min, g.max].forEach((x, i) =>
          assert.ok(
            Math.abs(x - groupCases[mode][group - 1][i]) < 1e-10,
            `${mode}, Gruppe ${group}: falsche Kennzahl ${i}`,
          ),
        );
      }
    }
    await request(
      ep("settings"),
      {
        mode: "all",
        tolerance: 2,
        frequency: "column",
        publicPresentation: true,
        presentation: "contingency",
      },
      null,
      true,
    );
    const projection = (await request(ep("state") + "?presentation=true")).data;
    assert.equal(projection.experiment.settings.mode, "all");
    assert.equal(projection.experiment.settings.frequency, "column");
    assert.deepEqual(table(select(projection.rows, "all"), 2), {
      a: 2,
      b: 4,
      c: 3,
      d: 2,
    });
    await request(
      ep("settings"),
      { tolerance: 5, frequency: "total" },
      null,
      true,
    );
    const projection2 = (await request(ep("state") + "?presentation=true"))
      .data;
    assert.deepEqual(table(select(projection2.rows, "all"), 5), {
      a: 4,
      b: 5,
      c: 1,
      d: 1,
    });
    assert.equal(projection2.experiment.settings.frequency, "total");
    assert.equal(
      (await request(ep("settings"), { mode: "worst" }, people[0].token))
        .status,
      401,
    );
    assert.equal(
      (
        await request(
          ep("restart"),
          { confirm: `NEUSTART ${id}` },
          people[0].token,
        )
      ).status,
      401,
    );
    assert.equal(
      (await request(ep("restart"), { confirm: "NEUSTART" }, null, true))
        .status,
      400,
    );
    assert.equal(
      (await request(ep("state"), undefined, null, true)).data.rows.length,
      before.rows.length,
    );
    const demo = (
      await request(
        "/api/experiments",
        { name: "Anderes Experiment", demo: true },
        null,
        true,
      )
    ).data.id;
    await request(`/api/e/${demo}/demo`, { n: 12 }, null, true);
    await request(
      ep("settings"),
      { freeze: true, simulation: true, reveal: 9, mode: "first" },
      null,
      true,
    );
    await request(ep("simulate"), { n: 10 }, null, true);
    const frozen = (await request(ep("state"), undefined, null, true)).data;
    assert.equal(frozen.simulation.values.length, 10);
    assert.equal(frozen.experiment.settings.frozen, true);
    const abort = new AbortController();
    const stream = await fetch(base + ep("events"), { signal: abort.signal }),
      reader = stream.body.getReader();
    await reader.read();
    assert.equal(
      (await request(ep("restart"), { confirm: `NEUSTART ${id}` }, null, true))
        .status,
      200,
    );
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /update/,
    );
    abort.abort();
    const after = (await request(ep("state"), undefined, null, true)).data;
    assert.equal(after.rows.length, 0);
    assert.equal(after.leaderboard.length, 0);
    assert.equal(after.simulation, null);
    assert.equal(
      after.participants.reduce((sum, x) => sum + x.n, 0),
      4,
    );
    assert.notEqual(
      after.experiment.settings.round,
      before.experiment.settings.round,
    );
    assert.equal(after.experiment.settings.frozen, false);
    assert.equal(after.experiment.settings.reveal, 1);
    assert.equal(after.experiment.settings.presentation, "welcome");
    assert.equal(after.experiment.settings.running, true);
    assert.equal(after.experiment.settings.publicPresentation, true);
    assert.equal(after.experiment.settings.tolerance, 5);
    assert.equal(
      (await request(ep("settings"), { frozen: true }, null, true)).status,
      400,
    );
    const returning = (await request(ep("state"), undefined, people[0].token))
      .data;
    assert.equal(returning.participant.id, people[0].id);
    assert.equal(returning.own.length, 0);
    const stale = await request(
      ep("measure"),
      {
        id: crypto.randomUUID(),
        seconds: 28,
        round: before.experiment.settings.round,
      },
      people[0].token,
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, "stale_round");
    assert.equal(
      (
        await request(
          ep("measure"),
          { id: crypto.randomUUID(), seconds: 28 },
          people[0].token,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          ep("measure"),
          {
            id: crypto.randomUUID(),
            seconds: 30,
            round: after.experiment.settings.round,
          },
          people[0].token,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request(ep("state"), undefined, people[0].token)).data.own[0]
        .attempt,
      1,
    );
    assert.equal(
      (await request(`/api/e/${demo}/state`, undefined, null, true)).data.rows
        .length,
      12,
    );
    // Simulate an existing event saved by the previous version, without a migration.
    child.kill("SIGTERM");
    await once(child, "exit");
    const db = new DatabaseSync(join(dir, "challenge.sqlite"));
    const settings = JSON.parse(
      db.prepare("SELECT settings FROM experiments WHERE id=?").get(id)
        .settings,
    );
    delete settings.frequency;
    delete settings.round;
    settings.leaderboard = false;
    settings.presentation = "shares";
    db.prepare("UPDATE experiments SET settings=? WHERE id=?").run(
      JSON.stringify(settings),
      id,
    );
    db.close();
    await start();
    const legacy = (await request(ep("state"), undefined, null, true)).data;
    assert.equal(legacy.experiment.settings.leaderboard, true);
    assert.equal(legacy.leaderboard.length, 1);
    assert.equal(legacy.experiment.settings.frequency, "absolute");
    assert.equal(legacy.experiment.settings.presentation, "contingency");
  } finally {
    if (child?.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
