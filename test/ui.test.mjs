// DOM integration tests execute the real UI and event handlers, without a browser.
// Browser rendering, device timing and layout are deliberately not claimed here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import * as stats from "../public/stats.js";
import * as fisherUI from "../public/fisher-lab.js";

const source = readFileSync(
  new URL("../public/app.js", import.meta.url),
  "utf8",
)
  .replace(/^import[\s\S]*?from "\.\/stats.js";/, "")
  .replace(/import[\s\S]*?from "\.\/fisher-lab.js";/, "");
async function settled(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(check(), "UI did not reach expected state");
}
function fixture() {
  const store = {
    settings: {
      mode: "first",
      frequency: "absolute",
      round: "initial",
      tolerance: 5,
      lockedTolerance: null,
      leaderboard: true,
      presentation: "welcome",
      running: true,
      registration: true,
      maxAttempts: 0,
      simulation: false,
      reveal: 1,
      alpha: 0.05,
      side: "two",
    },
    rows: [22, 29, 37].map((seconds, i) => ({
      id: "measurement-" + i,
      participant: "person-a",
      nickname: "Testperson",
      group: "student",
      attempt: i + 1,
      seconds,
      valid: 1,
      created: new Date(1700000000000 + i).toISOString(),
    })),
    events: [],
    calls: [],
  };
  function notify() {
    for (const event of store.events)
      if (!event.closed) event.onmessage?.({ data: "update" });
  }
  function client({ view = "presentation", admin = true } = {}) {
    const { document, window: domWindow } = parseHTML(
      '<!doctype html><html><body><div id="app"></div><div id="toast"></div></body></html>',
    );
    const local = new Map();
    const win = { addEventListener() {}, scrollTo() {} };
    domWindow.HTMLElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    domWindow.HTMLElement.prototype.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new domWindow.Event("close"));
    };
    async function fetch(path, options = {}) {
      const data = options.body ? JSON.parse(options.body) : undefined;
      store.calls.push({ path, data, admin });
      let response;
      if (path === "/api/status")
        response = { admin, setup: false, first: "test", experiments: [] };
      else if (path === "/api/login") response = { ok: true };
      else if (path.endsWith("/settings")) {
        Object.assign(store.settings, data);
        response = { ok: true };
        queueMicrotask(notify);
      } else if (path.endsWith("/restart")) {
        if (!admin)
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: "Nicht autorisiert" }),
          };
        if (data.confirm !== "NEUSTART test")
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: "Bestätigung stimmt nicht überein." }),
          };
        store.rows = [];
        store.settings.round = "new-round";
        store.settings.presentation = "welcome";
        response = { ok: true };
        queueMicrotask(notify);
      } else if (path.includes("/state"))
        response = {
          experiment: {
            id: "test",
            name: "DOM-Test",
            settings: store.settings,
            demo: false,
          },
          admin,
          presentation: !admin && view === "presentation",
          rows: admin || view === "presentation" ? store.rows : [],
          participants: [{ group: "student", n: 1 }],
          own: store.rows,
          participant: {
            id: "person-a",
            nickname: "Testperson",
            group: "student",
          },
          leaderboard: stats.ranking(store.rows),
          simulation: null,
        };
      else response = { ok: true };
      return {
        ok: true,
        status: 200,
        json: async () => structuredClone(response),
      };
    }
    const context = vm.createContext({
      ...stats,
      ...fisherUI,
      document,
      window: win,
      fetch,
      URLSearchParams,
      URL,
      Blob,
      crypto: globalThis.crypto,
      performance,
      location: {
        search: `?e=test&view=${view}`,
        origin: "https://local.test",
      },
      history: { replaceState() {} },
      navigator: { onLine: true },
      localStorage: {
        getItem: (k) => local.get(k) || null,
        setItem: (k, v) => local.set(k, v),
      },
      EventSource: class {
        constructor() {
          store.events.push(this);
        }
        close() {
          this.closed = true;
        }
      },
      FormData: class {
        constructor(form) {
          this.entries = [...form.querySelectorAll("input[name]")].map((el) => [
            el.name,
            el.value,
          ]);
        }
        [Symbol.iterator]() {
          return this.entries[Symbol.iterator]();
        }
      },
      setTimeout() {
        return 0;
      },
      clearTimeout() {},
      setInterval() {
        return 0;
      },
      console,
    });
    vm.runInContext(source, context, { filename: "app.js" });
    const query = (selector) => document.querySelector(selector);
    function click(selector) {
      const node = typeof selector === "string" ? query(selector) : selector;
      assert.ok(node, "Button missing");
      node.dispatchEvent(new domWindow.Event("click", { bubbles: true }));
    }
    function change(selector, value) {
      const node = query(selector);
      assert.ok(node, "Input missing");
      Object.defineProperty(node, "value", { value, configurable: true });
      node.dispatchEvent(new domWindow.Event("change", { bubbles: true }));
    }
    function submit(selector) {
      query(selector).dispatchEvent(
        new domWindow.Event("submit", { bubbles: true, cancelable: true }),
      );
    }
    async function slide(name) {
      const b = [...document.querySelectorAll("[data-pres]")].find(
        (el) => el.textContent === name,
      );
      click(b);
      await settled(() => query(".prescontrols")?.textContent.includes(name));
    }
    return { document, query, click, change, submit, slide, local };
  }
  return { store, client, notify };
}

