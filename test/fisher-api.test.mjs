import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Fisher-Steuerung: Autorisierung, feste Daten, Projektion, Kontextwechsel und Persistenz", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fisher-api-")),
    base = "http://127.0.0.1:3320";
  let child,
    cookie = "";
  async function start() {
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        DATA_DIR: dir,
        PORT: "3320",
        ADMIN_PASSWORD: "fisher-test-not-production-42",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Start timeout")), 10000);
      child.stdout.on("data", (data) => {
        if (data.toString().includes("Challenge läuft")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        reject(Error("Unexpected exit: " + code));
      });
    });
  }
  const req = async (path, body, admin = false, token) => {
    const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(admin ? { cookie } : {}),
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    await start();
    const id = (await req("/api/status")).data.first,
      ep = (x) => `/api/e/${id}/${x}`;
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "fisher-test-not-production-42" }),
    });
    cookie = login.headers.get("set-cookie").split(";")[0];
    let participant;
    for (const [group, count, seconds] of [
      ["student", 1, 30],
      ["student", 11, 40],
      ["staff", 9, 30],
      ["staff", 3, 40],
    ])
      for (let i = 0; i < count; i++) {
        const p = (
          await req(ep("join"), { group, nickname: `${group}-${seconds}-${i}` })
        ).data;
        participant = p;
        assert.equal(
          (
            await req(
              ep("measure"),
              { id: crypto.randomUUID(), seconds },
              false,
              p.token,
            )
          ).status,
          200,
        );
      }
    const initial = (await req(ep("state"), undefined, true)).data;
    assert.equal(initial.rows.length, 24);
    assert.equal(initial.experiment.settings.fisherX, 1);
    assert.equal(initial.experiment.settings.fisherStep, 1);
    assert.equal(
      (await req(ep("settings"), { fisherStep: 4 }, false, participant.token))
        .status,
      401,
    );
    for (const body of [
      { fisherStep: 8 },
      { fisherStep: 2.5 },
      { fisherX: 11 },
      { fisherX: -1 },
      { fisherX: 0.5 },
      { fisherGroup: "unknown" },
      { fisherQuality: "unknown" },
      { fisherEvent: "unknown" },
      { fisherLower: 5, fisherUpper: 4 },
    ]) {
      assert.equal(
        (await req(ep("settings"), body, true)).status,
        400,
        JSON.stringify(body),
      );
    }
    assert.equal(
      (await req(ep("state"), undefined, true)).data.experiment.settings
        .fisherStep,
      1,
    );
    await req(
      ep("settings"),
      {
        fisherStep: 4,
        fisherX: 0,
        publicPresentation: true,
        presentation: "simulation",
      },
      true,
    );
    let projected = (await req(ep("state") + "?presentation=true")).data;
    assert.equal(projected.experiment.settings.fisherX, 0);
    assert.equal(projected.experiment.settings.fisherStep, 4);
    assert.deepEqual(
      projected.rows.map((x) => x.seconds),
      initial.rows.map((x) => x.seconds),
    );
    await req(
      ep("settings"),
      {
        fisherStep: 5,
        fisherEvent: "interval",
        fisherLower: 0,
        fisherUpper: 1,
      },
      true,
    );
    projected = (await req(ep("state") + "?presentation=true")).data;
    assert.equal(projected.experiment.settings.fisherEvent, "interval");
    assert.equal(projected.experiment.settings.fisherUpper, 1);
    await req(ep("settings"), { fisherStep: 6, fisherEvent: "fisher" }, true);
    await req(ep("settings"), { fisherGroup: "staff" }, true);
    let state = (await req(ep("state"), undefined, true)).data;
    assert.equal(state.experiment.settings.fisherX, 10);
    assert.equal(state.experiment.settings.fisherEvent, "fisher");
    assert.equal(state.experiment.settings.fisherStep, 6);
    await req(
      ep("settings"),
      {
        fisherGroup: "student",
        fisherQuality: "good",
        fisherX: 2,
        fisherEvent: "left",
      },
      true,
    );
    for (const [group, quality, k, event] of [
      ["student", "bad", 10, "right"],
      ["staff", "bad", 4, "left"],
      ["staff", "good", 8, "right"],
      ["student", "good", 2, "left"],
    ]) {
      assert.equal(
        (
          await req(
            ep("settings"),
            { fisherGroup: group, fisherQuality: quality },
            true,
          )
        ).status,
        200,
      );
      const projected = (await req(ep("state") + "?presentation=true")).data;
      assert.equal(projected.experiment.settings.fisherGroup, group);
      assert.equal(projected.experiment.settings.fisherQuality, quality);
      assert.equal(projected.experiment.settings.fisherX, k);
      assert.equal(projected.experiment.settings.fisherEvent, event);
      assert.deepEqual(
        projected.rows.map((row) => row.seconds),
        initial.rows.map((row) => row.seconds),
      );
    }
    await req(
      ep("settings"),
      { fisherEvent: "interval", fisherLower: 0, fisherUpper: 1 },
      true,
    );
    await req(ep("settings"), { fisherQuality: "bad" }, true);
    state = (await req(ep("state"), undefined, true)).data;
    assert.deepEqual(
      [
        state.experiment.settings.fisherX,
        state.experiment.settings.fisherLower,
        state.experiment.settings.fisherUpper,
      ],
      [10, 11, 12],
    );
    assert.equal(state.experiment.settings.fisherEvent, "interval");
    await req(
      ep("settings"),
      {
        fisherGroup: "staff",
        fisherQuality: "good",
        fisherX: 0,
        fisherEvent: "right",
        freeze: true,
      },
      true,
    );
    const newPerson = (
      await req(ep("join"), { group: "student", nickname: "Weitere Person" })
    ).data;
    await req(
      ep("measure"),
      { id: crypto.randomUUID(), seconds: 30 },
      false,
      newPerson.token,
    );
    state = (await req(ep("state"), undefined, true)).data;
    assert.equal(state.rows.length, 24);
    assert.equal(state.experiment.settings.fisherX, 0);
    await req(ep("settings"), { frozen: false }, true);
    state = (await req(ep("state"), undefined, true)).data;
    assert.equal(state.rows.length, 25);
    assert.equal(state.experiment.settings.fisherX, 9);
    assert.equal(state.experiment.settings.fisherEvent, "single");
    await req(ep("settings"), { fisherX: 3, fisherStep: 7, alpha: 0.01 }, true);
    child.kill("SIGTERM");
    await once(child, "exit");
    await start();
    state = (await req(ep("state"), undefined, true)).data;
    assert.equal(state.experiment.settings.fisherX, 3);
    assert.equal(state.experiment.settings.fisherStep, 7);
    assert.equal(state.experiment.settings.alpha, 0.01);
    assert.equal((await fetch(base + "/fisher-lab.js")).status, 200);
    await req(ep("restart"), { confirm: `NEUSTART ${id}` }, true);
    state = (await req(ep("state"), undefined, true)).data;
    assert.equal(state.rows.length, 0);
    assert.equal(state.experiment.settings.fisherStep, 1);
    assert.equal(state.experiment.settings.fisherX, 0);
    assert.equal(state.experiment.settings.fisherEvent, "single");
  } finally {
    if (child?.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
