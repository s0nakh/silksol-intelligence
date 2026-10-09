// Downloads the real data used to calibrate and backtest the Caspian port-closure model.
//
//   node scripts/data/fetch-caspian.mjs        → data/raw/*
//
// Sources (all free, no API key):
//  • Meteostat bulk hourly station observations (CC BY-NC 4.0) — ground truth wind:
//      UATE0 Aktau airport, 37864 Baku Bina airport.
//  • Open-Meteo Historical Forecast API — archived forecasts 2022-01 … 2024-02 (training).
//  • Open-Meteo Previous Runs API — forecasts issued 1, 2 and 3 days ahead, 2024-03 … 2025-12
//    (out-of-time backtest).
// Open-Meteo's free API is for non-commercial use; commercial pilots need an API subscription
// or a Kazhydromet / ECMWF data agreement.

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OUT = path.resolve("data/raw");

// Sea-side coordinates — keep in sync with NODES in src/services/telemetry/corridor.ts.
export const PORTS = {
  aktau: { lat: 43.6, lon: 51.2, station: "UATE0" },
  kuryk: { lat: 43.17, lon: 51.67, station: null },
  baku: { lat: 40.1, lon: 49.4, station: "37864" },
};

export const TRAIN = { start: "2022-01-01", end: "2024-02-29" };
export const TEST = { start: "2024-03-01", end: "2025-12-31" };
export const LEADS = [1, 2, 3];

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

async function download(url, file, { binary = false } = {}) {
  if (await exists(file)) {
    console.log(`✓ ${path.basename(file)} (cached)`);
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
      await writeFile(file, body);
      console.log(`↓ ${path.basename(file)}`);
      return;
    }
    console.warn(`  ${res.status} ${url} (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  throw new Error(`Failed to download ${url}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  for (const { station } of Object.values(PORTS)) {
    if (!station) continue;
    await download(
      `https://bulk.meteostat.net/v2/hourly/${station}.csv.gz`,
      path.join(OUT, `meteostat-${station}.csv.gz`),
      { binary: true },
    );
  }

  const prevVars = LEADS.flatMap((d) => [
    `wind_speed_10m_previous_day${d}`,
    `wind_gusts_10m_previous_day${d}`,
  ]).join(",");

  for (const [port, { lat, lon }] of Object.entries(PORTS)) {
    const q = `latitude=${lat}&longitude=${lon}&timezone=GMT&wind_speed_unit=ms`;
    await download(
      `https://historical-forecast-api.open-meteo.com/v1/forecast?${q}&start_date=${TRAIN.start}&end_date=${TRAIN.end}&hourly=wind_speed_10m,wind_gusts_10m`,
      path.join(OUT, `forecast-train-${port}.json`),
    );
    await download(
      `https://previous-runs-api.open-meteo.com/v1/forecast?${q}&start_date=${TEST.start}&end_date=${TEST.end}&hourly=${prevVars}`,
      path.join(OUT, `forecast-test-${port}.json`),
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
