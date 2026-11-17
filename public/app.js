import {
  select,
  describe,
  table,
  frequencies,
  difference,
  extreme,
  fisher,
  ranking,
  good,
} from "./stats.js";
const $ = (s) => document.querySelector(s),
  app = $("#app"),
  params = new URLSearchParams(location.search),
  fmt = (v, d = 3) =>
    v == null || !Number.isFinite(v)
      ? "–"
      : v.toLocaleString("de-DE", {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        }),
  pct = (v) =>
    v == null || !Number.isFinite(v) ? "–" : fmt(v * 100, 1) + " %",
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const groups = { student: "Studierende", staff: "Mitarbeitende" },
  modes = {
    all: "Alle Messungen",
    best: "Beste Messung pro Person",
    worst: "Schlechteste Messung pro Person",
    first: "Erste gültige Messung pro Person",
    last: "Neueste gültige Messung pro Person",
  };
let id = params.get("e"),
  view = params.get("view") || "overview",
  status = {},
  state,
  source,
  connected = false,
  selectedGroup = "student",
  timerStart = null,
  interrupted = false,
  result = null,
  rankFilter = "all",
  chartType = "dot",
  metricType = "seconds",
  measureGroup = "all",
  measureAttempt = "all",
  sort = "created",
  sortDir = -1,
  sim = [],
  lastSim = null,
  simKey = "",
  presIndex = 0,
  presFollow = false;
let identity = JSON.parse(localStorage.getItem("challenge-identities") || "{}"),
  outbox = JSON.parse(localStorage.getItem("challenge-outbox") || "[]");