test("Präsentation: bereinigte Reiter, fünf Modi und nachvollziehbare Statistik", async () => {
  const { client } = fixture(),
    ui = client();
  await settled(() => ui.query(".present-list"));
  const names = [...ui.document.querySelectorAll("[data-pres]")].map(
    (x) => x.textContent,
  );
  assert.equal(names.includes("Experiment"), false);
  assert.equal(names.includes("Relative Häufigkeiten"), false);
  assert.equal(
    ui.document.body.textContent.includes(
      "QR-Code scannen. Pseudonym wählen. Mitforschen.",
    ),
    false,
  );
  for (const name of [
    "Statistik",
    "Punktdiagramm",
    "Boxplots",
    "Toleranz",
    "Vierfeldertafel",
  ]) {
    await ui.slide(name);
    assert.deepEqual(
      [...ui.query('[data-setting="mode"]').querySelectorAll("option")].map(
        (x) => x.value,
      ),
      ["all", "best", "worst", "first", "last"],
    );
  }
  await ui.slide("Statistik");
  assert.match(ui.query(".single-value-note").textContent, /nur einer/);
  ui.change('[data-setting="mode"]', "all");
  await settled(() => !ui.query(".single-value-note"));
  const cells = (label) =>
    [...ui.document.querySelectorAll("tbody tr")].find(
      (tr) => tr.firstElementChild.textContent === label,
    ).children;
  assert.equal(cells("Arithmetisches Mittel")[1].textContent, "29,333 s");
  assert.equal(cells("Median")[1].textContent, "29,000 s");
  assert.equal(cells("Minimum")[1].textContent, "22,000 s");
  assert.equal(cells("Maximum")[1].textContent, "37,000 s");
  assert.match(
    ui.query(".analysis-summary").textContent,
    /1 Person · 3 Messungen/,
  );
  await ui.slide("Boxplots");
  assert.equal(ui.query('[data-setting="mode"] option[selected]').value, "all");
});

test("Toleranz und relative Häufigkeiten werden zwischen Admin und Projektion synchronisiert", async () => {
  const { client, store } = fixture();
  const admin = client(),
    projection = client({ admin: false });
  await settled(
    () => admin.query(".present-list") && projection.query(".qrhero"),
  );
  await admin.slide("Vierfeldertafel");
  await settled(() => projection.query(".cross"));
  admin.change('[data-setting="mode"]', "all");
  await settled(() => store.settings.mode === "all");
  admin.change('input[type="number"][data-tolerance]', "1");
  await settled(() =>
    projection.query(".tolerance-toolbar")?.textContent.includes("± 1,0"),
  );
  admin.change('[data-setting="frequency"]', "column");
  await settled(() =>
    projection.query(".frequency-toolbar")?.textContent.includes("je Gruppe"),
  );
  assert.match(projection.query(".cross").textContent, /33,3 %/);
  assert.match(projection.query(".cross").textContent, /66,7 %/);
  assert.equal(projection.query('[data-setting="mode"]'), null);
  assert.equal(projection.query("[data-tolerance]"), null);
  await admin.slide("Live-Messungen");
  assert.equal(admin.query('input[type="number"][data-tolerance]').value, "1");
  await admin.slide("Bestenliste");
  assert.match(admin.document.body.textContent, /Testperson/);
  assert.equal(
    admin.document.body.textContent.includes("noch nicht freigegeben"),
    false,
  );
});

test("Neustart benötigt Bestätigung und setzt ein verbundenes Teilnehmergerät zurück", async () => {
  const { client, store } = fixture();
  const admin = client(),
    participant = client({ view: "participate", admin: false });
  await settled(
    () =>
      participant.query('[data-action="start"]') &&
      admin.query(".present-list"),
  );
  participant.click('[data-action="start"]');
  assert.ok(participant.query('[data-action="stop"]'));
  admin.click('[data-action="restart"]');
  assert.equal(store.rows.length, 3);
  admin.click('[data-action="close-dialog"]');
  assert.equal(store.rows.length, 3);
  admin.click('[data-action="restart"]');
  admin.query('[name="confirm"]').value = "NEUSTART test";
  admin.submit("#restart-form");
  await settled(
    () => store.rows.length === 0 && participant.query('[data-action="start"]'),
  );
  assert.equal(participant.query('[data-action="stop"]'), null);
  assert.match(participant.document.body.textContent, /Testperson/);
  assert.equal(admin.query("dialog"), null);
});

test("Erfolgreiches Login wechselt auch bei fokussiertem Formular in das Dashboard", async () => {
  const { client } = fixture();
  const ui = client({ view: "overview" });
  await settled(() => ui.query(".sidebar"));
  // Mimic the stale login form and active focus present during the real submit.
  const form = ui.document.createElement("form");
  form.id = "login-form";
  const password = ui.document.createElement("input");
  password.name = "password";
  password.value = "local-test-password";
  form.append(password);
  ui.query("#app").replaceChildren(form);
  Object.defineProperty(ui.document, "activeElement", { get: () => password });
  ui.submit("#login-form");
  await settled(() => ui.query(".sidebar"));
  assert.equal(ui.query("#login-form"), null);
});

