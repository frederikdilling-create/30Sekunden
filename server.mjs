import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import XLSX from "xlsx";
import {
  describe,
  select,
  ranking,
  good,
  table,
  difference,
  permute,
} from "./public/stats.js";
const cliPort = process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1]
  : null;
const root = dirname(fileURLToPath(import.meta.url)),
  data = process.env.DATA_DIR || join(root, "data");
mkdirSync(data, { recursive: true });
const db = new DatabaseSync(join(data, "challenge.sqlite"));
db.exec(
  `PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY,name TEXT NOT NULL,demo INTEGER NOT NULL,settings TEXT NOT NULL,snapshot TEXT,created TEXT NOT NULL);CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY,experiment TEXT NOT NULL REFERENCES experiments(id),nickname TEXT NOT NULL,grp TEXT NOT NULL,token TEXT NOT NULL UNIQUE,created TEXT NOT NULL);CREATE TABLE IF NOT EXISTS measurements(id TEXT PRIMARY KEY,experiment TEXT NOT NULL REFERENCES experiments(id),participant TEXT NOT NULL REFERENCES participants(id),attempt INTEGER NOT NULL,seconds REAL NOT NULL,valid INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,UNIQUE(participant,attempt));CREATE TABLE IF NOT EXISTS simulations(experiment TEXT PRIMARY KEY REFERENCES experiments(id),payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE INDEX IF NOT EXISTS measurement_exp ON measurements(experiment);CREATE INDEX IF NOT EXISTS participant_exp ON participants(experiment);`,
);
const defaults = {
  registration: true,
  running: true,
  maxAttempts: 0,
  leaderboard: false,
  simulation: false,
  tolerance: 5,
  lockedTolerance: null,
  mode: "first",
  frozen: false,
  alpha: 0.05,
  side: "two",
  reveal: 1,
  presentation: "welcome",
  publicPresentation: false,
};
const hash = (x) => createHash("sha256").update(x).digest("hex"),
  secret = () => randomBytes(32).toString("hex");
function createExperiment(name, demo = false) {
  const id = randomUUID().slice(0, 8);
  db.prepare("INSERT INTO experiments VALUES(?,?,?,?,NULL,?)").run(
    id,
    name,
    +demo,
    JSON.stringify(defaults),
    new Date().toISOString(),
  );
  return id;
}
if (!db.prepare("SELECT id FROM experiments LIMIT 1").get())
  createExperiment("Lehrprobe · Universität Paderborn");
let setup = process.env.SETUP_TOKEN;
if (!db.prepare("SELECT value FROM config WHERE key='password'").get()) {
  if (process.env.ADMIN_PASSWORD) setPassword(process.env.ADMIN_PASSWORD);
  else {
    setup ||= secret();
    console.log("Einmalige Einrichtung: /?setup=" + setup);
  }
}
function setPassword(p) {
  if (p.length < 12) throw Error("Bitte mindestens 12 Zeichen verwenden.");
  const salt = secret();
  db.prepare("INSERT OR REPLACE INTO config VALUES('password',?)").run(
    salt + ":" + scryptSync(p, salt, 64).toString("hex"),
  );
  setup = null;
}
const clients = new Map(),
  failures = new Map();