const toast = (s) => {
  const e = $("#toast");
  e.textContent = s;
  e.style.display = "block";
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => (e.style.display = "none"), 5000);
};
async function api(path, body) {
  const targetId = path.match(/^\/api\/e\/([^/]+)/)?.[1] || id;
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(identity[targetId]?.token
        ? { Authorization: "Bearer " + identity[targetId].token }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(Error(data.error || "Verbindung fehlgeschlagen."), {
      code: data.code,
      status: r.status,
    });
  return data;
}
const endpoint = (action) => `/api/e/${id}/${action}`;
async function settings(b) {
  await api(endpoint("settings"), b);
  await load(false);
  draw();
}
async function load(render = true) {
  if (!id) return;
  const previous = state?.experiment;
  state = await api(
    endpoint("state") + (view === "presentation" ? "?presentation=true" : ""),
  );
  if (
    previous?.id === id &&
    previous.settings.round !== state.experiment.settings.round
  ) {
    timerStart = null;
    interrupted = true;
    result = null;
    outbox = outbox.filter((x) => x.experiment !== id);
    localStorage.setItem("challenge-outbox", JSON.stringify(outbox));
    toast(
      "Das Experiment wurde neu gestartet. Alle bisherigen Messungen sind gelöscht; du kannst wieder beginnen.",
    );
    draw();
    return;
  }
  if (render && !timerStart) {
    const focused = document.activeElement;
    if (focused?.closest("form")) return;
    draw();
  }
}
function connect() {
  source?.close();
  source = new EventSource(endpoint("events"));
  source.onopen = () => {
    connected = true;
    updateConnection();
  };
  source.onmessage = () =>
    load().catch(() => {
      connected = false;
      updateConnection();
    });
  source.onerror = () => {
    connected = false;
    updateConnection();
  };
}
function updateConnection() {
  document.querySelectorAll(".connection-status").forEach((e) => {
    e.textContent = connected
      ? "Live verbunden"
      : "Verbindung wird wiederhergestellt";
  });
  document
    .querySelectorAll(".live")
    .forEach((e) => e.classList.toggle("off", !connected));
}
async function flush() {
  if (!navigator.onLine) return;
  for (const x of [...outbox]) {
    try {
      await api(`/api/e/${x.experiment}/measure`, x);
      outbox = outbox.filter((y) => y.id !== x.id);
      localStorage.setItem("challenge-outbox", JSON.stringify(outbox));
    } catch (err) {
      if (err.code === "stale_round") {
        outbox = outbox.filter((y) => y.id !== x.id);
        localStorage.setItem("challenge-outbox", JSON.stringify(outbox));
        toast(
          "Eine Messung aus der vorherigen Runde wurde nach dem Neustart verworfen.",
        );
        continue;
      }
      toast("Messung noch nicht übertragen: " + err.message);
      break;
    }
  }
  await load();
}
function brand() {
  return `<div class="brand"><div class="brandmark">30</div><div class="brandtext">THE 30 SECONDS<br>CHALLENGE<span>Das interaktive Statistiklabor</span></div></div>`;
}
const navItems = [
  ["overview", "◫", "Übersicht"],
  ["measurements", "≋", "Live-Messungen"],
  ["descriptive", "▥", "Deskriptive Statistik"],
  ["contingency", "⊞", "Vierfeldertafel"],
  ["simulation", "⤨", "Simulationslabor"],
  ["ranking", "♧", "Bestenliste"],
  ["settings", "⚙", "Einstellungen"],
  ["export", "↧", "Datenexport"],
];
const icon = (s) => `<span class="ico" aria-hidden="true">${s}</span>`;
function activeRows() {
  return select(state.rows, state.experiment.settings.mode);
}
function metric(label, value, note, cls = "", symbol = "") {
  return `<div class="metric ${cls}"><span class="metric-icon">${symbol}</span><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`;
}
function metrics() {
  const r = state.rows.filter((x) => x.valid),
    s = describe(r),
    n = (g) =>
      state.participants
        .filter((x) => !g || x.group === g)
        .reduce((s, x) => s + x.n, 0),
    best = r.length
      ? r.reduce((a, b) =>
          Math.abs(a.seconds - 30) < Math.abs(b.seconds - 30) ? a : b,
        )
      : null;
  return `<div class="metrics">${metric("Teilnehmende", n(), "in dieser Veranstaltung", "", "♧")}${metric("Studierende", n("student"), "Teilnehmende", "student", "♧")}${metric("Mitarbeitende", n("staff"), "Teilnehmende", "staff", "♧")}${metric("Messungen", r.length, "gültige Versuche", "", "≋")}${metric("Beste Schätzung", best ? fmt(best.seconds) + " <small>s</small>" : "–", best ? "Abweichung " + fmt(Math.abs(best.seconds - 30)) + " s" : "Noch keine Messung", "", "◇")}${metric("Mittlere abs. Abweichung", fmt(s.mae, 2) + " <small>s</small>", "alle gültigen Versuche", "", "∿")}</div>`;
}
function head(title, sub, actions = "") {
  return `<div class="pagehead"><div><div class="eyebrow" style="margin-bottom:9px">Das digitale Statistiklabor</div><h1>${title}</h1><p class="subtitle">${sub}</p></div><div class="actions">${actions}</div></div>`;
}
function basis() {
  const s = state.experiment.settings;
  return `<div class="banner analysis-basis"><div><span>Datengrundlage <b> · ${modes[s.mode]}</b>${s.frozen ? " · Eingefrorener Auswertungsstand" : ""}</span>${["best", "worst"].includes(s.mode) ? "<small>Auswahl anhand der absoluten Abweichung von 30 Sekunden; bei Gleichstand zählt die frühere Messung.</small>" : ""}</div>${
    state.admin
      ? `<select data-setting="mode" aria-label="Datengrundlage">${Object.entries(
          modes,
        )
          .map(
            ([k, v]) =>
              `<option value="${k}" ${s.mode === k ? "selected" : ""}>${v}</option>`,
          )
          .join("")}</select>`
      : ""
  }</div>${s.mode !== "first" ? '<div class="banner warn">Explorative Auswertung: Wiederholungen derselben Person sind nicht unabhängig. Die Auswahl bester, schlechtester oder neuester Messungen kann das Ergebnis beeinflussen. Für den primären Test: erste gültige Messung pro Person.</div>' : ""}`;
}
function toleranceInputs() {
  const t = state.experiment.settings.tolerance;
  return state.admin
    ? `<div class="control tolerance-inputs"><input aria-label="Toleranzbereich" type="range" min="0" max="30" step="0.1" value="${t}" data-tolerance><input aria-label="Toleranz in Sekunden" type="number" min="0" max="30" step="0.1" value="${t}" data-tolerance></div>`
    : "";
}
function toleranceControl() {
  const t = state.experiment.settings.tolerance;
  return `<div class="banner tolerance-toolbar"><div><b>Toleranz: ± ${fmt(t, 1)} Sekunden</b><small>Gut: ${fmt(30 - t, 1)} bis einschließlich ${fmt(30 + t, 1)} Sekunden</small></div>${toleranceInputs()}</div>`;
}
const frequencyModes = {
  absolute: "Absolute Häufigkeiten",
  total: "Relative Häufigkeiten · Gesamtstichprobe",
  column: "Relative Häufigkeiten · je Gruppe (Spalte)",
  row: "Relative Häufigkeiten · je Qualität (Zeile)",
  both: "Absolut und relativ · Gesamtstichprobe",
};
function frequencyControl() {
  const mode = state.experiment.settings.frequency;
  return `<div class="banner frequency-toolbar"><span>Darstellung <b> · ${frequencyModes[mode]}</b></span>${
    state.admin
      ? `<select data-setting="frequency" aria-label="Häufigkeitsdarstellung">${Object.entries(
          frequencyModes,
        )
          .map(
            ([k, v]) =>
              `<option value="${k}" ${mode === k ? "selected" : ""}>${v}</option>`,
          )
          .join("")}</select>`
      : ""
  }</div>`;
}
function chartTools() {
  return `<div class="chart-tools"><button data-action="svg">SVG ↗</button><button data-action="png">PNG ↗</button></div>`;
}
function chartSVG(inner, h = 230, w = 780) {
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Statistische Visualisierung"><rect width="${w}" height="${h}" fill="white"/>${inner}</svg>`;
}
function dotplot(rows = activeRows(), absolute = false) {
  const t = state.experiment.settings.tolerance,
    vals = rows.map((r) => (absolute ? Math.abs(r.seconds - 30) : r.seconds)),
    min = absolute ? 0 : Math.min(15, ...vals) - 1,
    max = Math.max(absolute ? 12 : 45, ...vals) + 1,
    left = 105,
    right = 750,
    dx = (x) => left + ((x - min) / (max - min)) * (right - left);
  const plotted = ["student", "staff"].map((g) => {
    const taken = [];
    return rows
      .filter((x) => x.group === g)
      .map((r) => {
        const x = dx(absolute ? Math.abs(r.seconds - 30) : r.seconds);
        let level = 0;
        while (taken.some((p) => p.level === level && Math.abs(p.x - x) < 10))
          level++;
        const point = { r, x, level };
        taken.push(point);
        return point;
      });
  });
  const heights = plotted.map((a) =>
      Math.max(72, Math.max(0, ...a.map((p) => p.level)) * 10 + 35),
    ),
    starts = [35, 35 + heights[0] + 24],
    bottom = starts[1] + heights[1],
    h = bottom + 65;
  let inner = "";
  const low = absolute ? 0 : 30 - t,
    high = absolute ? t : 30 + t;
  inner += `<rect x="${dx(Math.max(min, low))}" y="25" width="${Math.max(0, dx(Math.min(max, high)) - dx(Math.max(min, low)))}" height="${bottom - 15}" rx="3" fill="#e9f5ef"/><line x1="${dx(absolute ? 0 : 30)}" y1="20" x2="${dx(absolute ? 0 : 30)}" y2="${bottom + 12}" stroke="#739f97" stroke-dasharray="4 4"/><text x="${dx(absolute ? 0 : 30)}" y="12" text-anchor="middle">${absolute ? "Keine Abweichung" : "Zielzeit 30 s"}</text>`;
  for (let j = 0; j < 2; j++) {
    const y = starts[j] + heights[j] - 14,
      c = j ? "#d6a150" : "#1a9690";
    inner += `<text x="0" y="${y - 16}">${groups[j ? "staff" : "student"]}</text><line x1="${left}" x2="${right}" y1="${y + 12}" y2="${y + 12}" stroke="#e5eaed"/>`;
    for (const { r, x, level } of plotted[j])
      inner += `<circle cx="${x}" cy="${y - level * 10}" r="4.2" fill="${good(r.seconds, t) ? c : "#fff"}" stroke="${c}" stroke-width="1.5"><title>${esc(r.nickname)} · ${fmt(absolute ? Math.abs(r.seconds - 30) : r.seconds)} s · Versuch ${r.attempt}</title></circle>`;
  }
  for (let i = 0; i <= 6; i++) {
    const v = min + ((max - min) * i) / 6;
    inner += `<text x="${dx(v)}" y="${bottom + 37}" text-anchor="middle">${fmt(v, 0)}</text>`;
  }
  inner += `<text x="${(left + right) / 2}" y="${bottom + 61}" text-anchor="middle">${absolute ? "Absolute Abweichung von 30 Sekunden" : "Gemessene Zeit in Sekunden"}</text>`;
  if (!rows.length)
    inner += `<text x="420" y="90" text-anchor="middle">Noch keine Messwerte · bereit für das Experiment</text>`;
  return chartSVG(inner, h);
}
function histogram(rows = activeRows(), abs = false) {
  const vals = rows.map((x) => (abs ? Math.abs(x.seconds - 30) : x.seconds)),
    lo = abs ? 0 : Math.min(15, ...vals),
    hi = Math.max(abs ? 12 : 45, ...vals),
    n = 14,
    width = (hi - lo) / n,
    counts = ["student", "staff"].map((g) =>
      Array.from(
        { length: n },
        (_, i) =>
          rows
            .filter((x) => x.group === g)
            .filter((x) => {
              const v = abs ? Math.abs(x.seconds - 30) : x.seconds;
              return Math.min(n - 1, Math.floor((v - lo) / width)) === i;
            }).length,
      ),
    ),
    top = Math.max(1, ...counts.flat()),
    x = (v) => 65 + v * 47;
  let s = "";
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < n; i++) {
      const h = (counts[j][i] / top) * 145;
      s += `<rect x="${x(i) + j * 20}" y="${175 - h}" width="18" height="${h}" rx="2" fill="${j ? "#d6a150" : "#128d88"}"><title>${groups[j ? "staff" : "student"]} · ${fmt(lo + i * width, 1)}–${fmt(lo + (i + 1) * width, 1)} s: ${counts[j][i]}</title></rect>`;
    }
  for (let i = 0; i <= n; i += 2)
    s += `<text x="${x(i)}" y="198" text-anchor="middle">${fmt(lo + i * width, 0)}</text>`;
  s += `<line x1="60" x2="745" y1="176" y2="176" stroke="#dbe4e7"/><text x="65" y="17">Anzahl · maximal ${top}</text><text x="400" y="225" text-anchor="middle">${abs ? "Absolute Abweichung" : "Gemessene Zeit"} in Sekunden</text>`;
  return chartSVG(s);
}
function boxplot(rows = activeRows()) {
  const vals = rows.map((x) => x.seconds),
    lo = Math.min(15, ...vals) - 1,
    hi = Math.max(45, ...vals) + 1,
    x = (v) => 110 + ((v - lo) / (hi - lo)) * 630;
  let s = `<line x1="${x(30)}" x2="${x(30)}" y1="15" y2="190" stroke="#a7bbb7" stroke-dasharray="4"/>`;
  for (let j = 0; j < 2; j++) {
    const g = j ? "staff" : "student",
      r = rows.filter((x) => x.group === g),
      a = r.map((x) => x.seconds).sort((a, b) => a - b),
      d = describe(r),
      y = 65 + j * 85,
      c = j ? "#d6a150" : "#128d88";
    s += `<text x="0" y="${y + 4}">${groups[g]}</text>`;
    if (!a.length) continue;
    const low = a.find((v) => v >= d.q1 - 1.5 * d.iqr),
      high = [...a].reverse().find((v) => v <= d.q3 + 1.5 * d.iqr);
    s += `<line x1="${x(low)}" x2="${x(high)}" y1="${y}" y2="${y}" stroke="${c}"/><rect x="${x(d.q1)}" y="${y - 19}" width="${Math.max(1, x(d.q3) - x(d.q1))}" height="38" fill="${c}22" stroke="${c}"/><line x1="${x(d.median)}" x2="${x(d.median)}" y1="${y - 19}" y2="${y + 19}" stroke="${c}" stroke-width="3"/>`;
    for (const v of [low, high])
      s += `<line x1="${x(v)}" x2="${x(v)}" y1="${y - 10}" y2="${y + 10}" stroke="${c}"/>`;
    for (const v of a.filter((v) => v < low || v > high))
      s += `<circle cx="${x(v)}" cy="${y}" r="3" fill="${c}"><title>Ausreißer: ${fmt(v)} s</title></circle>`;
  }
  for (let i = 0; i < 7; i++) {
    const v = lo + ((hi - lo) * i) / 6;
    s += `<text x="${x(v)}" y="210" text-anchor="middle">${fmt(v, 0)} s</text>`;
  }
  return chartSVG(s);
}
function trend(rows = state.rows.filter((x) => x.valid)) {
  const max = Math.max(2, ...rows.map((x) => x.attempt)),
    top = Math.max(5, ...rows.map((x) => Math.abs(x.seconds - 30)));
  let s = "";
  for (let j = 0; j < 2; j++) {
    const g = j ? "staff" : "student",
      pts = [];
    for (let a = 1; a <= max; a++) {
      const d = describe(rows.filter((x) => x.group === g && x.attempt === a));
      if (d.n)
        pts.push([
          65 + ((a - 1) / (max - 1)) * 660,
          180 - (d.mae / top) * 150,
          a,
          d.mae,
        ]);
    }
    s +=
      `<polyline points="${pts.map((p) => p.slice(0, 2).join(",")).join(" ")}" fill="none" stroke="${j ? "#d6a150" : "#128d88"}" stroke-width="2"/>` +
      pts
        .map(
          ([x, y, a, v]) =>
            `<circle cx="${x}" cy="${y}" r="4" fill="${j ? "#d6a150" : "#128d88"}"><title>Versuch ${a}: ${fmt(v)} s mittlere absolute Abweichung</title></circle>`,
        )
        .join("");
  }
  s += `<line x1="60" x2="735" y1="180" y2="180" stroke="#dce6e9"/><text x="65" y="16">Mittlere absolute Abweichung · 0 bis ${fmt(top, 1)} s</text><text x="65" y="207">Versuch 1</text><text x="725" y="207" text-anchor="end">Versuch ${max}</text>`;
  return chartSVG(s);
}
function chartCard() {
  return `<div class="card"><div class="cardhead"><div><h2>Zeitgefühl im Vergleich</h2><p>Jeder Punkt ist eine Schätzung. Wie nah liegen wir an 30 Sekunden?</p></div>${chartTools()}</div><div class="legend"><span><i class="dot"></i>Studierende</span><span><i class="dot staff"></i>Mitarbeitende</span><span>○ außerhalb der Toleranz</span></div><div style="margin-top:20px">${dotplot()}</div><div class="chartfooter"><span>Schattierter Bereich: ± ${fmt(state.experiment.settings.tolerance, 1)} Sekunden</span><span>${activeRows().length} Messungen · ${modes[state.experiment.settings.mode]}</span></div></div>`;
}
function toleranceCard() {
  const s = state.experiment.settings,
    t = s.tolerance;
  return `<div class="card"><div class="cardhead"><div><h2>Was ist eine gute Schätzung?</h2><p>Toleranzbereich um die Zielzeit festlegen</p></div><span class="badge">${s.lockedTolerance == null ? "Exploration" : "Vorab festgelegt"}</span></div><div class="tolerance-number">± ${fmt(t, 1)} <small>Sekunden</small></div>${toleranceInputs()}<div class="range-labels"><span>0 s</span><span>± 30 s</span></div><p class="note">Gute Schätzung: <b>${fmt(30 - t, 1)} bis einschließlich ${fmt(30 + t, 1)} Sekunden.</b><br>Absolute Abweichung ≤ ${fmt(t, 1)} Sekunden.</p><div class="divider"></div>${s.lockedTolerance == null ? '<button class="small" data-action="lock">♧ Für konfirmatorischen Test fixieren</button>' : `<p class="note">Fixierter Toleranzwert: <b>± ${fmt(s.lockedTolerance, 1)} s</b>${t !== s.lockedTolerance ? "<br><b>Explorative Änderung aktiv.</b> Der primäre Test verwendet weiterhin den fixierten Wert." : ""}</p>`}</div>`;
}
function crossTable(
  mode = state.experiment.settings.frequency,
  t = state.experiment.settings.tolerance,
  rows = activeRows(),
) {
  const z = table(rows, t),
    matrix = [
      [z.a, z.b, z.a + z.b],
      [z.c, z.d, z.c + z.d],
      [z.a + z.c, z.b + z.d, z.a + z.b + z.c + z.d],
    ],
    relative = frequencies(z, mode),
    render = (v, r, c) => {
      const rel = relative[r][c];
      return mode === "absolute"
        ? `<strong>${v}</strong>`
        : mode === "both"
          ? `<strong>${v}</strong><small>${pct(rel)}</small>`
          : `<strong>${pct(rel)}</strong>`;
    };
  return `<div class="tablewrap"><table class="cross"><thead><tr><th></th><th style="color:var(--teal)">Studierende</th><th style="color:#bd8a40">Mitarbeitende</th><th>Gesamt</th></tr></thead><tbody>${matrix.map((r, i) => `<tr class="${i === 0 ? "goodrow" : i === 2 ? "total" : ""}"><td>${["Gute Schätzung", "Schlechte Schätzung", "Gesamt"][i]}</td>${r.map((v, j) => `<td class="${j === 2 ? "total" : ""}">${render(v, i, j)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function shares(rows = activeRows(), t = state.experiment.settings.tolerance) {
  const z = table(rows, t),
    a = z.a / (z.a + z.c),
    b = z.b / (z.b + z.d);
  return `<div class="progress-row"><span style="width:95px">Studierende</span><div class="bar-track"><div class="bar-fill" style="width:${Number.isFinite(a) ? a * 100 : 0}%"></div></div><b>${pct(a)}</b></div><div class="progress-row"><span style="width:95px">Mitarbeitende</span><div class="bar-track"><div class="bar-fill staff" style="width:${Number.isFinite(b) ? b * 100 : 0}%"></div></div><b>${pct(b)}</b></div><div class="note">Anteil guter Schätzungen · Differenz: <b>${fmt(difference(z) == null ? null : difference(z) * 100, 1)} Prozentpunkte</b></div>`;
}
function measurementTable(limit) {
  let r = state.rows
    .filter(
      (x) =>
        (measureGroup === "all" || x.group === measureGroup) &&
        (measureAttempt === "all" || x.attempt === Number(measureAttempt)),
    )
    .sort((a, b) => {
      let av = sort === "deviation" ? Math.abs(a.seconds - 30) : a[sort],
        bv = sort === "deviation" ? Math.abs(b.seconds - 30) : b[sort];
      return (
        (typeof av === "number"
          ? av - bv
          : String(av).localeCompare(String(bv))) * sortDir
      );
    });
  if (limit) r = r.slice(0, limit);
  const t = state.experiment.settings.tolerance;
  return `<div class="tablewrap"><table><thead><tr>${[
    ["nickname", "Nickname"],
    ["group", "Gruppe"],
    ["attempt", "Versuch"],
    ["seconds", "Gemessene Zeit"],
    ["deviation", "Abs. Abweichung"],
    ["created", "Zeitpunkt"],
  ]
    .map(
      ([k, v]) =>
        `<th><button class="small" style="border:0;background:transparent;padding:0;color:inherit" data-sort="${k}">${v} ${sort === k ? (sortDir === 1 ? "↑" : "↓") : ""}</button></th>`,
    )
    .join(
      "",
    )}<th>Schätzung</th>${limit ? "" : "<th>Status</th>"}</tr></thead><tbody>${r.map((x) => `<tr class="${x.valid ? "" : "invalid"}"><td><b style="font-weight:500">${esc(x.nickname)}</b></td><td><span class="group ${x.group === "staff" ? "staff" : ""}">${groups[x.group]}</span></td><td>${x.attempt}</td><td>${fmt(x.seconds)} s</td><td>${fmt(Math.abs(x.seconds - 30))} s</td><td style="color:#929da6">${new Date(x.created).toLocaleTimeString("de-DE")}</td><td><span class="quality ${good(x.seconds, t) ? "" : "bad"}">${good(x.seconds, t) ? "Gut" : "Außerhalb"}</span></td>${limit ? "" : `<td><button class="small" data-valid="${x.id}" data-value="${!x.valid}">${x.valid ? "Ausschließen" : "Zulassen"}</button></td>`}</tr>`).join("")}</tbody></table>${!r.length ? '<div class="empty"><strong>Bereit für die ersten Messungen</strong>Teile den Teilnahmelink oder starte eine getrennte Demo-Veranstaltung.</div>' : ""}</div>`;
}
function overview() {
  return (
    head(
      "Das Experiment im Überblick",
      "Wer hat das bessere Zeitgefühl – Studierende oder Mitarbeitende?",
      `<button data-action="invite">▦ Teilnehmen lassen</button><button class="danger" data-action="restart">↻ Experiment neu starten</button><button class="primary" data-view="presentation">▷ Präsentationsmodus</button>`,
    ) +
    metrics() +
    basis() +
    `<div class="grid"><div>${chartCard()}<div class="card"><div class="cardhead"><div><h2>Live-Messungen</h2><p>Die neuesten Schätzungen aus dem Experiment</p></div><button class="small" data-view="measurements">Alle Messungen ↗</button></div>${measurementTable(6)}</div></div><div>${toleranceCard()}<div class="card"><div class="cardhead"><div><h2>Vom Zeitgefühl zur Vierfeldertafel</h2><p>Wie viele Schätzungen liegen im Toleranzbereich?</p></div></div>${crossTable("absolute")}${shares()}<button class="small" data-view="contingency" style="margin-top:15px">Vierfeldertafel öffnen ↗</button></div></div></div>`
  );
}
const statNames = {
  persons: "Anzahl der Personen",
  n: "Anzahl der Messungen",
  mean: "Arithmetisches Mittel",
  median: "Median",
  min: "Minimum",
  max: "Maximum",
  range: "Spannweite",
  q1: "Erstes Quartil Q₁",
  q3: "Drittes Quartil Q₃",
  iqr: "Interquartilsabstand",
  sd: "Empirische Standardabweichung (n − 1)",
  bias: "Mittlere vorzeichenbehaftete Abweichung",
  mae: "Mittlere absolute Abweichung",
  medae: "Median der absoluten Abweichungen",
  under: "Anteil der Unterschätzungen",
  over: "Anteil der Überschätzungen",
};
function statsTable() {
  const r = activeRows(),
    ds = ["student", "staff", "all"].map((g) =>
      describe(r.filter((x) => g === "all" || x.group === g)),
    );
  const summary = `<div class="analysis-summary">${ds.map((d, i) => `<span><b>${["Studierende", "Mitarbeitende", "Gesamt"][i]}</b>: ${d.persons} ${d.persons === 1 ? "Person" : "Personen"} · ${d.n} ${d.n === 1 ? "Messung" : "Messungen"}</span>`).join("")}</div>${ds.some((d) => d.n === 1) ? '<p class="note single-value-note">Bei nur einer einbezogenen Messung sind Mittelwert, Median, Minimum und Maximum identisch. Wähle „Alle Messungen“, um auch Wiederholungen einzubeziehen.</p>' : ""}`;
  return `${summary}<div class="tablewrap"><table><thead><tr><th>Kennzahl</th><th>Studierende</th><th>Mitarbeitende</th><th>Gesamt</th></tr></thead><tbody>${Object.entries(
    statNames,
  )
    .map(
      ([k, v]) =>
        `<tr><td>${v}</td>${ds.map((d) => `<td>${["persons", "n"].includes(k) ? d[k] : ["under", "over"].includes(k) ? pct(d[k]) : fmt(d[k]) + " s"}</td>`).join("")}</tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><p class="note" style="margin:16px 0 0">Quartile: lineare Interpolation (R-7). Standardabweichung mit Nenner n − 1; bei weniger als zwei Messungen nicht definiert. Exakt 30 s zählen weder als Unter- noch als Überschätzung.</p>`;
}
function descriptives() {
  const charts = {
    dot: () => dotplot(activeRows(), metricType === "absolute"),
    hist: () => histogram(activeRows(), metricType === "absolute"),
    box: boxplot,
    trend: trend,
  };
  return (
    head(
      "Deskriptive Statistik",
      "Metrische Daten erkunden und die beiden Gruppen vergleichen.",
    ) +
    basis() +
    `<div class="card"><div class="cardhead"><div><h2>Verteilungen im Vergleich</h2><p>Mit der Maus über Messwerte fahren, um Details anzuzeigen.</p></div>${chartTools()}</div><div class="filters">${[
      ["dot", "Punktdiagramm"],
      ["hist", "Histogramm"],
      ["box", "Boxplots"],
      ["trend", "Entwicklung"],
    ]
      .map(
        ([k, v]) =>
          `<button class="small ${chartType === k ? "primary" : ""}" data-chart="${k}">${v}</button>`,
      )
      .join(
        "",
      )}<select id="metric-type" aria-label="Messgröße"><option value="seconds">Gemessene Zeit</option><option value="absolute" ${metricType === "absolute" ? "selected" : ""}>Absolute Abweichung</option></select></div><div style="margin-top:22px">${charts[chartType]()}</div><div class="legend"><span><i class="dot"></i>Studierende</span><span><i class="dot staff"></i>Mitarbeitende</span></div>${chartType === "box" ? '<p class="note">Box: Q₁ bis Q₃; Linie: Median; Whisker: äußerste Werte innerhalb von 1,5 IQR; übrige Werte als einzelne Punkte.</p>' : ""}${chartType === "trend" ? '<p class="note">Die Entwicklung verwendet alle gültigen Versuche, getrennt nach Versuchsnummer. Die Zusammensetzung kann sich je Versuch ändern.</p>' : ""}</div><div class="card"><div class="cardhead"><h2>Kennzahlen im Gruppenvergleich</h2><button class="small" data-export="xlsx">Excel exportieren ↧</button></div>${statsTable()}</div>`
  );
}
function categoryCharts() {
  const z = table(activeRows(), state.experiment.settings.tolerance),
    n = z.a + z.b + z.c + z.d;
  let s = "";
  const max = Math.max(1, z.a, z.b, z.c, z.d);
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const v = [
          [z.a, z.c],
          [z.b, z.d],
        ][j][i],
        h = (v / max) * 130;
      s += `<rect x="${150 + j * 310 + i * 66}" y="${165 - h}" width="55" height="${h}" fill="${j ? "#d6a150" : "#128d88"}" opacity="${i ? 0.35 : 1}"/><text x="${178 + j * 310 + i * 66}" y="${155 - h}" text-anchor="middle">${v}</text><text x="${178 + j * 310 + i * 66}" y="186" text-anchor="middle">${i ? "Schlecht" : "Gut"}</text>`;
    }
    s += `<text x="${210 + j * 310}" y="214" text-anchor="middle">${groups[j ? "staff" : "student"]}</text>`;
  }
  return `<div class="card"><div class="cardhead"><h2>Absolute Häufigkeiten</h2>${chartTools()}</div>${chartSVG(s)}</div><div class="card"><h2>Spaltenrelative Häufigkeiten</h2>${[
    "student",
    "staff",
  ]
    .map((g, i) => {
      const yes = i ? z.b : z.a,
        no = i ? z.d : z.c,
        p = yes / (yes + no) || 0;
      return `<label>${groups[g]}</label><div class="stackbar"><div style="width:${p * 100}%;background:${i ? "#d6a150" : "#128d88"}">${pct(p)}</div><div style="flex:1;background:${i ? "#eddbbf" : "#b7d9d4"};color:#48636a">${yes + no ? pct(1 - p) : "Keine Daten"}</div></div>`;
    })
    .join(
      "",
    )}<p class="note">Kräftige Farbe: gute Schätzung. Helle Farbe: schlechte Schätzung.</p><h3 style="margin-top:25px">Mosaikdiagramm · Flächen entsprechen Häufigkeiten</h3><div style="display:flex;height:145px;gap:4px">${[
    [z.a, z.c, "student"],
    [z.b, z.d, "staff"],
  ]
    .map(
      ([a, c, g]) =>
        `<div style="width:${n ? ((a + c) / n) * 100 : 50}%;display:flex;flex-direction:column"><div style="height:${a + c ? (a / (a + c)) * 100 : 0}%;background:${g === "student" ? "#128d88" : "#d6a150"}"></div><div style="flex:1;background:${g === "student" ? "#c8e5df" : "#f2e3ca"}"></div></div>`,
    )
    .join(
      "",
    )}</div><p class="note">Links: Studierende; rechts: Mitarbeitende. Oben: gut; unten: schlecht.</p></div>`;
}
function contingency() {
  return (
    head(
      "Die dynamische Vierfeldertafel",
      "Von metrischen Messwerten zu kategorialen Daten.",
      `<button data-view="presentation" data-slide="contingency">▷ Großansicht</button>`,
    ) +
    basis() +
    `<div class="grid"><div><div class="card"><div class="cardhead"><div><h2>Gute und schlechte Schätzungen</h2><p>Eine gute Schätzung liegt innerhalb des geschlossenen Toleranzintervalls.</p></div></div>${frequencyControl()}${crossTable()}${shares()}</div>${categoryCharts()}</div><div>${toleranceCard()}<div class="card"><h2>Der nächste Schritt</h2><p class="note">Ist die beobachtete Differenz mit zufälliger Variation unter gleicher Erfolgswahrscheinlichkeit vereinbar?</p><button class="primary" data-view="simulation">Simulationslabor öffnen →</button></div></div></div>`
  );
}
function simHistogram(z, obs, side, reveal) {
  const bins = Array(31).fill(0),
    tails = Array(31).fill(0);
  for (const x of sim) {
    const i = Math.max(0, Math.min(30, Math.round((x + 1) * 15)));
    bins[i]++;
    if (extreme(x, obs, side)) tails[i]++;
  }
  const top = Math.max(1, ...bins);
  let s = "";
  for (let i = 0; i < 31; i++) {
    const h = (bins[i] / top) * 155,
      th = reveal >= 6 ? (tails[i] / top) * 155 : 0;
    s += `<rect x="${60 + i * 21}" y="${185 - h}" width="19" height="${h}" fill="#98bcb8"/><rect x="${60 + i * 21}" y="${185 - th}" width="19" height="${th}" fill="#d4a057"><title>${bins[i]} Simulationen</title></rect>`;
  }
  if (reveal >= 5 && obs != null)
    for (const v of side === "two" ? [Math.abs(obs), -Math.abs(obs)] : [obs])
      s += `<line x1="${69 + (v + 1) * 315}" x2="${69 + (v + 1) * 315}" y1="15" y2="190" stroke="#c68b3f" stroke-width="2" stroke-dasharray="5 3"/><text x="${69 + (v + 1) * 315}" y="12" text-anchor="middle">${fmt(v * 100, 1)} pp</text>`;
  for (let i = 0; i <= 4; i++)
    s += `<text x="${69 + i * 157.5}" y="209" text-anchor="middle">${-100 + i * 50}</text>`;
  s += `<text x="390" y="232" text-anchor="middle">Differenz der Anteile in Prozentpunkten · Studierende − Mitarbeitende</text>`;
  return chartSVG(s, 245);
}
function simulationContent() {
  const s = state.experiment.settings,
    t = s.lockedTolerance ?? s.tolerance,
    z = table(activeRows(), t),
    obs = difference(z),
    key = JSON.stringify([z, s.side, s.mode, t]);
  if (key !== simKey) {
    sim = [];
    lastSim = null;
    simKey = key;
  }
  if (state.simulation?.key === key) {
    sim = state.simulation.values;
    lastSim = state.simulation.last;
  } else {
    sim = [];
    lastSim = null;
  }
  const reveal = s.reveal,
    k = sim.filter((x) => extreme(x, obs, s.side)).length,
    p = (k + 1) / (sim.length + 1),
    exact = fisher(z, s.side),
    labels = [
      "Beobachtete Tafel",
      "Nullhypothese",
      "Einzelne Neuzuordnung",
      "Simulationsverteilung",
      "Beobachtete Teststatistik",
      "Extreme Ergebnisse",
      "Approximierter p-Wert",
      "Exakter p-Wert",
      "Testentscheidung",
    ];
  return `${s.mode !== "first" ? '<div class="alert">Explorative Auswertung: Für den primären Signifikanztest den ersten gültigen Versuch pro Person wählen.</div>' : ""}${!s.simulation ? '<div class="banner warn">Das Modul ist für die Präsentation noch nicht freigegeben. Freigabe in den Einstellungen.</div>' : ""}<div class="card"><div class="cardhead"><div><h2>Schritt für Schritt zur statistischen Entscheidung</h2><p>Stufe ${reveal} von 9 · ${labels[reveal - 1]}</p></div><span class="badge">Testtoleranz ± ${fmt(t, 1)} s ${s.lockedTolerance != null ? "· fixiert" : "· explorativ"}</span></div><div class="stepper">${labels.map((_, i) => `<span class="${i < reveal ? "on" : ""}"></span>`).join("")}</div><div class="reveal"><span>Einblenden</span><input type="range" min="1" max="9" step="1" value="${reveal}" data-setting="reveal" aria-label="Didaktische Stufe"><span>${reveal}/9</span></div></div><div class="grid"><div><div class="card"><h2>Beobachtete Vierfeldertafel</h2>${crossTable("absolute", t)}${reveal >= 2 ? '<div class="divider"></div><h3>H₀: Gleiche Wahrscheinlichkeit einer guten Schätzung</h3><p class="note">H₁: ' + (s.side === "two" ? "Die Wahrscheinlichkeiten unterscheiden sich." : s.side === "left" ? "Studierende haben eine geringere Erfolgswahrscheinlichkeit." : "Studierende haben eine höhere Erfolgswahrscheinlichkeit.") + "</p>" : ""}${reveal >= 5 ? `<div class="tolerance-number">${fmt(obs == null ? null : obs * 100, 2)} <small>Prozentpunkte beobachtete Differenz</small></div>` : ""}</div>${reveal >= 3 ? `<div class="card"><div class="cardhead"><div><h2>Zufällige Neuzuordnung unter H₀</h2><p>Gruppengrößen und Gesamtzahl guter Schätzungen bleiben konstant.</p></div></div><div class="actions">${[1, 10, 100, 1000, 10000].map((n) => `<button class="small ${n === 1000 ? "primary" : ""}" data-sim="${n}" ${obs == null ? "disabled" : ""}>${n.toLocaleString("de-DE")} ${n === 1 ? "Simulation" : "Simulationen"}</button>`).join("")}<button class="small" data-action="reset-sim">Zurücksetzen</button></div>${lastSim ? `<div class="symbols" aria-label="Letzte zufällige Zuordnung">${["a", "c", "b", "d"].map((key) => Array.from({ length: Math.min(150, lastSim[key]) }, () => `<span title="${["a", "c"].includes(key) ? "Studierende" : "Mitarbeitende"} · ${["a", "b"].includes(key) ? "Gut" : "Schlecht"}" class="symbol ${["a", "b"].includes(key) ? "good" : ""} ${["b", "d"].includes(key) ? "staff" : ""}"></span>`).join("")).join("")}</div><p class="note">Letzte simulierte Tafel: gut (${lastSim.a} | ${lastSim.b}), schlecht (${lastSim.c} | ${lastSim.d}). Teststatistik: ${fmt(difference(lastSim) * 100, 2)} pp. Symbolanzeige auf 150 je Zelle begrenzt.</p>` : '<div class="empty">Starte eine Simulation und beobachte die zufällige Zuordnung.</div>'}</div>` : ""}${reveal >= 4 ? `<div class="card"><div class="cardhead"><div><h2>Die Nullverteilung entsteht</h2><p>${sim.length.toLocaleString("de-DE")} zufällige Neuzuordnungen</p></div>${chartTools()}</div>${simHistogram(z, obs, s.side, reveal)}${reveal >= 6 ? '<p class="note">Gold: mindestens so extrem wie beobachtet. Zweiseitig bedeutet |D*| ≥ |D beobachtet|.</p>' : ""}</div>` : ""}</div><div><div class="card"><h2>Test konfigurieren</h2><label>Alternativhypothese</label><select data-setting="side" style="width:100%">${[
    ["two", "Zweiseitig"],
    ["left", "Linksseitig (Studierende < Mitarbeitende)"],
    ["right", "Rechtsseitig (Studierende > Mitarbeitende)"],
  ]
    .map(
      ([k, v]) =>
        `<option value="${k}" ${s.side === k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select><label>Signifikanzniveau α</label><input type="number" data-setting="alpha" min="0.001" max="0.5" step="0.01" value="${s.alpha}"><p class="note">Standard: α = 0,05 (5 %).</p>${reveal >= 7 ? `<div class="divider"></div><h3>Monte-Carlo-Ergebnis</h3><div class="sim-values" style="grid-template-columns:1fr 1fr"><div><small>Simulationen B</small>${sim.length}</div><div><small>Extreme Ergebnisse k</small>${k}</div></div><p class="note">Relativer Anteil k/B: <b>${sim.length ? fmt(k / sim.length, 4) : "–"}</b></p><div class="tolerance-number">${sim.length ? fmt(p, 4) : "–"} <small>approximierter p-Wert</small></div><p class="note">Monte-Carlo-Korrektur: (k + 1)/(B + 1). ${sim.length ? "Monte-Carlo-Standardfehler ≈ " + fmt(Math.sqrt((p * (1 - p)) / (sim.length + 1)), 4) : "Zunächst Simulationen durchführen."}</p>` : ""}${reveal >= 8 ? `<div class="divider"></div><h3>Exakter Fisher-Test</h3><div class="tolerance-number">${fmt(exact, 4)}</div><p class="note">Zweiseitig: Summe der Wahrscheinlichkeiten aller Tafeln, die unter den fixierten Rändern höchstens so wahrscheinlich wie die beobachtete Tafel sind. Diese Definition kann vom zweiseitigen Permutationstest mit |D| abweichen.</p>` : ""}${reveal >= 9 ? `<div class="divider"></div><h3>Statistische Testentscheidung (exakt)</h3><p class="note">${exact == null ? "Beide Gruppen benötigen gültige Messungen." : exact <= s.alpha ? `p ≤ α: H₀ wird auf dem Niveau ${pct(s.alpha)} verworfen.` : `p > α: H₀ wird auf dem Niveau ${pct(s.alpha)} nicht verworfen. Dies beweist H₀ nicht.`}</p>` : ""}</div><div class="card"><h2>Methodisch einordnen</h2><p class="note">Die Permutation setzt Austauschbarkeit unter H₀ voraus. Die Gruppenzugehörigkeit wurde nicht randomisiert: Störvariablen können Unterschiede erklären. Eine Gelegenheitsstichprobe erlaubt weder kausale Schlussfolgerungen noch eine uneingeschränkte Verallgemeinerung.</p><p class="note">Ein p-Wert beschreibt die Wahrscheinlichkeit mindestens ebenso extremer Ergebnisse unter H₀ und den Modellannahmen. Er ist keine Wahrscheinlichkeit dafür, dass H₀ wahr ist.</p></div></div></div>`;
}
function simulations() {
  return (
    head(
      "Simulationslabor",
      "Wie überraschend ist unser beobachteter Unterschied unter der Nullhypothese?",
    ) +
    basis() +
    simulationContent()
  );
}
function rankingContent() {
  const r = state.leaderboard.filter(
    (x) => rankFilter === "all" || x.group === rankFilter,
  );
  return `<div class="tabs">${[
    ["all", "Gesamtwertung"],
    ["student", "Studierende"],
    ["staff", "Mitarbeitende"],
  ]
    .map(
      ([k, v]) =>
        `<button class="${rankFilter === k ? "selected" : ""}" data-rank="${k}">${v}</button>`,
    )
    .join(
      "",
    )}</div><div class="tablewrap"><table><thead><tr><th>Platz</th><th>Nickname</th><th>Gruppe</th><th>Beste Schätzung</th><th>Absolute Abweichung</th></tr></thead><tbody>${r.map((x, i) => `<tr class="${x.self ? "self" : ""}"><td><span class="ranknum ${i < 3 ? "top" + (i + 1) : ""}">${i + 1}</span></td><td>${esc(x.nickname)} ${x.self ? '<span class="badge">Du</span>' : ""}</td><td><span class="group ${x.group === "staff" ? "staff" : ""}">${groups[x.group]}</span></td><td>${fmt(x.seconds)} s</td><td><b>${fmt(Math.abs(x.seconds - 30))} s</b></td></tr>`).join("")}</tbody></table>${!r.length ? '<div class="empty">Noch keine gültigen Messungen.</div>' : ""}</div><p class="note" style="margin-top:20px">Pro Person zählt nur der beste gültige Versuch. Bei gleicher Abweichung wird der früher eingegangene Versuch zuerst angezeigt.</p>`;
}
function rankings() {
  return (
    head(
      "Die besten Schätzungen",
      "Wie nah kommt das Zeitgefühl an die Zielzeit?",
    ) +
    `<div class="card"><div class="cardhead"><h2>Bestenliste</h2><span class="badge">Live · bester gültiger Versuch pro Person</span></div>${rankingContent()}</div>`
  );
}
function settingsPage() {
  const e = state.experiment,
    s = e.settings;
  return (
    head(
      "Experiment verwalten",
      "Steuere die Veranstaltung, Freigaben und den Auswertungsstand.",
    ) +
    `<div class="grid"><div><div class="card"><h2>Veranstaltungssteuerung</h2>${[
      [
        "registration",
        "Anmeldung geöffnet",
        "Neue Personen können der Veranstaltung beitreten.",
      ],
      [
        "running",
        "Experimentierphase aktiv",
        "Messungen können durchgeführt und eingereicht werden.",
      ],
      [
        "simulation",
        "Simulationslabor freigeben",
        "Das Modul wird für die Präsentation verfügbar.",
      ],
      [
        "publicPresentation",
        "Öffentliche Projektion freigeben",
        "Lesender Zugriff auf die präsentierten Messdaten mit Pseudonymen. Steuerung bleibt bei der Administration.",
      ],
    ]
      .map(
        ([k, v, n]) =>
          `<div class="settingrow"><div><b>${v}</b><p>${n}</p></div><input type="checkbox" data-setting="${k}" ${s[k] ? "checked" : ""} aria-label="${v}"></div>`,
      )
      .join(
        "",
      )}<div class="settingrow"><div><b>Maximale Versuche pro Person</b><p>0 bedeutet unbegrenzt. Ungültige Versuche zählen mit.</p></div><input type="number" data-setting="maxAttempts" min="0" max="100" value="${s.maxAttempts}" aria-label="Maximale Versuche"></div><div class="settingrow"><div><b>Auswertungsstand einfrieren</b><p>Die Erhebung läuft weiter; Auswertungen verwenden die gesicherte Kopie.</p></div><button class="small" data-action="freeze">Stand jetzt sichern</button></div><div class="settingrow"><div><b>Eingefrorenen Datenstand verwenden</b><p>Zurück zu Live-Daten wechseln, ohne die Kopie zu löschen.</p></div><input type="checkbox" data-setting="frozen" ${s.frozen ? "checked" : ""} aria-label="Eingefrorene Daten verwenden"></div></div><div class="card"><h2>Veranstaltungen</h2><label>Frühere Veranstaltung öffnen</label><select id="experiment-picker" style="width:100%">${status.experiments.map((x) => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${esc(x.name)} ${x.demo ? "[DEMO]" : ""} · ${x.id}</option>`).join("")}</select><form id="new-experiment"><label for="experiment-name">Neue Veranstaltung</label><input id="experiment-name" name="name" placeholder="z. B. Lehrprobe · November 2026" required maxlength="100" style="width:100%"><label><input type="checkbox" name="demo"> Getrennte Demo-Veranstaltung</label><button class="primary" style="margin-top:12px">Veranstaltung anlegen</button></form></div><div class="card"><h2>Experiment neu starten</h2><p class="note">Löscht alle Messungen, Simulationen und den eingefrorenen Stand. Angemeldete Personen und Teilnahmelink bleiben erhalten. Anmeldung und Messphase werden geöffnet.</p><button class="danger" data-action="restart">↻ Experiment neu starten …</button></div><div class="card"><h2>Datenbestand vollständig löschen</h2><p class="note">Löscht alle Personen, Messungen und den eingefrorenen Stand dieser Veranstaltung dauerhaft. Andere Veranstaltungen bleiben erhalten.</p><button class="danger" data-action="reset-data">Daten löschen …</button></div></div><div>${toleranceCard()}<div class="card"><h2>Teilnahmelink</h2><img src="${endpoint("qr")}" alt="QR-Code zum Teilnahmelink" style="width:170px;display:block;margin:20px auto"><p class="note" style="word-break:break-all">${esc(location.origin + "/?e=" + id + "&view=participate")}</p><button class="small" data-action="copy">Link kopieren</button><p class="note" style="margin-top:18px">Öffentliche Projektion (nach Freigabe):<br><a href="/?e=${id}&view=presentation" target="_blank" rel="noopener">Projektionsansicht öffnen ↗</a></p></div>${e.demo ? `<div class="card"><span class="badge demo">DEMO · strikt getrennt</span><h2 style="margin-top:15px">Beispieldaten erzeugen</h2><form id="demo-form"><label for="demo-n">Anzahl Personen (2–500)</label><input id="demo-n" name="n" type="number" min="2" max="500" value="60"><label for="demo-share">Anteil Studierende (%)</label><input id="demo-share" name="share" type="number" min="0" max="100" value="60"><button class="primary" style="margin-top:20px">Demo-Datensatz erzeugen</button></form><p class="note" style="margin-top:15px">Ein normalverteilter Versuch pro Person. Bestehende Demo-Daten vorher zurücksetzen.</p></div>` : '<div class="card"><h2>Für die Lehrprobe üben</h2><p class="note">Lege eine neue Veranstaltung mit aktivierter Demo-Option an. Beispieldaten können niemals in reale Veranstaltungen geschrieben werden.</p></div>'}</div></div>`
  );
}
function exportPage() {
  return (
    head(
      "Datenexport",
      "Rohdaten und berechnete Kennzahlen für deine weitere Auswertung.",
    ) +
    basis() +
    `<div class="card"><h2>Daten herunterladen</h2><p class="note">Die Exporte beziehen sich auf den aktuellen Live- oder eingefrorenen Datenstand. Rohdaten enthalten auch ausgeschlossene Messungen mit Gültigkeitsstatus; Kennzahlen verwenden die gewählte Datengrundlage.</p><div class="formgrid" style="grid-template-columns:repeat(3,1fr);margin-top:25px">${[
      ["csv", "CSV", "Rohdaten · UTF-8 · Semikolon"],
      ["xlsx", "Excel", "Rohdaten, Kennzahlen und Metadaten"],
      ["json", "JSON", "Vollständiger strukturierter Export"],
    ]
      .map(
        ([k, v, n]) =>
          `<div class="card"><div class="eyebrow">.${k}</div><h2 style="margin-top:16px">${v}</h2><p class="note">${n}</p><button data-export="${k}" class="primary small">Herunterladen ↧</button></div>`,
      )
      .join(
        "",
      )}</div><button data-export="csv" data-kind="stats">Kennzahlen als CSV</button></div><div class="card"><h2>Diagramme exportieren</h2><p class="note">Jede Diagrammkarte bietet SVG- und PNG-Export. SVG eignet sich für verlustfreie Skalierung in Folien und Publikationen.</p><button data-view="descriptive">Zu den Visualisierungen →</button></div>`
  );
}
function measurements() {
  return (
    head(
      "Live-Messungen",
      "Alle eingehenden Messungen – automatisch aktualisiert.",
    ) +
    toleranceControl() +
    `<div class="card"><div class="cardhead"><h2>Messprotokoll</h2><div class="filters"><select id="measure-group" aria-label="Gruppe filtern">${[
      ["all", "Alle Gruppen"],
      ["student", "Studierende"],
      ["staff", "Mitarbeitende"],
    ]
      .map(
        ([k, v]) =>
          `<option value="${k}" ${measureGroup === k ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select><select id="measure-attempt" aria-label="Versuch filtern"><option value="all">Alle Versuche</option>${Array.from(
      new Set(state.rows.map((x) => x.attempt)),
    )
      .sort((a, b) => a - b)
      .map(
        (n) => `<option ${measureAttempt == n ? "selected" : ""}>${n}</option>`,
      )
      .join("")}</select></div></div>${measurementTable()}</div>`
  );
}
function draw() {
  if (timerStart) return;
  if (
    view === "participate" ||
    view === "personal" ||
    view === "participant-ranking"
  ) {
    drawParticipant();
    return;
  }
  if (view === "presentation" && (state?.admin || state?.presentation)) {
    drawPresentation();
    return;
  }
  if (!status.admin) {
    drawLogin();
    return;
  }
  const e = state.experiment,
    body =
      {
        overview,
        measurements,
        descriptive: descriptives,
        contingency,
        simulation: simulations,
        ranking: rankings,
        settings: settingsPage,
        export: exportPage,
      }[view] || overview;
  app.innerHTML = `<aside class="sidebar">${brand()}<div class="navlabel">EXPERIMENT</div><nav class="nav">${navItems
    .slice(0, 6)
    .map(
      ([k, i, v]) =>
        `<button data-view="${k}" class="${view === k ? "active" : ""}">${icon(i)}${v}</button>`,
    )
    .join(
      "",
    )}</nav><div class="navlabel">VERWALTUNG</div><nav class="nav">${navItems
    .slice(6)
    .map(
      ([k, i, v]) =>
        `<button data-view="${k}" class="${view === k ? "active" : ""}">${icon(i)}${v}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><span class="seal">▥</span><strong>Universität Paderborn</strong>Mathematikdidaktik<br><div style="margin-top:18px;font-size:9px;color:#7894a5">ERLEBEN. FORSCHEN. VERSTEHEN.</div></div></aside><main class="main"><header class="topbar"><div class="crumb">Statistiklabor <b>/ ${navItems.find((x) => x[0] === view)?.[2] || "Übersicht"}</b></div><div class="top-actions"><span class="live ${connected ? "" : "off"}"><span class="connection-status">${connected ? "Live verbunden" : "Verbindung wird wiederhergestellt"}</span></span><span class="badge ${e.demo ? "demo" : ""}">${e.demo ? "Demo-Veranstaltung" : "Live-Experiment"} · ${esc(e.id)}</span><button class="small" data-action="logout">Abmelden</button><span class="avatar">AD</span></div></header><div class="content">${e.demo ? '<div class="banner warn"><span><b>DEMO-MODUS</b> · Sämtliche Daten dieser Veranstaltung sind simulierte Beispieldaten.</span><span>Getrennt von realen Experimenten</span></div>' : ""}${body()}<footer class="footer"><span>The 30 Seconds Challenge · ${esc(e.name)}</span><span>Erleben → Experimentieren → Auswerten → Reflektieren</span></footer></div></main>`;
}
function drawLogin() {
  const setupMode = status.setup;
  app.innerHTML = `<main class="card login">${brand()}<h1>${setupMode ? "Statistiklabor einrichten" : "Willkommen im Labor"}</h1><p class="note">${setupMode ? "Lege ein Administrationspasswort mit mindestens 12 Zeichen fest. Den einmaligen Einrichtungsschlüssel findest du im Server-Terminal." : "Melde dich an, um deine Veranstaltung zu steuern und Live-Daten auszuwerten."}</p><form id="login-form">${setupMode ? `<label for="setup-token">Einmaliger Einrichtungsschlüssel</label><input id="setup-token" name="token" value="${esc(params.get("setup") || "")}" required autocomplete="off">` : ""}<label for="password">Administrationspasswort</label><input id="password" name="password" type="password" autocomplete="${setupMode ? "new-password" : "current-password"}" minlength="${setupMode ? 12 : 1}" required><button class="primary">${setupMode ? "Sicher einrichten" : "Labor öffnen →"}</button></form><div class="divider"></div><button data-view="participate" class="small">Als Teilnehmer:in starten</button><p class="note" style="margin-top:15px">Teilnahme ohne E-Mail oder Passwort. Bitte verwende deinen veranstaltungsspezifischen Teilnahmelink.</p></main>`;
}
function drawParticipant() {
  const e = state.experiment,
    p = state.participant,
    s = e.settings,
    own = state.own.filter((x) => x.valid),
    d = describe(own),
    best = ranking(own)[0];
  app.innerHTML = `<main class="participant-shell"><header class="participant-nav">${brand()}<button class="small" data-view="${p ? "personal" : "overview"}">${p ? "Meine Versuche" : "Administration"}</button></header><div class="participant-body">${e.demo ? '<div class="banner warn">Demo-Veranstaltung · keine reale Teilnahme</div>' : ""}${!p ? `<div class="eyebrow">Ein Experiment. Zwei Gruppen. Dein Zeitgefühl.</div><h1>Wer hat das bessere Zeitgefühl?</h1><p class="note">30 Sekunden können sich ganz unterschiedlich anfühlen. Finde heraus, wie nah du an der Zielzeit liegst.</p><div class="card" style="margin-top:25px"><form id="join-form"><label for="nickname">Dein Nickname</label><input id="nickname" name="nickname" placeholder="Wähle ein Pseudonym" required maxlength="30" autocomplete="off"><label>Zu welcher Gruppe gehörst du?</label><div class="group-choice"><button type="button" data-group="student" class="${selectedGroup === "student" ? "selected" : ""}">Studierende</button><button type="button" data-group="staff" class="${selectedGroup === "staff" ? "selected" : ""}">Mitarbeitende</button></div><label style="font-weight:400;line-height:1.6"><input name="consent" required type="checkbox" style="width:auto"> Ich nehme freiwillig teil und verwende einen pseudonymen Nickname.</label><button class="primary" style="width:100%;margin-top:15px" ${!s.registration || e.demo ? "disabled" : ""}>${s.registration && !e.demo ? "Zur Challenge →" : "Anmeldung geschlossen"}</button></form></div><p class="privacy">Gespeichert werden Nickname, Gruppe, Teilnehmer-ID, Messwerte und Zeitpunkte. Die Administration sieht die Messdaten. Die Live-Bestenliste zeigt Nickname, Gruppe und Bestleistung. Eine gesondert freigegebene öffentliche Projektion kann pseudonyme Messdaten und Auswertungen zeigen. Keine E-Mail, kein Tracking. Deine lokale Zugangskennung ermöglicht dir den erneuten Zugriff auf diesem Gerät. Für Löschwünsche wende dich an die Veranstaltungsleitung.</p>` : view === "personal" ? `<div class="eyebrow">${esc(p.nickname)} · ${groups[p.group]}</div><h1>Dein Zeitgefühl in Zahlen</h1><div class="personal-kpis"><div>${d.n}<small>Versuche</small></div><div>${fmt(d.mean, 2)}<small>Mittelwert in s</small></div><div>${fmt(d.mae, 2)}<small>Mittlere abs. Abweichung</small></div></div><div class="card"><h2>Deine Entwicklung</h2>${personalChart(own)}<p class="note">Gestrichelte Referenzlinie: 30 Sekunden.</p><div class="tablewrap"><table><thead><tr><th>Versuch</th><th>Zeit</th><th>Abs. Abweichung</th></tr></thead><tbody>${own.map((x) => `<tr><td>${x.attempt} ${best?.id === x.id ? "◇" : ""}</td><td>${fmt(x.seconds)} s</td><td>${fmt(Math.abs(x.seconds - 30))} s</td></tr>`).join("")}</tbody></table></div><p class="note" style="margin-top:18px">Median: ${fmt(d.median)} s · Persönliche Bestleistung: ${best ? fmt(Math.abs(best.seconds - 30)) + " s Abweichung" : "–"}</p></div><button class="primary" data-view="participate">Weiter experimentieren</button> <button data-view="participant-ranking">Bestenliste</button>` : view === "participant-ranking" ? `<h1>Bestenliste</h1><div class="card">${rankingContent()}</div><button data-view="participate">Zur Challenge</button>` : `<div class="experiment"><span class="eyebrow">Hallo ${esc(p.nickname)} · ${groups[p.group]}</span>${result ? `<h1 style="margin-top:35px">Deine Schätzung</h1><div class="result">${fmt(result.seconds)} <small style="font-size:17px;letter-spacing:0">Sekunden</small></div><p class="note">${Math.abs(result.seconds - 30) < 0.0005 ? "Genau getroffen!" : `Du hast ${fmt(Math.abs(result.seconds - 30))} Sekunden zu ${result.seconds < 30 ? "früh" : "spät"} gestoppt.`}</p><div class="personal-kpis"><div>${fmt(Math.abs(result.seconds - 30))}<small>Absolute Abweichung in s</small></div><div>${best ? fmt(Math.abs(best.seconds - 30)) : "–"}<small>Bestleistung in s</small></div><div>${state.own.length}<small>Bisherige Versuche</small></div></div><button class="primary" data-action="retry">Noch einmal versuchen</button><p class="note" style="margin-top:18px">${outbox.some((x) => x.id === result.id) ? "Messung lokal gesichert · Übertragung ausstehend" : "Messung gespeichert"}</p>` : `<div class="target">30</div><div class="target-label">Sekunden</div><p class="note" style="max-width:350px;margin:0 auto">Starte die Zeitmessung und stoppe sie, sobald du glaubst, dass genau 30 Sekunden vergangen sind.</p>${!s.running ? '<div class="alert">Die Experimentierphase ist pausiert.</div>' : s.maxAttempts && state.own.length >= s.maxAttempts ? '<div class="alert">Du hast die maximale Versuchszahl erreicht.</div>' : '<button class="timerbutton" data-action="start">START</button>'}`}<div style="margin-top:20px"><button class="small" data-view="personal">Meine Versuche</button> <button class="small" data-view="participant-ranking">Bestenliste</button></div></div>`}<div class="privacy" style="text-align:center">${esc(e.name)}<br><span class="live ${connected ? "" : "off"}"><span class="connection-status">${connected ? "Live verbunden" : "Verbindung wird wiederhergestellt"}</span></span>${outbox.length ? `<br>${outbox.length} lokal gesicherte Messung(en) warten auf Übertragung.` : ""}</div></div></main>`;
}
function personalChart(rows) {
  const lo = Math.min(20, ...rows.map((x) => x.seconds)),
    hi = Math.max(40, ...rows.map((x) => x.seconds)),
    x = (i) => 55 + (i / Math.max(1, rows.length - 1)) * 660,
    y = (v) => 180 - ((v - lo) / (hi - lo)) * 145;
  return chartSVG(
    `<line x1="40" x2="740" y1="${y(30)}" y2="${y(30)}" stroke="#a6b8b6" stroke-dasharray="5"/><text x="745" y="${y(30) - 6}" text-anchor="end">30 s</text><polyline points="${rows.map((r, i) => `${x(i)},${y(r.seconds)}`).join(" ")}" fill="none" stroke="#128d88" stroke-width="2"/>${rows.map((r, i) => `<circle cx="${x(i)}" cy="${y(r.seconds)}" r="5" fill="#128d88"><title>Versuch ${r.attempt}: ${fmt(r.seconds)} s</title></circle><text x="${x(i)}" y="211" text-anchor="middle">${r.attempt}</text>`).join("")}`,
    230,
  );
}
const slides = [
    "welcome",
    "count",
    "measurements",
    "ranking",
    "descriptive",
    "dot",
    "box",
    "tolerance",
    "contingency",
    "simulation",
    "decision",
  ],
  slideNames = [
    "Willkommen",
    "Teilnehmende",
    "Live-Messungen",
    "Bestenliste",
    "Statistik",
    "Punktdiagramm",
    "Boxplots",
    "Toleranz",
    "Vierfeldertafel",
    "Simulation",
    "Testentscheidung",
  ];
function drawPresentation() {
  const e = state.experiment,
    s = e.settings;
  if (presFollow || !state.admin)
    presIndex = Math.max(0, slides.indexOf(s.presentation));
  const slide = slides[presIndex];
  let body = "";
  switch (slide) {
    case "welcome":
      body = `<div class="qrhero"><div><div class="eyebrow">Das interaktive Statistiklabor</div><h1>Wie gut ist dein Zeitgefühl?</h1><p class="subtitle">Studierende oder Mitarbeitende – wer trifft 30 Sekunden?</p><p class="note">${esc(location.origin + "/?e=" + id + "&view=participate")}</p></div><img src="${endpoint("qr")}" alt="QR-Code zur Teilnahme"></div>`;
      break;
    case "count":
      body = `<h1>Unser Experiment wächst.</h1>${metrics()}`;
      break;
    case "measurements":
      body = `<h1>Unsere Live-Messungen</h1>${toleranceControl()}${measurementTable(8)}`;
      break;
    case "ranking":
      body = `<h1>Die besten Schätzungen</h1>${rankingContent()}`;
      break;
    case "descriptive":
      body = `<h1>Die Gruppen in Zahlen</h1>${basis()}${statsTable()}`;
      break;
    case "dot":
      body = `<h1>Zwei Gruppen. Eine gemeinsame Zeitachse.</h1>${basis()}${chartCard()}`;
      break;
    case "box":
      body = `<h1>Die Verteilungen im Vergleich</h1>${basis()}${boxplot()}`;
      break;
    case "tolerance":
      body = `<h1>Was ist eine gute Schätzung?</h1>${basis()}${dotplot()}${toleranceCard()}`;
      break;
    case "contingency":
      body = `<h1>Von den Messwerten zur Vierfeldertafel</h1>${basis()}${toleranceControl()}${frequencyControl()}${crossTable()}${shares()}`;
      break;
    case "simulation":
      body = s.simulation
        ? simulationContent()
        : '<div class="empty">Das Simulationslabor wurde noch nicht freigegeben.</div>';
      break;
    case "decision": {
      const t = s.lockedTolerance ?? s.tolerance,
        z = table(activeRows(), t),
        p = fisher(z, s.side);
      body = `<h1>Was können wir schließen?</h1>${s.simulation && s.reveal >= 9 ? `<div class="result">p = ${fmt(p, 4)}</div><h2>${p == null ? "Noch keine Testentscheidung möglich" : p <= s.alpha ? "H₀ auf dem gewählten Niveau verwerfen" : "H₀ auf dem gewählten Niveau nicht verwerfen"}</h2><p class="note">Fisher-Test · α = ${pct(s.alpha)} · ${modes[s.mode]} · Testtoleranz ± ${fmt(t, 1)} s.</p><p class="note">Ein nicht signifikantes Ergebnis beweist H₀ nicht. Nicht randomisierte Gruppenzugehörigkeit und Gelegenheitsstichprobe begrenzen kausale Aussagen und Verallgemeinerungen.</p>` : '<div class="empty">Die Testentscheidung wurde noch nicht freigegeben.</div>'}`;
    }
  }
  app.innerHTML = `<main class="presentation ${state.admin ? "" : "read-only"}"><div class="preshead"><div class="brand" style="color:var(--navy);margin:0">${brand().replace(/^<div class="brand">|<\/div>$/g, "")}</div><div class="actions"><span class="badge ${e.demo ? "demo" : ""}">${e.demo ? "DEMO" : "LIVE"} · ${esc(e.name)}</span><button class="small danger" data-action="restart">↻ Neu starten</button><button class="small" data-action="fullscreen">⛶ Vollbild</button><button class="small" data-view="overview">Labor ↗</button></div></div>${body}<div class="divider"></div><div class="prescontrols"><button class="small" data-action="pres-prev">← Zurück</button><span>${presIndex + 1} / ${slides.length} · ${slideNames[presIndex]} · Pfeiltasten zum Wechseln</span><button class="small" data-action="pres-next">Weiter →</button></div><div class="present-list" style="margin-top:18px">${slideNames.map((n, i) => `<button class="${presIndex === i ? "primary" : ""}" data-pres="${i}">${n}</button>`).join("")}</div></main>`;
}
function startTimer() {
  if (timerStart) return;
  interrupted = false;
  timerStart = performance.now();
  app.innerHTML = `<main class="participant-shell"><div class="participant-body experiment" style="padding-top:10vh"><div class="target">30</div><div class="target-label">Sekunden</div><p class="note">Stoppe, wenn du glaubst, dass 30 Sekunden vergangen sind.</p><button class="timerbutton stop" data-action="stop">STOPP</button></div></main>`;
}
async function stopTimer() {
  if (timerStart === null || performance.now() - timerStart < 350) return;
  const seconds = (performance.now() - timerStart) / 1000;
  timerStart = null;
  if (interrupted) {
    toast("Die Messung wurde unterbrochen und nicht gespeichert.");
    draw();
    return;
  }
  const item = {
    id: crypto.randomUUID(),
    seconds,
    experiment: id,
    round: state.experiment.settings.round,
    interrupted: false,
  };
  result = item;
  outbox.push(item);
  localStorage.setItem("challenge-outbox", JSON.stringify(outbox));
  draw();
  await flush();
}
function abortTimer() {
  if (timerStart !== null) {
    interrupted = true;
    timerStart = null;
    result = null;
    draw();
    toast(
      "Messung abgebrochen: Browser wurde verlassen oder in den Hintergrund verschoben.",
    );
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) abortTimer();
});
window.addEventListener("pagehide", abortTimer);
window.addEventListener("blur", abortTimer);
window.addEventListener("online", () => flush());
async function exportData(format, kind) {
  const r = await fetch(
    endpoint("export") + "?format=" + format + (kind ? "&kind=" + kind : ""),
  );
  if (!r.ok) throw Error("Export fehlgeschlagen.");
  download(
    await r.blob(),
    `challenge-${id}${kind ? "-" + kind : ""}.${format}`,
  );
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function chartExport(button, type) {
  const svg = button.closest(".card")?.querySelector("svg") || $("svg.chart");
  if (!svg) throw Error("Kein Diagramm gefunden.");
  const str = new XMLSerializer().serializeToString(svg),
    blob = new Blob([str], { type: "image/svg+xml;charset=utf-8" });
  if (type === "svg") return download(blob, "challenge-diagramm.svg");
  const url = URL.createObjectURL(blob),
    img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 1560;
  canvas.height = Number(svg.viewBox.baseVal.height) * 2;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  canvas.toBlob((b) => download(b, "challenge-diagramm.png"));
}
function navigate(v) {
  view = v;
  if (v === "presentation" && !state.admin) {
    load().catch((err) => toast(err.message));
  }
  history.replaceState({}, "", `/?e=${id}&view=${v}`);
  draw();
  window.scrollTo(0, 0);
}
async function changeExperiment(next) {
  id = next;
  result = null;
  await load(false);
  connect();
  navigate("overview");
}
async function showInvite() {
  const d = document.createElement("dialog");
  d.innerHTML = `<h2>Gemeinsam experimentieren</h2><p class="note">QR-Code scannen und mit dem Smartphone teilnehmen.</p><img src="${endpoint("qr")}" alt="Teilnahme-QR-Code"><input readonly value="${esc(location.origin + "/?e=" + id + "&view=participate")}" aria-label="Teilnahmelink"><div class="actions" style="margin-top:20px"><button class="primary" data-action="copy">Link kopieren</button><button data-action="close-dialog">Schließen</button></div>`;
  document.body.append(d);
  d.showModal();
  d.addEventListener("close", () => d.remove());
}
async function action(e) {
  const el = e.target.closest("button");
  if (!el) return;
  if (el.dataset.view) {
    if (el.dataset.slide) presIndex = slides.indexOf(el.dataset.slide);
    navigate(el.dataset.view);
    return;
  }
  if (el.dataset.group) {
    selectedGroup = el.dataset.group;
    const nickname = $("#nickname")?.value;
    drawParticipant();
    if ($("#nickname")) $("#nickname").value = nickname;
    return;
  }
  if (el.dataset.rank) {
    rankFilter = el.dataset.rank;
    draw();
    return;
  }
  if (el.dataset.chart) {
    chartType = el.dataset.chart;
    draw();
    return;
  }
  if (el.dataset.sort) {
    sortDir = sort === el.dataset.sort ? -sortDir : 1;
    sort = el.dataset.sort;
    draw();
    return;
  }
  if (el.dataset.pres) {
    presIndex = +el.dataset.pres;
    await settings({ presentation: slides[presIndex] });
    return;
  }
  if (el.dataset.sim) {
    el.disabled = true;
    await api(endpoint("simulate"), { n: Number(el.dataset.sim) });
    await load(false);
    draw();
    return;
  }
  if (el.dataset.export) return exportData(el.dataset.export, el.dataset.kind);
  if (el.dataset.valid)
    return api(endpoint("valid"), {
      id: el.dataset.valid,
      valid: el.dataset.value === "true",
    }).then(() => load());
  switch (el.dataset.action) {
    case "start":
      startTimer();
      break;
    case "stop":
      await stopTimer();
      break;
    case "retry":
      result = null;
      draw();
      break;
    case "invite":
      await showInvite();
      break;
    case "close-dialog":
      el.closest("dialog").close();
      break;
    case "copy":
      await navigator.clipboard.writeText(
        location.origin + "/?e=" + id + "&view=participate",
      );
      toast("Teilnahmelink kopiert.");
      break;
    case "lock":
      await settings({ lockTolerance: true });
      break;
    case "freeze":
      await settings({ freeze: true });
      toast("Auswertungsstand gespeichert.");
      break;
    case "reset-sim":
      await api(endpoint("simulate"), { n: 0 });
      await load(false);
      draw();
      break;
    case "logout":
      await api("/api/logout", {});
      status = await api("/api/status");
      await load(false);
      draw();
      break;
    case "fullscreen":
      if (!document.fullscreenElement)
        await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
      break;
    case "pres-next":
      presIndex = (presIndex + 1) % slides.length;
      await settings({ presentation: slides[presIndex] });
      break;
    case "pres-prev":
      presIndex = (presIndex + slides.length - 1) % slides.length;
      await settings({ presentation: slides[presIndex] });
      break;
    case "svg":
    case "png":
      await chartExport(el, el.dataset.action);
      break;
    case "restart": {
      const d = document.createElement("dialog");
      d.innerHTML = `<h2>Experiment neu starten?</h2><p class="note">Alle Messungen, die Bestenliste, Simulationen und der eingefrorene Auswertungsstand dieser Veranstaltung werden unwiderruflich gelöscht. Angemeldete Personen, Einstellungen und Teilnahmelink bleiben erhalten. Auch offline zwischengespeicherte alte Messungen können danach nicht erneut eingereicht werden.</p><p class="note">Gib zur Bestätigung <b>NEUSTART ${id}</b> ein.</p><form id="restart-form"><input name="confirm" required autocomplete="off" aria-label="Neustart bestätigen"><div class="actions" style="margin-top:20px"><button class="danger">Messungen löschen und neu starten</button><button type="button" data-action="close-dialog">Abbrechen</button></div></form>`;
      document.body.append(d);
      d.showModal();
      d.addEventListener("close", () => d.remove());
      break;
    }
    case "reset-data": {
      const d = document.createElement("dialog");
      d.innerHTML = `<h2>Veranstaltungsdaten löschen?</h2><p class="note">Diese Aktion ist endgültig. Gib zur Bestätigung <b>LÖSCHEN ${id}</b> ein.</p><form id="reset-form"><input name="confirm" required autocomplete="off" aria-label="Löschbestätigung"><div class="actions" style="margin-top:20px"><button class="danger">Endgültig löschen</button><button type="button" data-action="close-dialog">Abbrechen</button></div></form>`;
      document.body.append(d);
      d.showModal();
      d.addEventListener("close", () => d.remove());
      break;
    }
  }
}
document.addEventListener("click", (e) =>
  action(e).catch((err) => toast(err.message)),
);
document.addEventListener("change", async (e) => {
  try {
    const el = e.target;
    if (el.dataset.setting) {
      let v =
        el.type === "checkbox"
          ? el.checked
          : el.type === "number" || el.type === "range"
            ? Number(el.value)
            : el.value;
      await settings({ [el.dataset.setting]: v });
    }
    if (el.hasAttribute("data-tolerance"))
      await settings({ tolerance: Number(el.value) });
    if (el.id === "metric-type") {
      metricType = el.value;
      draw();
    }
    if (el.id === "measure-group") {
      measureGroup = el.value;
      draw();
    }
    if (el.id === "measure-attempt") {
      measureAttempt = el.value;
      draw();
    }
    if (el.id === "experiment-picker") await changeExperiment(el.value);
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.hasAttribute("data-tolerance"))
    document.querySelectorAll("[data-tolerance]").forEach((el) => {
      el.value = e.target.value;
    });
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target,
    data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === "login-form") {
      if (status.setup) {
        await api("/api/setup", data);
        toast("Administration eingerichtet.");
      }
      await api("/api/login", { password: data.password });
      status = await api("/api/status");
      await load(false);
      draw();
    }
    if (form.id === "join-form") {
      const r = await api(endpoint("join"), {
        nickname: data.nickname,
        group: selectedGroup,
      });
      if (r.token) {
        identity[id] = r;
        localStorage.setItem("challenge-identities", JSON.stringify(identity));
      }
      await load(false);
      draw();
    }
    if (form.id === "new-experiment") {
      const r = await api("/api/experiments", {
        name: data.name,
        demo: !!data.demo,
      });
      status = await api("/api/status");
      await changeExperiment(r.id);
      view = "settings";
      draw();
    }
    if (form.id === "demo-form") {
      await api(endpoint("demo"), {
        n: Number(data.n),
        share: Number(data.share) / 100,
      });
      await load(false);
      draw();
      toast("Getrennter Demo-Datensatz erzeugt.");
    }
    if (form.id === "restart-form") {
      await api(endpoint("restart"), data);
      form.closest("dialog").close();
      await load(false);
      if (view === "presentation") presIndex = 0;
      draw();
      toast(
        "Experiment neu gestartet. Alle Messungen sind gelöscht; die Teilnehmenden können wieder beginnen.",
      );
    }
    if (form.id === "reset-form") {
      await api(endpoint("reset"), data);
      form.closest("dialog").close();
      await load();
      toast("Daten dieser Veranstaltung gelöscht.");
    }
  } catch (err) {
    toast(err.message);
  }
});
window.addEventListener("keydown", (e) => {
  if (
    view !== "presentation" ||
    ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)
  )
    return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    presIndex =
      (presIndex + (e.key === "ArrowRight" ? 1 : slides.length - 1)) %
      slides.length;
    settings({ presentation: slides[presIndex] }).catch((err) =>
      toast(err.message),
    );
  }
  if (e.key === "Escape" && !document.fullscreenElement) navigate("overview");
});
async function init() {
  status = await api("/api/status");
  id ||= status.first;
  if (!id) throw Error("Keine Veranstaltung vorhanden.");
  await load(false);
  connect();
  draw();
  if (identity[id]) flush().catch(() => {});
  setInterval(() => {
    if (!timerStart) load().catch(() => {});
  }, 20000);
}
init().catch((err) => {
  app.innerHTML = `<main class="card login"><h1>Labor nicht erreichbar</h1><p class="note">${esc(err.message)}</p><a href="/">Zur Startseite</a></main>`;
});