test("Fisher-Labor: Tafeln, Diagramm, kumulierte Ereignisse und p-Wert live auf zwei Ansichten", async () => {
  const { client, store } = fixture();
  store.settings.presentation = "simulation";
  store.settings.fisherStep = 1;
  store.settings.fisherGroup = "student";
  store.settings.fisherEvent = "single";
  store.rows = [];
  for (const [group, count, seconds] of [
    ["student", 1, 30],
    ["student", 11, 40],
    ["staff", 9, 30],
    ["staff", 3, 40],
  ])
    for (let i = 0; i < count; i++)
      store.rows.push({
        id: `${group}-${seconds}-${i}`,
        participant: `${group}-${seconds}-${i}`,
        nickname: "Test",
        group,
        attempt: 1,
        seconds,
        valid: 1,
        created: "2026-01-01T00:00:00Z",
      });
  const original = store.rows.map((x) => x.seconds);
  const admin = client(),
    projection = client({ admin: false });
  await settled(() => admin.query(".present-list"));
  await admin.slide("Fisher-Labor");
  await settled(
    () => admin.query(".fisher-path") && projection.query(".fisher-path"),
  );
  assert.equal(admin.query('[data-probability="fisher"]'), null);
  admin.click('[data-fisher-step="4"]');
  await settled(() => projection.query('[data-probability="single"]'));
  assert.equal(admin.document.querySelectorAll(".probability-bar").length, 11);
  admin.change('input[type="number"][data-setting="fisherX"]', "0");
  await settled(
    () =>
      projection.query(".fisher-possible .focus-cell strong")?.textContent ===
      "0",
  );
  assert.equal(
    admin.query(".fisher-possible .focus-cell strong").textContent,
    "0",
  );
  admin.click('.probability-bar[data-fisher-x="1"]');
  await settled(
    () =>
      projection.query(".fisher-possible .focus-cell strong")?.textContent ===
      "1",
  );
  admin.click('[data-fisher-step="5"]');
  await settled(() => admin.query('[data-setting="fisherEvent"]'));
  admin.change('[data-setting="fisherEvent"]', "left");
  await settled(
    () =>
      projection.query(".fisher-event-expression")?.textContent === "P(X ≤ 1)",
  );
  assert.equal(
    admin.query('[data-probability="event"]').textContent,
    "0,00137973",
  );
  assert.equal(projection.document.querySelectorAll(".event-bar").length, 2);
  admin.change('[data-setting="fisherEvent"]', "interval");
  await settled(() => admin.query('[data-setting="fisherUpper"]'));
  admin.change('[data-setting="fisherUpper"]', "1");
  await settled(
    () =>
      projection.query(".fisher-event-expression")?.textContent ===
      "P(0 ≤ X ≤ 1)",
  );
  admin.click('[data-fisher-step="6"]');
  await settled(() => projection.query('[data-probability="fisher"]'));
  assert.equal(
    projection.query('[data-probability="fisher"]').textContent,
    "p = 0,00275946",
  );
  assert.equal(projection.document.querySelectorAll(".event-bar").length, 4);
  admin.click('.probability-bar[data-fisher-x="5"]');
  await settled(
    () =>
      projection.query(".selected-bar")?.getAttribute("x") ===
      admin.query(".selected-bar")?.getAttribute("x"),
  );
  assert.equal(
    admin.query('[data-probability="fisher"]').textContent,
    "p = 0,00275946",
  );
  assert.deepEqual(
    store.rows.map((x) => x.seconds),
    original,
  );
  assert.equal(projection.query('[data-setting="fisherX"]'), null);
  assert.equal(projection.query('.probability-bar[role="button"]'), null);
  admin.click('[data-fisher-step="2"]');
  await settled(() => admin.query('[data-setting="side"]'));
  admin.change('[data-setting="side"]', "left");
  await settled(() => store.settings.side === "left");
  admin.click('[data-fisher-step="6"]');
  await settled(
    () =>
      admin.query('[data-probability="fisher"]')?.textContent ===
      "p = 0,00137973",
  );
  admin.change('[data-setting="fisherGroup"]', "staff");
  await settled(
    () =>
      projection.query(".fisher-p-card .fisher-event-expression")
        ?.textContent === "P(X ≥ 9)",
  );
  assert.equal(
    projection.query('[data-probability="fisher"]').textContent,
    "p = 0,00137973",
  );
  admin.click('[data-fisher-step="7"]');
  await settled(
    () =>
      projection.query(".fisher-decision h2")?.textContent === "H₀ verwerfen",
  );
  admin.change('[data-setting="alpha"]', "0.001");
  await settled(
    () =>
      projection.query(".fisher-decision h2")?.textContent ===
      "H₀ nicht verwerfen",
  );
  assert.match(projection.query(".fisher-decision").textContent, /kein Beweis/);
});
