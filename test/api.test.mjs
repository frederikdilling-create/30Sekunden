import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import XLSX from "xlsx";
test("Mehrbenutzersystem: 100 parallele Personen, Idempotenz, Autorisierung, SSE, Export, Demo-Trennung", async () => {
  const dir = mkdtempSync(join(tmpdir(), "challenge-test-")),
    password = "test-only-not-production-42",
    port = 3317,
    base = `http://127.0.0.1:${port}`;
  let child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: String(port),
      ADMIN_PASSWORD: password,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on("data", (d) => {
        if (d.toString().includes("Challenge läuft")) resolve();
      });
      child.on("error", reject);
      setTimeout(() => reject(Error("Start timeout")), 10000).unref();
    });
    let cookie = "";
    const req = async (path, b, token, admin = false) => {
      const r = await fetch(base + path, {
        method: b === undefined ? "GET" : "POST",
        headers: {
          ...(b === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(admin ? { cookie } : {}),
        },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      return { status: r.status, data: await r.json(), headers: r.headers };
    };
    const status = await req("/api/status"),
      id = status.data.first;
    const login = await req("/api/login", { password });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie").split(";")[0];
    const ep = (a) => `/api/e/${id}/${a}`;
    assert.equal((await req(ep("settings"), { running: false })).status, 401);
    const people = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        req(ep("join"), {
          nickname: i === 0 ? "=1+1" : "Person " + i,
          group: i < 60 ? "student" : "staff",
        }),
      ),
    );
    assert.equal(new Set(people.map((p) => p.data.id)).size, 100);
    const abort = new AbortController(),
      stream = await fetch(base + ep("events"), { signal: abort.signal }),
      reader = stream.body.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /connected/,
    );
    const ids = people.map(() => crypto.randomUUID());
    const measurements = await Promise.all(
      people.map((p, i) =>
        req(ep("measure"), { id: ids[i], seconds: 25 + i / 10 }, p.data.token),
      ),
    );
    assert.ok(measurements.every((x) => x.status === 200));
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /update/,
    );
    abort.abort();
    assert.equal(
      (
        await req(
          ep("measure"),
          { id: ids[0], seconds: 25 },
          people[0].data.token,
        )
      ).data.duplicate,
      true,
    );
    let admin = await req(ep("state"), undefined, null, true);
    assert.equal(admin.data.rows.length, 100);
    assert.equal(
      admin.data.participants.reduce((s, x) => s + x.n, 0),
      100,
    );
    const anon = await req(ep("state"));
    assert.equal(anon.data.rows.length, 0);
    assert.equal(anon.data.leaderboard.length, 100);
    const personal = await req(ep("state"), undefined, people[0].data.token);
    assert.equal(personal.data.own.length, 1);
    assert.equal(personal.data.participant.group, "student");
    await req(
      ep("settings"),
      { maxAttempts: 2, leaderboard: true },
      null,
      true,
    );
    assert.equal(
      (
        await req(
          ep("measure"),
          { id: crypto.randomUUID(), seconds: 30 },
          people[0].data.token,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await req(
          ep("measure"),
          { id: crypto.randomUUID(), seconds: 30 },
          people[0].data.token,
        )
      ).status,
      400,
    );
    assert.equal((await req(ep("state"))).data.leaderboard.length, 100);
    await req(ep("settings"), { freeze: true }, null, true);
    await req(
      ep("measure"),
      { id: crypto.randomUUID(), seconds: 30 },
      people[1].data.token,
    );
    assert.equal(
      (await req(ep("state"), undefined, null, true)).data.rows.length,
      101,
    );
    await req(
      ep("settings"),
      { frozen: false, lockTolerance: true, tolerance: 2 },
      null,
      true,
    );
    assert.equal(
      (await req(ep("state"), undefined, null, true)).data.rows.length,
      102,
    );
    await req(ep("settings"), { tolerance: 3 }, null, true);
    assert.equal(
      (await req(ep("state"), undefined, null, true)).data.experiment.settings
        .lockedTolerance,
      2,
    );
    assert.equal((await req(ep("demo"), { n: 20 }, null, true)).status, 400);
    const demo = await req(
      "/api/experiments",
      { name: "Test demo", demo: true },
      null,
      true,
    );
    await req(`/api/e/${demo.data.id}/demo`, { n: 20, share: 0.6 }, null, true);
    assert.equal(
      (await req(`/api/e/${demo.data.id}/state`, undefined, null, true)).data
        .rows.length,
      20,
    );
    assert.equal(
      (await req(ep("state"), undefined, null, true)).data.rows.length,
      102,
    );
    const exp = await req(ep("export") + "?format=json", undefined, null, true);
    assert.equal(exp.data.rohdaten.length, 102);
    assert.equal(exp.data.kennzahlen[0].n, 100);
    const excel = await fetch(base + ep("export") + "?format=xlsx", {
        headers: { cookie },
      }),
      book = XLSX.read(Buffer.from(await excel.arrayBuffer()));
    assert.deepEqual(book.SheetNames, ["Rohdaten", "Kennzahlen", "Metadaten"]);
    assert.equal(XLSX.utils.sheet_to_json(book.Sheets.Rohdaten).length, 102);
    const qr = await fetch(base + ep("qr"));
    assert.match(await qr.text(), /<svg/);
    assert.equal(
      (await req(ep("reset"), { confirm: "wrong" }, null, true)).status,
      400,
    );
    assert.equal(
      (await req(ep("state") + "?presentation=true")).data.presentation,
      false,
    );
    await req(
      ep("settings"),
      { publicPresentation: true, simulation: true, reveal: 9 },
      null,
      true,
    );
    const projection = await req(ep("state") + "?presentation=true");
    assert.equal(projection.data.presentation, true);
    assert.equal(projection.data.admin, false);
    assert.equal(projection.data.rows.length, 102);
    assert.notEqual(projection.data.rows[0].participant, people[0].data.id);
    assert.equal((await req(ep("simulate"), { n: 10 })).status, 401);
    await req(ep("simulate"), { n: 1000 }, null, true);
    const shared = await req(ep("state") + "?presentation=true");
    assert.equal(shared.data.simulation.values.length, 1000);
    await req(ep("simulate"), { n: 10 }, null, true);
    assert.equal(
      (await req(ep("state"), undefined, null, true)).data.simulation.values
        .length,
      1010,
    );
    const csv = await fetch(base + ep("export") + "?format=csv", {
      headers: { cookie },
    });
    assert.ok((await csv.text()).includes("'=1+1"));
    await req(ep("valid"), { id: ids[2], valid: false }, null, true);
    assert.equal(
      (await req(ep("state"), undefined, null, true)).data.rows.filter(
        (x) => x.valid,
      ).length,
      101,
    );
    child.kill("SIGTERM");
    await once(child, "exit");
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATA_DIR: dir, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      child.stdout.on("data", (d) => {
        if (d.toString().includes("Challenge läuft")) resolve();
      });
      child.on("error", reject);
    });
    const resumed = await req(ep("state"), undefined, null, true);
    assert.equal(resumed.data.rows.length, 102);
    assert.equal(resumed.data.admin, true);
    assert.equal((await req("/api/status")).data.setup, false);
    await req(ep("settings"), { running: false }, null, true);
    assert.equal(
      (
        await req(
          ep("measure"),
          { id: crypto.randomUUID(), seconds: 30 },
          people[2].data.token,
        )
      ).status,
      400,
    );
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
    rmSync(dir, { recursive: true, force: true });
  }
});
