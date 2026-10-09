// Trains and backtests the Caspian port-closure model on real data (see fetch-caspian.mjs).
//
//   node scripts/data/fetch-caspian.mjs && node scripts/data/calibrate-closure.mjs
//
// Event ("closure day"): a UTC day on which the port's weather station observed sustained wind
// ≥ 15 m/s — the ferry / ro-ro closure threshold used across the platform. This is a weather
// PROXY for closures; official harbour-master closure logs replace it once a pilot provides them.
//
// Model: logistic regression on the day's forecast max wind and max gust at the port.
//  • train: archived forecasts 2022-01 … 2024-02 (Aktau + Baku pooled)
//  • test:  forecasts issued 1, 2 and 3 days ahead, 2024-03 … 2025-12 (out of time)
//  • baseline: the rule "forecast max wind > 15 m/s ⇒ closed" the MVP used before.
//
// Writes src/services/ml/caspianCalibration.json and docs/BACKTEST.md.

import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { PORTS, TRAIN, TEST, LEADS } from "./fetch-caspian.mjs";

const RAW = path.resolve("data/raw");
const CLOSURE_WIND_MS = 15;
const CLIMATOLOGY_YEARS = { start: 2010, end: 2025 };

// --- Data loading -------------------------------------------------------------------------------

/** Station daily max sustained wind (m/s), keyed by YYYY-MM-DD. Meteostat wspd is km/h. */
async function stationDailyMax(station) {
  const csv = gunzipSync(await readFile(path.join(RAW, `meteostat-${station}.csv.gz`))).toString();
  const days = new Map();
  for (const line of csv.split("\n")) {
    const cols = line.split(",");
    const [date, , , , , , , , wspd] = cols;
    if (!date || !wspd) continue;
    const ms = Number(wspd) / 3.6;
    if (!Number.isFinite(ms)) continue;
    const d = days.get(date);
    days.set(date, { max: Math.max(d?.max ?? 0, ms), obs: (d?.obs ?? 0) + 1 });
  }
  // Days with sparse reporting can miss a storm peak; require at least 8 observations.
  return new Map([...days].filter(([, d]) => d.obs >= 8).map(([k, d]) => [k, d.max]));
}

/** Forecast daily max wind / gust per UTC day for one variable suffix ("" or "_previous_dayN"). */
async function forecastDaily(file, suffix = "") {
  const { hourly } = JSON.parse(await readFile(path.join(RAW, file), "utf8"));
  const wind = hourly[`wind_speed_10m${suffix}`];
  const gust = hourly[`wind_gusts_10m${suffix}`];
  const days = new Map();
  hourly.time.forEach((t, i) => {
    if (wind[i] == null || gust[i] == null) return;
    const day = t.slice(0, 10);
    const d = days.get(day) ?? { wind: 0, gust: 0, n: 0 };
    days.set(day, {
      wind: Math.max(d.wind, wind[i]),
      gust: Math.max(d.gust, gust[i]),
      n: d.n + 1,
    });
  });
  return new Map([...days].filter(([, d]) => d.n === 24));
}

// --- Logistic regression (IRLS with a small ridge) ---------------------------------------------

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

function solve3(A, b) {
  // Gaussian elimination for the 3×3 normal equations.
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[3] / row[i]);
}