function emit(id) {
  for (const res of clients.get(id) || []) res.write("data: update\n\n");
}
function experiment(id) {
  const e = db.prepare("SELECT * FROM experiments WHERE id=?").get(id);
  if (!e)
    throw Object.assign(Error("Veranstaltung nicht gefunden."), {
      status: 404,
    });
  return { ...e, settings: JSON.parse(e.settings) };
}
function rows(id) {
  return db
    .prepare(
      'SELECT m.*,p.nickname,p.grp AS "group" FROM measurements m JOIN participants p ON m.participant=p.id WHERE m.experiment=? ORDER BY m.created',
    )
    .all(id);
}
function auth(req) {
  const token = (req.headers.cookie || "").match(/(?:^|; )admin=([^;]+)/)?.[1];
  return (
    token &&
    db
      .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
      .get(hash(token), Date.now())
  );
}
function requireAdmin(req) {
  if (!auth(req))
    throw Object.assign(Error("Bitte als Administration anmelden."), {
      status: 401,
    });
}
function person(req, id) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  return (
    token &&
    db
      .prepare("SELECT * FROM participants WHERE token=? AND experiment=?")
      .get(hash(token), id)
  );
}
function requirePerson(req, id) {
  const p = person(req, id);
  if (!p)
    throw Object.assign(Error("Teilnahme nicht gefunden."), { status: 401 });
  return p;
}
async function body(req) {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 100000) throw Error("Anfrage zu groß.");
  }
  try {
    return JSON.parse(s || "{}");
  } catch {
    throw Error("Ungültige Anfrage.");
  }
}
function json(res, value, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
function state(req, e) {
  const presentation =
    new URL(req.url, "http://local").searchParams.get("presentation") ===
      "true" && e.settings.publicPresentation;
  const admin = auth(req),
    p = person(req, e.id),
    all = rows(e.id),
    r = e.settings.frozen && e.snapshot ? JSON.parse(e.snapshot) : all;
  const testTable = table(
      select(r, e.settings.mode),
      e.settings.lockedTolerance ?? e.settings.tolerance,
    ),
    simKey = JSON.stringify([
      testTable,
      e.settings.side,
      e.settings.mode,
      e.settings.lockedTolerance ?? e.settings.tolerance,
    ]),
    storedSim = db
      .prepare("SELECT payload FROM simulations WHERE experiment=?")
      .get(e.id);
  const simulation = storedSim ? JSON.parse(storedSim.payload) : null;
  const publicRows = r
    .filter((x) => x.valid)
    .map(({ participant, ...x }) => ({
      ...x,
      participant: hash(participant).slice(0, 16),
    }));
  return {
    experiment: {
      id: e.id,
      name: e.name,
      demo: e.demo,
      settings: e.settings,
      created: e.created,
    },
    admin: !!admin,
    presentation: !!presentation,
    simulation:
      (admin || (presentation && e.settings.simulation)) &&
      simulation?.key === simKey
        ? simulation
        : null,
    participants: db
      .prepare(
        'SELECT grp AS "group",COUNT(*) AS n FROM participants WHERE experiment=? GROUP BY grp',
      )
      .all(e.id),
    rows: admin ? r : presentation ? publicRows : [],
    publicRows: admin ? publicRows : [],
    own: p ? all.filter((x) => x.participant === p.id) : [],
    participant: p ? { id: p.id, nickname: p.nickname, group: p.grp } : null,
    leaderboard:
      admin || e.settings.leaderboard
        ? ranking(all).map(({ participant, ...x }) => ({
            ...x,
            self: participant === p?.id,
          }))
        : [],
  };
}
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://local"),
      path = u.pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      req.headers.origin !==
        `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`
    )
      throw Object.assign(Error("Fremde Herkunft abgewiesen."), {
        status: 403,
      });
    if (path === "/api/status")
      return json(res, {
        admin: !!auth(req),
        setup: !db
          .prepare("SELECT value FROM config WHERE key='password'")
          .get(),
        experiments: auth(req)
          ? db
              .prepare(
                "SELECT id,name,demo,created FROM experiments ORDER BY created DESC",
              )
              .all()
          : [],
        first: db
          .prepare(
            "SELECT id FROM experiments WHERE demo=0 ORDER BY created LIMIT 1",
          )
          .get()?.id,
      });
    if (path === "/api/setup" && req.method === "POST") {
      const b = await body(req);
      if (!setup || b.token !== setup)
        throw Object.assign(Error("Einrichtungsschlüssel ungültig."), {
          status: 403,
        });
      setPassword(String(b.password));
      return json(res, { ok: true });
    }
    if (path === "/api/login" && req.method === "POST") {
      const key = req.socket.remoteAddress,
        prev = failures.get(key) || { n: 0, until: 0 };
      if (prev.until > Date.now())
        throw Object.assign(
          Error("Zu viele Anmeldeversuche. Bitte 15 Minuten warten."),
          { status: 429 },
        );
      const { password } = await body(req),
        stored = db
          .prepare("SELECT value FROM config WHERE key='password'")
          .get()?.value;
      const [salt, expected] = (stored || ":").split(":");
      if (
        !salt ||
        !timingSafeEqual(
          scryptSync(String(password), salt, 64),
          Buffer.from(expected, "hex"),
        )
      ) {
        prev.n++;
        if (prev.n >= 8) prev.until = Date.now() + 900000;
        failures.set(key, prev);
        throw Object.assign(Error("Anmeldung fehlgeschlagen."), {
          status: 401,
        });
      }
      failures.delete(key);
      const token = secret();
      db.prepare("INSERT INTO sessions VALUES(?,?)").run(
        hash(token),
        Date.now() + 12 * 3600000,
      );
      res.setHeader(
        "Set-Cookie",
        `admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`,
      );
      return json(res, { ok: true });
    }
    if (path === "/api/logout" && req.method === "POST") {
      const token = (req.headers.cookie || "").match(
        /(?:^|; )admin=([^;]+)/,
      )?.[1];
      if (token)
        db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
      res.setHeader(
        "Set-Cookie",
        "admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      );
      return json(res, { ok: true });
    }
    if (path === "/api/experiments" && req.method === "POST") {
      requireAdmin(req);
      const b = await body(req);
      return json(res, {
        id: createExperiment(
          String(b.name || "Neue Veranstaltung").slice(0, 100),
          !!b.demo,
        ),
      });
    }
    const match = path.match(/^\/api\/e\/([a-z0-9-]+)(?:\/(.*))?$/);
    if (match) {
      const [, id, action = "state"] = match,
        e = experiment(id);
      if (action === "state" && req.method === "GET")
        return json(res, state(req, e));
      if (action === "events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        if (!clients.has(id)) clients.set(id, new Set());
        clients.get(id).add(res);
        res.write("data: connected\n\n");
        const timer = setInterval(() => res.write(": heartbeat\n\n"), 20000);
        req.on("close", () => {
          clearInterval(timer);
          clients.get(id)?.delete(res);
        });
        return;
      }
      if (action === "join" && req.method === "POST") {
        if (!e.settings.registration || e.demo)
          throw Error("Die Anmeldung ist geschlossen.");
        const b = await body(req),
          nickname = String(b.nickname || "").trim();
        if (
          !nickname ||
          nickname.length > 30 ||
          !["student", "staff"].includes(b.group)
        )
          throw Error("Bitte Nickname (max. 30 Zeichen) und Gruppe wählen.");
        const p = person(req, id);
        if (p) return json(res, { id: p.id });
        const pid = randomUUID(),
          token = secret();
        db.prepare("INSERT INTO participants VALUES(?,?,?,?,?,?)").run(
          pid,
          id,
          nickname,
          b.group,
          hash(token),
          new Date().toISOString(),
        );
        emit(id);
        return json(res, { id: pid, token });
      }
      if (action === "measure" && req.method === "POST") {
        const p = requirePerson(req, id),
          b = await body(req);
        if (typeof b.id !== "string" || !/^[\w-]{16,80}$/.test(b.id))
          throw Error("Ungültige Messungs-ID.");
        const existing = db
          .prepare("SELECT * FROM measurements WHERE id=?")
          .get(b.id);
        if (existing) {
          if (existing.participant !== p.id)
            throw Error("Ungültige Messungs-ID.");
          return json(res, { ok: true, duplicate: true });
        }
        if (!e.settings.running || e.demo)
          throw Error("Die Experimentierphase ist beendet.");
        if (
          !Number.isFinite(b.seconds) ||
          b.seconds < 0.1 ||
          b.seconds > 600 ||
          b.interrupted
        )
          throw Error("Unterbrochene oder ungültige Messung.");
        const n = db
          .prepare("SELECT COUNT(*) AS n FROM measurements WHERE participant=?")
          .get(p.id).n;
        if (e.settings.maxAttempts && n >= e.settings.maxAttempts)
          throw Error("Maximale Versuchszahl erreicht.");
        db.prepare("INSERT INTO measurements VALUES(?,?,?,?,?,1,?)").run(
          b.id,
          id,
          p.id,
          n + 1,
          b.seconds,
          new Date().toISOString(),
        );
        emit(id);
        return json(res, { ok: true });
      }
      if (action === "qr") {
        const origin =
          process.env.PUBLIC_URL ||
          `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        return res.end(
          await QRCode.toString(`${origin}/?e=${id}&view=participate`, {
            type: "svg",
            margin: 2,
            width: 320,
          }),
        );
      }
      requireAdmin(req);
      if (action === "settings" && req.method === "POST") {
        const b = await body(req),
          s = { ...e.settings };
        for (const k of [
          "registration",
          "running",
          "leaderboard",
          "simulation",
          "frozen",
          "publicPresentation",
        ])
          if (k in b) s[k] = !!b[k];
        for (const [k, min, max] of [
          ["tolerance", 0, 30],
          ["maxAttempts", 0, 100],
          ["alpha", 0.001, 0.5],
          ["reveal", 1, 9],
        ])
          if (k in b) {
            if (!Number.isFinite(b[k]) || b[k] < min || b[k] > max)
              throw Error("Einstellung außerhalb des gültigen Bereichs.");
            s[k] = ["maxAttempts", "reveal"].includes(k)
              ? Math.floor(b[k])
              : b[k];
          }
        if (b.lockTolerance) s.lockedTolerance = s.tolerance;
        if (b.unlockTolerance) s.lockedTolerance = null;
        if (["all", "first", "last", "best"].includes(b.mode)) s.mode = b.mode;
        if (["two", "left", "right"].includes(b.side)) s.side = b.side;
        if (typeof b.presentation === "string" && b.presentation.length < 30)
          s.presentation = b.presentation;
        if (b.frozen && !e.snapshot && !b.freeze)
          throw Error("Bitte zuerst einen Auswertungsstand sichern.");
        if (b.freeze) {
          db.prepare("UPDATE experiments SET snapshot=? WHERE id=?").run(
            JSON.stringify(rows(id)),
            id,
          );
          s.frozen = true;
        }
        db.prepare("UPDATE experiments SET settings=? WHERE id=?").run(
          JSON.stringify(s),
          id,
        );
        emit(id);
        return json(res, { ok: true });
      }
      if (action === "simulate" && req.method === "POST") {
        const b = await body(req),
          n = Number(b.n);
        if (!Number.isInteger(n) || n < 0 || n > 10000)
          throw Error("Zwischen 0 und 10.000 Simulationen wählen.");
        const r =
            e.settings.frozen && e.snapshot ? JSON.parse(e.snapshot) : rows(id),
          t = e.settings.lockedTolerance ?? e.settings.tolerance,
          z = table(select(r, e.settings.mode), t),
          key = JSON.stringify([z, e.settings.side, e.settings.mode, t]);
        if (difference(z) === null && n)
          throw Error("Beide Gruppen benötigen gültige Messungen.");
        const previous = db
            .prepare("SELECT payload FROM simulations WHERE experiment=?")
            .get(id),
          old = previous ? JSON.parse(previous.payload) : null,
          payload =
            n && old?.key === key ? old : { key, values: [], last: null };
        if (payload.values.length + n > 200000)
          throw Error(
            "Maximal 200.000 Simulationen pro Auswertungsstand; bitte zurücksetzen.",
          );
        for (let i = 0; i < n; i++) {
          payload.last = permute(z);
          payload.values.push(difference(payload.last));
        }
        db.prepare("INSERT OR REPLACE INTO simulations VALUES(?,?)").run(
          id,
          JSON.stringify(payload),
        );
        emit(id);
        return json(res, { ok: true });
      }
      if (action === "valid" && req.method === "POST") {
        const b = await body(req);
        db.prepare(
          "UPDATE measurements SET valid=? WHERE id=? AND experiment=?",
        ).run(+!!b.valid, b.id, id);
        emit(id);
        return json(res, { ok: true });
      }
      if (action === "reset" && req.method === "POST") {
        const b = await body(req);
        if (b.confirm !== `LÖSCHEN ${id}`)
          throw Error("Bestätigung stimmt nicht überein.");
        db.exec("BEGIN");
        try {
          db.prepare("DELETE FROM simulations WHERE experiment=?").run(id);
          db.prepare("DELETE FROM measurements WHERE experiment=?").run(id);
          db.prepare("DELETE FROM participants WHERE experiment=?").run(id);
          db.prepare(
            "UPDATE experiments SET snapshot=NULL,settings=? WHERE id=?",
          ).run(JSON.stringify(defaults), id);
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
        emit(id);
        return json(res, { ok: true });
      }
      if (action === "demo" && req.method === "POST") {
        if (!e.demo)
          throw Error("Demo-Daten sind nur in Demo-Veranstaltungen erlaubt.");
        const b = await body(req),
          n = Math.max(2, Math.min(500, Math.floor(Number(b.n) || 60))),
          share = Math.max(0, Math.min(1, Number(b.share ?? 0.6)));
        if (rows(id).length)
          throw Error("Bitte zunächst Demo-Daten zurücksetzen.");
        db.exec("BEGIN");
        try {
          for (let i = 0; i < n; i++) {
            const pid = randomUUID(),
              group = i < Math.round(n * share) ? "student" : "staff";
            db.prepare("INSERT INTO participants VALUES(?,?,?,?,?,?)").run(
              pid,
              id,
              `${group === "student" ? "Stud" : "Team"} ${String(i + 1).padStart(2, "0")}`,
              group,
              hash(secret()),
              new Date().toISOString(),
            );
            const z =
                Math.sqrt(-2 * Math.log(Math.max(Math.random(), 1e-10))) *
                Math.cos(2 * Math.PI * Math.random()),
              seconds = Math.max(
                8,
                30 + (group === "student" ? 3.4 : 4.8) * z + 0.4,
              );
            db.prepare("INSERT INTO measurements VALUES(?,?,?,?,?,1,?)").run(
              randomUUID(),
              id,
              pid,
              1,
              Math.round(seconds * 1000) / 1000,
              new Date(Date.now() - (n - i) * 13000).toISOString(),
            );
          }
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
        emit(id);
        return json(res, { ok: true });
      }
      if (action === "export") {
        const r = state(req, e).rows,
          t = e.settings.tolerance,
          raw = r.map((x) => ({
            experiment_id: id,
            participant_id: x.participant,
            nickname: x.nickname,
            gruppe: x.group,
            versuch: x.attempt,
            sekunden: x.seconds,
            abweichung: x.seconds - 30,
            absolute_abweichung: Math.abs(x.seconds - 30),
            klassifikation: good(x.seconds, t) ? "gut" : "schlecht",
            toleranz: t,
            zeitstempel: x.created,
            gueltig: !!x.valid,
          })),
          selected = select(r, e.settings.mode),
          stats = ["all", "student", "staff"].map((g) => ({
            gruppe: g,
            ...describe(selected.filter((x) => g === "all" || x.group === g)),
          })),
          payload = {
            experiment: e,
            datengrundlage: e.settings.mode,
            quartile: "R-7: lineare Interpolation",
            standardabweichung: "Stichprobe: n−1",
            rohdaten: raw,
            kennzahlen: stats,
          };
        const format = u.searchParams.get("format");
        if (format === "xlsx") {
          const book = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(
            book,
            XLSX.utils.json_to_sheet(raw),
            "Rohdaten",
          );
          XLSX.utils.book_append_sheet(
            book,
            XLSX.utils.json_to_sheet(stats),
            "Kennzahlen",
          );
          XLSX.utils.book_append_sheet(
            book,
            XLSX.utils.json_to_sheet([
              {
                experiment: id,
                toleranz: t,
                modus: e.settings.mode,
                eingefroren: e.settings.frozen,
              },
            ]),
            "Metadaten",
          );
          res.writeHead(200, {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="challenge-${id}.xlsx"`,
          });
          return res.end(
            XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
          );
        }
        if (format === "csv") {
          const csvValue = (v) => {
            const s = String(v ?? "");
            return (
              '"' +
              (typeof v === "string" && /^[=+\-@\t\r]/.test(s)
                ? "'" + s
                : s
              ).replaceAll('"', '""') +
              '"'
            );
          };
          const records = u.searchParams.get("kind") === "stats" ? stats : raw,
            keys = Object.keys(records[0] || { experiment_id: "" });
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="challenge-${id}.csv"`,
          });
          return res.end(
            "\uFEFF" +
              [keys, ...records.map((x) => keys.map((k) => x[k]))]
                .map((r) => r.map(csvValue).join(";"))
                .join("\r\n"),
          );
        }
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="challenge-${id}.json"`,
        );
        return json(res, payload);
      }
      throw Object.assign(Error("Nicht gefunden."), { status: 404 });
    }
    if (path.startsWith("/api/"))
      throw Object.assign(Error("Nicht gefunden."), { status: 404 });
    const files = {
        "/": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
        "/stats.js": "stats.js",
      },
      file = files[path];
    if (!file) throw Object.assign(Error("Nicht gefunden."), { status: 404 });
    res.writeHead(200, {
      "Content-Type": file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : file.endsWith(".css")
          ? "text/css"
          : "text/javascript",
    });
    res.end(readFileSync(join(root, "public", file)));
  } catch (err) {
    json(res, { error: err.message }, err.status || 400);
  }
});
server.listen(Number(process.env.PORT || cliPort) || 3000, "0.0.0.0", () =>
  console.log(
    "Challenge läuft auf Port " + (process.env.PORT || cliPort || 3000),
  ),
);
process.on("SIGTERM", () => {
  for (const cs of clients.values()) for (const c of cs) c.end();
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
