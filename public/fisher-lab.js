import { hypergeometric, fisherTableAt, probabilityEvent } from "./stats.js";

export const fisherSteps = [
  "Unsere Vierfeldertafel",
  "Unabhängigkeit unter H₀",
  "Mögliche Tafeln",
  "Einzelwahrscheinlichkeiten",
  "Wahrscheinlichkeiten addieren",
  "Der exakte p-Wert",
  "Entscheiden und einordnen",
];
const labels = { student: "Studierende", staff: "Mitarbeitende" };
const number = (x, digits = 0) =>
  x.toLocaleString("de-DE", { maximumFractionDigits: digits });
const bounded = (x, min, max, fallback) =>
  Number.isInteger(x) ? Math.max(min, Math.min(max, x)) : fallback;
export function probabilityText(
  probability,
  logProbability = probability > 0 ? Math.log(probability) : -Infinity,
) {
  if (logProbability === -Infinity) return "0";
  if (probability >= 1e-6)
    return probability.toLocaleString("de-DE", {
      minimumFractionDigits: 6,
      maximumFractionDigits: 8,
    });
  const exponent = Math.floor(logProbability / Math.LN10);
  const mantissa = Math.exp(logProbability - exponent * Math.LN10);
  return `${number(mantissa, 4)} × 10^${exponent}`;
}
function binomial(n, k) {
  return `<span class="binomial" aria-label="${n} über ${k}"><span>${n}</span><span>${k}</span></span>`;
}
function formula(model, x) {
  return `<div class="fisher-formula" aria-label="Hypergeometrische Wahrscheinlichkeit"><span>P(X = ${x}) =</span><span class="fraction"><span>${binomial(model.K, x)} · ${binomial(model.N - model.K, model.n - x)}</span><span>${binomial(model.N, model.n)}</span></span></div>`;
}
function teachingTable(t, { selected = false, model = null, x = null } = {}) {
  return `<div class="tablewrap"><table class="cross fisher-table" aria-label="${selected ? "Ausgewählte mögliche" : "Beobachtete"} Vierfeldertafel"><thead><tr><th>Gruppe</th><th>Gute Schätzung</th><th>Schlechte Schätzung</th><th class="margin-cell">Gesamt</th></tr></thead><tbody>${[
    ["Studierende", t.a, t.c, "student"],
    ["Mitarbeitende", t.b, t.d, "staff"],
  ]
    .map(
      ([group, a, c, key]) =>
        `<tr class="${selected && model.group === key ? "focus-group" : ""}"><td>${group}</td><td class="${selected && model.group === key ? "focus-cell" : ""}"><strong>${a}</strong>${selected && model.group === key ? "<small>X = " + x + "</small>" : ""}</td><td><strong>${c}</strong></td><td class="margin-cell"><strong>${a + c}</strong></td></tr>`,
    )
    .join(
      "",
    )}<tr class="total"><td>Gesamt</td><td class="margin-cell"><strong>${t.a + t.b}</strong></td><td class="margin-cell"><strong>${t.c + t.d}</strong></td><td class="margin-cell"><strong>${t.a + t.b + t.c + t.d}</strong></td></tr></tbody></table></div>`;
}
function distributionChart(
  model,
  { x, event, showObserved, showThreshold, interactive },
) {
  const w = Math.max(760, model.points.length * 18 + 120),
    h = 315;
  const left = 70,
    right = w - 30,
    top = 38,
    bottom = 255,
    dx = (right - left) / model.points.length;
  const maxP = Math.min(
    1,
    Math.max(...model.points.map((p) => p.probability)) * 1.13,
  );
  const y = (p) => bottom - (p / maxP) * (bottom - top),
    cx = (value) => left + (value - model.min + 0.5) * dx;
  const included = new Set(event.xs);
  const observed = model.points.find((p) => p.x === model.observed);
  let inner = "";
  for (let i = 0; i <= 4; i++) {
    const p = (maxP * i) / 4;
    inner += `<line x1="${left}" x2="${right}" y1="${y(p)}" y2="${y(p)}" stroke="#e5ecee"/><text x="${left - 10}" y="${y(p) + 4}" text-anchor="end">${number(p * 100, 2)} %</text>`;
  }
  for (const point of model.points) {
    const height = bottom - y(point.probability),
      selected = point.x === x;
    inner += `<rect class="probability-bar ${included.has(point.x) ? "event-bar" : ""} ${selected ? "selected-bar" : ""}" ${interactive ? `data-fisher-x="${point.x}" role="button" tabindex="0"` : ""} aria-label="X = ${point.x}, Wahrscheinlichkeit ${probabilityText(point.probability, point.logProbability)}" x="${cx(point.x) - dx * 0.4}" y="${y(point.probability)}" width="${dx * 0.8}" height="${height}" fill="${included.has(point.x) ? "#d6a150" : "#b4d4cf"}" stroke="${selected ? "#183b50" : "transparent"}" stroke-width="${selected ? 2.5 : 0}"><title>X = ${point.x}: P = ${probabilityText(point.probability, point.logProbability)}</title></rect>`;
  }
  const stride = Math.max(1, Math.ceil(model.points.length / 16));
  for (const point of model.points)
    if ((point.x - model.min) % stride === 0 || point.x === model.max)
      inner += `<text x="${cx(point.x)}" y="277" text-anchor="middle">${point.x}</text>`;
  if (showObserved)
    inner += `<line x1="${cx(model.observed)}" x2="${cx(model.observed)}" y1="${top - 15}" y2="${bottom}" stroke="#183b50" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${cx(model.observed)}" y="15" text-anchor="middle">Beobachtet: ${model.observed}</text>`;
  if (showThreshold)
    inner += `<line x1="${left}" x2="${right}" y1="${y(observed.probability)}" y2="${y(observed.probability)}" stroke="#b17b30" stroke-dasharray="5 4"/><text x="${right}" y="${Math.max(30, y(observed.probability) - 7)}" text-anchor="end">P(beobachtete Tafel)</text>`;
  inner += `<text x="${left}" y="23">P(X = x)</text><text x="${(left + right) / 2}" y="307" text-anchor="middle">X: Anzahl guter Schätzungen bei ${labels[model.group]}</text>`;
  return `<div class="fisher-chart"><svg class="chart" style="min-width:${Math.max(650, model.points.length * 14 + 120)}px" viewBox="0 0 ${w} ${h}" role="${interactive ? "group" : "img"}" font-family="system-ui, sans-serif" font-size="11" fill="#788a95" aria-label="Hypergeometrische Wahrscheinlichkeitsverteilung"><rect width="${w}" height="${h}" fill="white"/>${inner}</svg></div><div class="legend"><span><i class="dot" style="background:#b4d4cf"></i>Einzelwahrscheinlichkeit</span><span><i class="dot staff"></i>Zum ausgewählten Ereignis gehörend</span><span>Umrandet: ausgewählte Tafel${showObserved ? " · Gestrichelt: beobachtete Tafel" : ""}</span></div><p class="note">Jeder Balken steht für eine mögliche ganze Zahl x. Seine Höhe ist P(X = x); die Summe aller Balkenwahrscheinlichkeiten ist 1. ${interactive ? "Klicke einen Balken an oder wähle x mit dem Regler." : "Die Auswahl wird von der Administration gesteuert."}</p>`;
}
function eventLabel(kind, { x, lower, upper, model, side }) {
  if (kind === "single") return `P(X = ${x})`;
  if (kind === "left") return `P(X ≤ ${x})`;
  if (kind === "right") return `P(X ≥ ${x})`;
  if (kind === "interval") return `P(${lower} ≤ X ≤ ${upper})`;
  if (side === "two")
    return "P(Tafeln höchstens so wahrscheinlich wie die beobachtete)";
  const left =
    side === "left" ? model.group === "student" : model.group === "staff";
  return `P(X ${left ? "≤" : "≥"} ${model.observed})`;
}
function hypotheses(side) {
  return `<div class="hypotheses"><div><span class="eyebrow">Nullhypothese H₀</span><h3>Gruppenzugehörigkeit und Schätzqualität sind statistisch unabhängig.</h3><p>Die Wahrscheinlichkeit einer guten Schätzung ist in beiden Gruppen gleich: p<sub>Studierende</sub> = p<sub>Mitarbeitende</sub>.</p></div><div><span class="eyebrow">Alternativhypothese H₁</span><h3>${side === "two" ? "Gruppenzugehörigkeit und Schätzqualität hängen statistisch zusammen." : side === "left" ? "Studierende haben eine geringere Wahrscheinlichkeit für eine gute Schätzung." : "Studierende haben eine höhere Wahrscheinlichkeit für eine gute Schätzung."}</h3><p>p<sub>Studierende</sub> ${side === "two" ? "≠" : side === "left" ? "&lt;" : "&gt;"} p<sub>Mitarbeitende</sub></p></div></div>`;
}
export function fisherDecision(counts, settings) {
  const model = hypergeometric(counts, settings.fisherGroup || "student");
  if (!model.testable)
    return '<div class="empty">Für eine Testentscheidung benötigt jede Gruppe mindestens eine gültige Messung.</div>';
  const result = probabilityEvent(model, {
    kind: "fisher",
    side: settings.side,
  });
  const reject = result.probability <= settings.alpha;
  const direction =
    settings.side === "left"
      ? "p Studierende &lt; p Mitarbeitende"
      : settings.side === "right"
        ? "p Studierende &gt; p Mitarbeitende"
        : "p Studierende ≠ p Mitarbeitende";
  return `<div class="fisher-decision ${reject ? "reject" : ""}"><span class="eyebrow">Exakter Fisher-Test · α = ${number(settings.alpha * 100, 2)} %</span><p class="note">H₀: statistische Unabhängigkeit · H₁: ${direction}</p><div class="fisher-result">p = ${probabilityText(result.probability, result.logProbability)}</div><h2>${reject ? "H₀ verwerfen" : "H₀ nicht verwerfen"}</h2><p>${reject ? "p ≤ α. Das Ergebnis spricht unter den Testannahmen für die gewählte Alternativhypothese H₁. Sie wird damit statistisch unterstützt, nicht bewiesen." : "p > α. Die Daten reichen auf dem gewählten Niveau nicht aus, H₀ zu verwerfen. Das ist kein Beweis für statistische Unabhängigkeit."}</p></div>`;
}
export function renderFisherLab({
  counts,
  settings,
  admin = false,
  chartTools = "",
}) {
  const group = settings.fisherGroup || "student",
    model = hypergeometric(counts, group);
  const step = bounded(settings.fisherStep, 1, 7, 1),
    side = settings.side || "two";
  const x = bounded(settings.fisherX, model.min, model.max, model.observed);
  const lower = bounded(settings.fisherLower, model.min, model.max, model.min);
  const upper = Math.max(
    lower,
    bounded(settings.fisherUpper, model.min, model.max, model.max),
  );
  const kind =
    step < 5
      ? "single"
      : step < 6 && settings.fisherEvent === "fisher"
        ? "single"
        : settings.fisherEvent || "single";
  const point = model.points.find((p) => p.x === x),
    observed = model.points.find((p) => p.x === model.observed);
  const event = probabilityEvent(model, { kind, x, lower, upper, side });
  const exact = probabilityEvent(model, { kind: "fisher", side });
  const tolerance = settings.lockedTolerance ?? settings.tolerance;
  const parameterCards = `<div class="fisher-parameters"><div><b>${model.N}</b><span>N · ausgewertete Schätzungen</span></div><div><b>${model.K}</b><span>K · gute Schätzungen</span></div><div><b>${model.n}</b><span>n · ${labels[group]}</span></div><div><b>${model.min} … ${model.max}</b><span>Mögliche Werte von X</span></div></div>`;
  const controls = admin
    ? `<div class="fisher-x-controls"><button class="small" data-fisher-x="${x - 1}" ${x === model.min ? "disabled" : ""} aria-label="Eine gute Schätzung weniger">−</button><input type="range" data-setting="fisherX" min="${model.min}" max="${model.max}" step="1" value="${x}" aria-label="Gute Schätzungen in der ausgewählten Gruppe"><input type="number" data-setting="fisherX" min="${model.min}" max="${model.max}" step="1" value="${x}" aria-label="Wert von X"><button class="small" data-fisher-x="${x + 1}" ${x === model.max ? "disabled" : ""} aria-label="Eine gute Schätzung mehr">+</button><button class="small" data-fisher-x="${model.observed}">Beobachtete Tafel</button></div>`
    : "";
  const groupSelector = admin
    ? `<label>Welche Gruppe betrachten wir als Stichprobe?</label><select data-setting="fisherGroup" aria-label="Gruppe für die hypergeometrische Verteilung"><option value="student" ${group === "student" ? "selected" : ""}>Studierende</option><option value="staff" ${group === "staff" ? "selected" : ""}>Mitarbeitende</option></select>`
    : `<p class="note">Betrachtete Gruppe: ${labels[group]}</p>`;
  let html = `<section class="fisher-lab" data-step="${step}"><div class="card fisher-path"><div class="cardhead"><div><h2>Vom Experiment zum exakten Test</h2><p>Schritt ${step} von 7 · ${fisherSteps[step - 1]}</p></div><span class="badge">Testtoleranz ± ${number(tolerance, 1)} s${settings.lockedTolerance != null ? " · fixiert" : " · explorativ"}</span></div><div class="fisher-steps">${fisherSteps.map((label, i) => (admin ? `<button data-fisher-step="${i + 1}" class="${step === i + 1 ? "selected" : ""}" aria-current="${step === i + 1 ? "step" : "false"}"><span>${i + 1}</span>${label}</button>` : `<span class="fisher-step-label ${step === i + 1 ? "selected" : ""}">${i + 1}. ${label}</span>`)).join("")}</div>${admin ? `<div class="fisher-path-controls"><button class="small" data-fisher-step="${step - 1}" ${step === 1 ? "disabled" : ""}>← Zurück</button><button class="small primary" data-fisher-step="${step + 1}" ${step === 7 ? "disabled" : ""}>Nächster Schritt →</button></div>` : ""}</div>`;
  if (
    settings.lockedTolerance != null &&
    settings.tolerance !== settings.lockedTolerance
  )
    html += `<div class="banner warn">Der Test verwendet den fixierten Toleranzwert ± ${number(tolerance, 1)} s. Die explorative Vierfeldertafel verwendet derzeit ± ${number(settings.tolerance, 1)} s. Die unten gezeigte Testtafel macht diesen Unterschied sichtbar.</div>`;
  html += `<details class="card fisher-observed" ${step <= 2 ? "open" : ""}><summary><span class="eyebrow">1 · Unsere Daten</span> · Beobachtete Tafel mit ${model.N} Messungen</summary><div class="cardhead"><div><span class="eyebrow">1 · Unsere Daten</span><h2>Die tatsächlich beobachtete Vierfeldertafel</h2><p>Hier stehen die Gruppen als Zeilen und die Schätzqualitäten als Spalten. Die Häufigkeiten entsprechen der gewählten Datengrundlage.</p></div><span class="badge">${model.N} Messungen</span></div>${teachingTable(counts)}<p class="note">Die Randzellen bleiben für Fisher fest. Nur die vier inneren Häufigkeiten dürfen sich passend zueinander verändern.</p></details>`;
  if (step === 2)
    html += `<div class="card"><span class="eyebrow">2 · Was prüfen wir?</span>${hypotheses(side)}${admin ? `<label>Richtung der Alternativhypothese</label><select data-setting="side" aria-label="Alternativhypothese"><option value="two" ${side === "two" ? "selected" : ""}>Zweiseitig: p Studierende ≠ p Mitarbeitende</option><option value="left" ${side === "left" ? "selected" : ""}>Linksseitig: p Studierende &lt; p Mitarbeitende</option><option value="right" ${side === "right" ? "selected" : ""}>Rechtsseitig: p Studierende &gt; p Mitarbeitende</option></select>` : ""}<p class="note">Unter H₀ fragen wir: Wie wahrscheinlich sind diese und andere mögliche Aufteilungen, wenn wir auf die beobachteten Randsummen bedingen? Die möglichen Tafeln sind im Allgemeinen nicht gleich wahrscheinlich.</p></div>`;
  if (step >= 3 && !model.testable)
    html +=
      '<div class="card empty"><strong>Es fehlen noch Messungen einer Gruppe.</strong>Für den Gruppenvergleich benötigen Studierende und Mitarbeitende jeweils mindestens eine gültige Messung. Es werden keine Beispieldaten in die Auswertung eingesetzt.</div>';
  if (step >= 3 && model.testable) {
    if (step <= 4)
      html += `<div class="card fisher-possible"><div class="cardhead"><div><span class="eyebrow">3 · Eine freie Häufigkeit</span><h2>Welche anderen Tafeln wären möglich?</h2><p>Zeilen- und Spaltensummen bleiben erhalten. Ändere X und beobachte die drei anderen Zellen.</p></div><span class="badge">Hypothetische Tafel · keine Änderung der Messdaten</span></div>${groupSelector}<p class="fisher-definition"><b>X</b> = Anzahl guter Schätzungen unter den <b>${model.n} ${labels[group]}</b>.</p>${parameterCards}${controls}${teachingTable(fisherTableAt(model, x), { selected: true, model, x })}<p class="note">Gewählt: X = ${x}. Tatsächlich beobachtet: X = ${model.observed}. Für jede mögliche Tafel ist damit die gesamte innere Verteilung festgelegt.</p>${!model.informative ? '<div class="alert">Alle Schätzungen haben dieselbe Qualität. Die festen Randsummen erlauben nur eine Tafel; die bedingte Verteilung liefert keine Unterscheidung zwischen den Gruppen.</div>' : ""}</div>`;
    if (step >= 4 && step <= 6)
      html += `<div class="card fisher-law-card"><div class="cardhead"><div><span class="eyebrow">4 · Wahrscheinlichkeit einer Tafel</span><h2>Die hypergeometrische Verteilung</h2><p>Aus N = ${model.N} ausgewerteten Schätzungen mit K = ${model.K} guten werden n = ${model.n} ohne Zurücklegen der betrachteten Gruppe zugeordnet.</p></div>${chartTools}</div>${step >= 5 ? groupSelector + controls + `<details class="fisher-current-table"><summary>Ausgewählte Tafel: X = ${x} · beobachtet: ${model.observed}</summary>${teachingTable(fisherTableAt(model, x), { selected: true, model, x })}</details>` : ""}<div class="fisher-law">P(X = x) = <span class="fraction"><span>${binomial("K", "x")} · ${binomial("N − K", "n − x")}</span><span>${binomial("N", "n")}</span></span></div>${formula(model, x)}<div class="fisher-result" data-probability="single">P(X = ${x}) = ${probabilityText(point.probability, point.logProbability)}</div><p class="note">Zähler: Möglichkeiten, ${x} gute und ${model.n - x} schlechte Schätzungen auszuwählen. Nenner: alle Möglichkeiten, ${model.n} von ${model.N} Schätzungen auszuwählen. Diese Zuordnungen sind unter dem bedingten H₀-Modell gleich wahrscheinlich.</p>${distributionChart(model, { x, event, showObserved: true, showThreshold: step >= 6 && side === "two", interactive: admin })}</div>`;
    if (step >= 5 && step <= 6) {
      const choices = [
        ["single", "Nur diese Tafel: P(X = x)"],
        ["left", "Links kumuliert: P(X ≤ x)"],
        ["right", "Rechts kumuliert: P(X ≥ x)"],
        ["interval", "Intervall: P(L ≤ X ≤ U)"],
        ...(step >= 6 ? [["fisher", "Alle Tafeln des Fisher-p-Werts"]] : []),
      ];
      const terms = event.xs.map((value) => model.points[value - model.min]);
      html += `<div class="card fisher-event-card"><span class="eyebrow">5 · Ereignisse zusammensetzen</span><h2>Wahrscheinlichkeiten addieren</h2>${admin ? `<label>Welches Ereignis soll geometrisch hervorgehoben und aufsummiert werden?</label><select data-setting="fisherEvent" aria-label="Ereignis für die kumulierte Wahrscheinlichkeit">${choices.map(([key, label]) => `<option value="${key}" ${kind === key ? "selected" : ""}>${label}</option>`).join("")}</select>` : ""}${kind === "interval" && admin ? `<div class="fisher-interval"><label>Untere Grenze L<input type="number" data-setting="fisherLower" min="${model.min}" max="${upper}" step="1" value="${lower}" aria-label="Untere Ereignisgrenze"></label><label>Obere Grenze U<input type="number" data-setting="fisherUpper" min="${lower}" max="${model.max}" step="1" value="${upper}" aria-label="Obere Ereignisgrenze"></label></div>` : ""}<div class="fisher-event-expression">${eventLabel(kind, { x, lower, upper, model, side })}</div><div class="fisher-result" data-probability="event">${probabilityText(event.probability, event.logProbability)}</div><p class="note">Gold markiert sind genau die ${event.xs.length} zu diesem Ereignis gehörenden Tafeln. Alle angegebenen Grenzen sind eingeschlossen. ${kind !== "fisher" ? "Diese frei gewählte Summe ist nicht automatisch der Fisher-p-Wert." : "Hier wird die Menge des Fisher-p-Werts für die beobachtete Tafel verwendet."}</p><div class="fisher-sum">${
        terms.length
          ? terms
              .slice(0, 10)
              .map((p) => `P(X = ${p.x})`)
              .join(" + ")
          : "0"
      }${terms.length > 10 ? " + …" : ""} = ${probabilityText(event.probability, event.logProbability)}<div class="fisher-numeric-sum">${
        terms.length
          ? terms
              .slice(0, 10)
              .map((p) => probabilityText(p.probability, p.logProbability))
              .join(" + ")
          : "0"
      }${terms.length > 10 ? " + …" : ""} = ${probabilityText(event.probability, event.logProbability)}</div></div><details class="fisher-probability-list"><summary>Alle ${model.points.length} Tafeln mit Einzelwahrscheinlichkeiten anzeigen</summary><div class="tablewrap"><table><thead><tr><th>X</th><th>Stud.: gut / schlecht</th><th>Mit.: gut / schlecht</th><th>P(X = x)</th><th>Zum gewählten Ereignis</th></tr></thead><tbody>${model.points
        .map((p) => {
          const z = fisherTableAt(model, p.x);
          return `<tr class="${event.xs.includes(p.x) ? "included-event" : ""} ${p.x === x ? "selected-probability" : ""}"><td>${admin ? `<button class="small" data-fisher-x="${p.x}">${p.x}</button>` : p.x}${p.x === model.observed ? " · beobachtet" : ""}</td><td>${z.a} / ${z.c}</td><td>${z.b} / ${z.d}</td><td>${probabilityText(p.probability, p.logProbability)}</td><td>${event.xs.includes(p.x) ? "Ja" : "Nein"}</td></tr>`;
        })
        .join("")}</tbody></table></div></details></div>`;
    }
    if (step === 6)
      html += `<div class="card fisher-p-card"><span class="eyebrow">6 · Der exakte Test</span><h2>Welche Tafeln zählen zum p-Wert?</h2><p>${side === "two" ? "Beim zweiseitigen Fisher-Test addieren wir die Wahrscheinlichkeiten aller möglichen Tafeln, die unter H₀ höchstens so wahrscheinlich sind wie die beobachtete Tafel. Gleich wahrscheinliche Tafeln zählen mit." : "Beim gerichteten Test addieren wir die beobachtete Tafel und alle Tafeln, die in Richtung der gewählten Alternativhypothese mindestens ebenso extrem sind."}</p><p class="note">P(beobachtete Tafel) = ${probabilityText(observed.probability, observed.logProbability)}. ${side === "two" ? "Die p-Wert-Menge kann aus beiden Verteilungsrändern bestehen und ist nicht zwingend symmetrisch. Sie ist nicht pauschal das Doppelte eines einseitigen p-Werts." : "Beim Wechsel der betrachteten Gruppe kehrt sich die Richtung für X um; der p-Wert für dieselbe Hypothese bleibt gleich."}</p><div class="fisher-event-expression">${eventLabel("fisher", { x, lower, upper, model, side })}</div><div class="fisher-result" data-probability="fisher">p = ${probabilityText(exact.probability, exact.logProbability)}</div><p class="note">Der p-Wert bezieht sich immer auf die tatsächlich beobachtete Tafel mit X = ${model.observed}, auch wenn du gerade eine andere Tafel erkundest.</p>${admin ? '<button class="primary" data-action="fisher-tail">Die Tafeln des p-Werts im Diagramm markieren</button>' : ""}</div>`;
    if (step === 7)
      html += `<div class="card fisher-decision-card"><span class="eyebrow">7 · Statistischer Schluss</span><h2>Was folgt für unser Experiment?</h2>${admin ? `<label>Signifikanzniveau α (Anteil; 0,05 entspricht 5 %)</label><input type="number" data-setting="alpha" min="0.001" max="0.5" step="0.01" value="${settings.alpha}" aria-label="Signifikanzniveau">` : ""}${fisherDecision(counts, settings)}<p class="note">Ein p-Wert ist eine Wahrscheinlichkeit unter H₀ und den Modellannahmen. Er ist weder die Wahrscheinlichkeit, dass H₀ wahr ist, noch die Wahrscheinlichkeit, dass diese Entscheidung falsch ist. Richtung und Signifikanzniveau werden vor der konfirmatorischen Auswertung festgelegt.</p></div>`;
  }
  html += `<details class="card fisher-assumptions"><summary>Voraussetzungen und Grenzen im Zeitexperiment</summary><p class="note">Der exakte Test bedingt auf die festen Randsummen und setzt unabhängige Beobachtungen sowie die Austauschbarkeit unter dem H₀-Modell voraus. Für den primären Test verwenden wir die erste gültige Messung pro Person. Mehrere Versuche derselben Person können abhängig sein; die Auswahl bester oder schlechtester Versuche verändert die Fragestellung.</p><p class="note">Die Gruppen wurden nicht zufällig zugeteilt, und die Teilnehmenden bilden eine Gelegenheitsstichprobe. Ein statistischer Zusammenhang ist deshalb kein Nachweis eines kausalen Effekts der Gruppenzugehörigkeit und lässt sich nicht uneingeschränkt auf andere Personen übertragen.</p></details></section>`;
  return html;
}