function fitLogistic(rows, ridge = 1e-3) {
  let w = [-6, 0.2, 0.1];
  for (let iter = 0; iter < 50; iter++) {
    const H = [
      [ridge, 0, 0],
      [0, ridge, 0],
      [0, 0, ridge],
    ];
    const g = [0, -ridge * w[1], -ridge * w[2]];
    for (const { x, y } of rows) {
      const v = [1, ...x];
      const p = sigmoid(v.reduce((s, xi, i) => s + xi * w[i], 0));
      for (let i = 0; i < 3; i++) {
        g[i] += (y - p) * v[i];
        for (let j = 0; j < 3; j++) H[i][j] += p * (1 - p) * v[i] * v[j];
      }
    }
    const step = solve3(H, g);
    w = w.map((wi, i) => wi + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return w;
}

const predict = (w, x) => sigmoid(w[0] + w[1] * x[0] + w[2] * x[1]);

// --- Metrics ------------------------------------------------------------------------------------

function auc(scored) {
  const pos = scored.filter((s) => s.y === 1).length;
  const neg = scored.length - pos;
  if (!pos || !neg) return null;
  const sorted = [...scored].sort((a, b) => a.p - b.p);
  let rankSum = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j].p === sorted[i].p) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (sorted[k].y === 1) rankSum += avgRank;
    i = j;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

const brier = (scored) => scored.reduce((s, { p, y }) => s + (p - y) ** 2, 0) / scored.length;

function contingency(pairs) {
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;
  for (const { warn, y } of pairs) {
    if (warn && y) hits++;
    else if (!warn && y) misses++;
    else if (warn && !y) falseAlarms++;
  }
  return {
    hits,
    misses,
    falseAlarms,
    pod: hits / Math.max(1, hits + misses),
    far: falseAlarms / Math.max(1, hits + falseAlarms),
    csi: hits / Math.max(1, hits + misses + falseAlarms),
  };
}

const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

// --- Pipeline -----------------------------------------------------------------------------------

const inRange = (day, { start, end }) => day >= start && day <= end;

async function main() {
  const evalPorts = Object.entries(PORTS).filter(([, p]) => p.station);
  const stations = Object.fromEntries(
    await Promise.all(
      evalPorts.map(async ([port, { station }]) => [port, await stationDailyMax(station)]),
    ),
  );
  const label = (port, day) => {
    const max = stations[port].get(day);
    return max == null ? null : max >= CLOSURE_WIND_MS ? 1 : 0;
  };

  // Training set: archived forecasts vs observed closure days.
  const train = [];
  for (const [port] of evalPorts) {
    const fc = await forecastDaily(`forecast-train-${port}.json`);
    for (const [day, f] of fc) {
      const y = label(port, day);
      if (y != null && inRange(day, TRAIN)) train.push({ port, day, x: [f.wind, f.gust], y });
    }
  }
  const w = fitLogistic(train);
  const baseRate = train.reduce((s, r) => s + r.y, 0) / train.length;

  // Warning threshold: maximise CSI on the training set.
  const trainScored = train.map((r) => ({ p: predict(w, r.x), y: r.y }));
  let threshold = 0.5;
  let bestCsi = -1;
  for (let t = 0.05; t <= 0.95; t += 0.01) {
    const { csi } = contingency(trainScored.map(({ p, y }) => ({ warn: p >= t, y })));
    if (csi > bestCsi) [bestCsi, threshold] = [csi, Math.round(t * 100) / 100];
  }

  // Out-of-time backtest per lead day.
  const backtest = [];
  for (const lead of LEADS) {
    const rows = [];
    for (const [port] of evalPorts) {
      const fc = await forecastDaily(`forecast-test-${port}.json`, `_previous_day${lead}`);
      for (const [day, f] of fc) {
        const y = label(port, day);
        if (y != null && inRange(day, TEST)) rows.push({ port, x: [f.wind, f.gust], y });
      }
    }
    const scored = rows.map((r) => ({ p: predict(w, r.x), y: r.y, port: r.port, wind: r.x[0] }));
    const climBrier = brier(scored.map(({ y }) => ({ p: baseRate, y })));
    const perPort = Object.fromEntries(
      evalPorts.map(([port]) => {
        const s = scored.filter((r) => r.port === port);
        return [port, { days: s.length, events: s.filter((r) => r.y).length, auc: r3(auc(s)) }];
      }),
    );
    backtest.push({
      leadDays: lead,
      days: scored.length,
      events: scored.filter((r) => r.y).length,
      auc: r3(auc(scored)),
      brier: r3(brier(scored)),
      brierSkill: r3(1 - brier(scored) / climBrier),
      model: contingency(scored.map(({ p, y }) => ({ warn: p >= threshold, y }))),
      baselineRule: contingency(scored.map(({ wind, y }) => ({ warn: wind > CLOSURE_WIND_MS, y }))),
      perPort,
    });
  }

  // Observed climatology: share of closure days per calendar month, 2010–2025.
  const climatology = {};
  for (const [port] of evalPorts) {
    const months = Array.from({ length: 12 }, () => ({ days: 0, events: 0 }));
    for (const [day, max] of stations[port]) {
      const year = Number(day.slice(0, 4));
      if (year < CLIMATOLOGY_YEARS.start || year > CLIMATOLOGY_YEARS.end) continue;
      const m = months[Number(day.slice(5, 7)) - 1];
      m.days++;
      if (max >= CLOSURE_WIND_MS) m.events++;
    }
    climatology[port] = months.map((m) => r3(m.events / Math.max(1, m.days)));
  }
  // Kuryk has no public station; it shares Aktau's coastline and wind regime.
  climatology.kuryk = climatology.aktau;

  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  const calibration = {
    schema: "silksol.closure-calibration/v1",
    generatedAt: new Date().toISOString().slice(0, 10),
    event: `UTC day with station-observed sustained wind ≥ ${CLOSURE_WIND_MS} m/s (closure proxy)`,
    features: ["forecastMaxWindMs", "forecastMaxGustMs"],
    coefficients: { intercept: round(w[0], 4), maxWind: round(w[1], 4), maxGust: round(w[2], 4) },
    warningThreshold: threshold,
    trainBaseRate: r3(baseRate),
    train: { ...TRAIN, days: train.length, events: train.filter((r) => r.y).length },
    test: TEST,
    backtest,
    climatology: { years: CLIMATOLOGY_YEARS, closureDayShareByMonth: climatology },
    sources: {
      groundTruth: "Meteostat hourly observations (CC BY-NC 4.0): UATE0 Aktau, 37864 Baku Bina",
      forecasts: "Open-Meteo Historical Forecast API and Previous Runs API (non-commercial tier)",
    },
  };

  await writeFile(
    path.resolve("src/services/ml/caspianCalibration.json"),
    `${JSON.stringify(calibration, null, 2)}\n`,
  );
  await writeFile(path.resolve("docs/BACKTEST.md"), renderReport(calibration));
  console.log(
    JSON.stringify({ coefficients: calibration.coefficients, threshold, backtest }, null, 1),
  );
}

// --- Report -------------------------------------------------------------------------------------

const pct = (v) => `${Math.round(v * 100)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function renderReport(c) {
  const rows = c.backtest
    .map(
      (b) =>
        `| ${b.leadDays} d | ${b.days} | ${b.events} | ${b.auc} | ${b.brierSkill} | ${pct(b.model.pod)} / ${pct(b.model.far)} / ${b.model.csi.toFixed(2)} | ${pct(b.baselineRule.pod)} / ${pct(b.baselineRule.far)} / ${b.baselineRule.csi.toFixed(2)} |`,
    )
    .join("\n");
  const portRows = c.backtest
    .map(
      (b) =>
        `| ${b.leadDays} d | ${Object.entries(b.perPort)
          .map(([p, s]) => `${p}: AUC ${s.auc} (${s.events}/${s.days})`)
          .join(" · ")} |`,
    )
    .join("\n");
  const clim = Object.entries(c.climatology.closureDayShareByMonth)
    .filter(([p]) => p !== "kuryk")
    .map(([p, m]) => `| ${p} | ${m.map((v) => pct(v)).join(" | ")} |`)
    .join("\n");
  return `# Port-closure model — calibration & backtest

_Generated by \`scripts/data/calibrate-closure.mjs\` on ${c.generatedAt}. Re-run:
\`node scripts/data/fetch-caspian.mjs && node scripts/data/calibrate-closure.mjs\`._

## What is measured

- **Event:** ${c.event}. This is a weather proxy for ferry / ro-ro closures at Aktau and
  Baku/Alat; harbour-master closure logs from a pilot partner replace it as the label.
- **Ground truth:** ${c.sources.groundTruth}.
- **Forecasts:** ${c.sources.forecasts}.
- **Model:** logistic regression on the day's forecast max wind and max gust at the port,
  \`p = σ(${c.coefficients.intercept} + ${c.coefficients.maxWind}·wind + ${c.coefficients.maxGust}·gust)\`;
  warning threshold ${c.warningThreshold} (max CSI on training data).
- **Train:** ${c.train.start} … ${c.train.end} — ${c.train.days} port-days, ${c.train.events} closure days.
- **Test (out of time):** ${c.test.start} … ${c.test.end}, forecasts issued 1–3 days before the day.

## Out-of-time backtest (Aktau + Baku)

POD = share of closure days warned · FAR = share of warnings that were false · CSI = hits /
(hits + misses + false alarms). Brier skill > 0 means better than climatology.

| Lead | Days | Closure days | AUC | Brier skill | Model POD / FAR / CSI | Old rule (wind > 15) POD / FAR / CSI |
|---|---|---|---|---|---|---|
${rows}

| Lead | Per port |
|---|---|
${portRows}

## Observed seasonality — share of closure days by month (${c.climatology.years.start}–${c.climatology.years.end})

| Port | ${MONTHS.join(" | ")} |
|---|${MONTHS.map(() => "---").join("|")}|
${clim}

Kuryk has no public weather station; it uses Aktau's climatology.

## Limits

- The label is weather-based. Closures for other reasons (berth works, ferry schedule, ice in the
  northern Caspian) are not in it.
- Stations sit at airports, 10–60 km from the berths; the regression absorbs the systematic
  difference but not local effects.
- Dwell-time and ETA components of the risk engine are still expert-set; they are calibrated on
  the pilot partner's dwell logs (CMR/SMGS events, terminal gate-in/out).
- Data licences (Meteostat CC BY-NC, Open-Meteo free tier) are non-commercial; a commercial
  deployment needs Kazhydromet / ECMWF / Open-Meteo commercial access.
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
